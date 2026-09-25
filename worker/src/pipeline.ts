import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkerConfig } from "./config.js";
import { FFmpegCancelled, probeDuration, runFFmpeg } from "./ffmpeg.js";
import { buildParallaxFilter, PARALLAX_DEFAULT_INTENSITY } from "./parallax.js";
import {
  assignStoryBeats,
  storyCaptionEmphasis,
  storyDuckParams,
  storyMusicSegments,
  storyMusicVolumeExpr,
  storyParallaxMultiplier,
  type StoryBeatId,
} from "./story.js";
import { shouldCancel } from "./supabase.js";
import type { RenderJob, RenderJobMeta, SceneInput, StageId } from "./types.js";

/** Duplicate of src/lib/render/shared.ts to keep the worker dependency-free. */
export const ASPECTS: Record<string, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
};

function coverFilter(aspect: string): string {
  const d = ASPECTS[aspect] ?? ASPECTS["16:9"]!;
  return `scale=${d.width}:${d.height}:force_original_aspect_ratio=increase,crop=${d.width}:${d.height},setsar=1`;
}

function assTimestamp(s: number): string {
  const v = Math.max(0, s);
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const sec = Math.floor(v % 60);
  const cs = Math.floor((v % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function escapeAss(t: string): string {
  return t.replace(/\{/g, "(").replace(/\}/g, ")").replace(/\n/g, " ");
}

/** Caption language behaviour, mirroring one row of the `languages` table.
 * Duplicate of the src/lib/languages.ts shape to keep the worker
 * dependency-free. */
export type CaptionLanguage = {
  code: string;
  rtl: boolean;
  fontStack: string;
  captionMaxChars: number;
};

const GENERIC_FONT_FAMILIES = new Set([
  "system-ui",
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "-apple-system",
]);

/** Primary family from a CSS font stack; generic stacks fall back to Inter. */
export function primaryFontName(fontStack: string): string {
  const first = (fontStack.split(",")[0] ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!first || GENERIC_FONT_FAMILIES.has(first.toLowerCase())) return "Inter";
  return first;
}

function splitChars(word: string, maxChars: number): string[] {
  const chars = [...word];
  if (chars.length <= maxChars) return [word];
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += maxChars) {
    out.push(chars.slice(i, i + maxChars).join(""));
  }
  return out;
}

type LineChunk = { text: string; cs: number };
type CaptionLine = { chunks: LineChunk[]; start: number; end: number; emphasis: boolean };

/** Group cues into lines by character budget (language.caption_max_chars). */
function groupCuesByChars(
  cues: { word: string; start: number; end: number; emphasis?: boolean }[],
  maxChars: number,
): CaptionLine[] {
  const lines: CaptionLine[] = [];
  let chunks: LineChunk[] = [];
  let lineEmphasis = false;
  let lineLen = 0;
  let lineStart = 0;
  let lineEnd = 0;
  const flush = () => {
    if (chunks.length > 0) {
      lines.push({ chunks, start: lineStart, end: lineEnd, emphasis: lineEmphasis });
      chunks = [];
      lineLen = 0;
      lineEmphasis = false;
    }
  };
  for (const cue of cues) {
    const wordLen = Math.max(1, [...cue.word].length);
    for (const part of splitChars(cue.word, maxChars)) {
      const partLen = [...part].length;
      const cs = Math.max(
        1,
        Math.round(((cue.end - cue.start) * partLen * 100) / wordLen),
      );
      if (chunks.length > 0 && lineLen + 1 + partLen > maxChars) flush();
      if (chunks.length === 0) lineStart = cue.start;
      lineEnd = cue.end;
      if (cue.emphasis) lineEmphasis = true;
      chunks.push({ text: part, cs });
      lineLen = chunks.length === 1 ? partLen : lineLen + 1 + partLen;
    }
  }
  flush();
  return lines;
}

export function buildWordAss(
  cues: { word: string; start: number; end: number; emphasis?: boolean }[],
  opts: number | { fontSize?: number; language?: CaptionLanguage } = {},
): string {
  const { fontSize = 64, language } =
    typeof opts === "number" ? { fontSize: opts } : opts;
  const fontName = language ? primaryFontName(language.fontStack) : "Inter";
  const directionComment = language?.rtl ? "; Direction: RTL\n" : "";
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
ScaledBorderAndShadow: yes
${directionComment}
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Vidora,${fontName},${fontSize},&H00FFFFFF,&H0000FFFF,&H80000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,5,40,40,80,1
Style: VidoraHook,${fontName},${Math.round(fontSize * 1.25)},&H00FFFFFF,&H0000FFFF,&H80000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,5,40,40,80,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines: CaptionLine[] = [];
  if (language) {
    lines.push(...groupCuesByChars(cues, Math.max(1, language.captionMaxChars)));
  } else {
    for (let i = 0; i < cues.length; i += 4) {
      const g = cues.slice(i, i + 4);
      lines.push({
        chunks: g.map((c) => ({
          text: c.word,
          cs: Math.max(1, Math.round((c.end - c.start) * 100)),
        })),
        start: g[0]!.start,
        end: g[g.length - 1]!.end,
        // Story Mode: hook/payoff groups get the larger VidoraHook style.
        emphasis: g.some((c) => c.emphasis === true),
      });
    }
  }
  const dialogue = lines.map((line) => {
    const text = line.chunks
      .map((c) => `{\\kf${c.cs}}${escapeAss(c.text)}`)
      .join(" ");
    const style = line.emphasis ? "VidoraHook" : "Vidora";
    return `Dialogue: 0,${assTimestamp(line.start)},${assTimestamp(line.end)},${style},,0,0,0,,${text}`;
  });
  return header + dialogue.join("\n") + "\n";
}

/** Resolve caption language behaviour from the `languages` table. */
async function fetchCaptionLanguage(
  supabase: SupabaseClient,
  code: string | undefined,
): Promise<CaptionLanguage | null> {
  const { data, error } = await supabase
    .from("languages")
    .select("code, rtl, font_stack, caption_max_chars")
    .eq("code", code || "en")
    .maybeSingle();
  if (error || !data) return null;
  return {
    code: String(data.code),
    rtl: Boolean(data.rtl),
    fontStack: typeof data.font_stack === "string" ? data.font_stack : "system-ui",
    captionMaxChars:
      typeof data.caption_max_chars === "number" && data.caption_max_chars > 0
        ? data.caption_max_chars
        : 42,
  };
}

export type PipelineHooks = {
  onStage: (stage: StageId, progress: number, detail?: string) => Promise<void>;
  isCancelled: () => Promise<boolean>;
};

type Ctx = {
  cfg: WorkerConfig;
  supabase: SupabaseClient;
  job: RenderJob;
  meta: RenderJobMeta;
  dir: string;
  hooks: PipelineHooks;
};

export async function downloadTo(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}): ${url.slice(0, 80)}`);
  await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(dest));
}

/** Resolve a scene asset reference to a downloadable URL. */
export async function resolveAssetUrl(
  supabase: SupabaseClient,
  bucket: string,
  ref: string,
): Promise<string> {
  if (ref.startsWith("http://") || ref.startsWith("https://")) return ref;
  // Storage path → short-lived signed URL
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(ref, 3600);
  if (error || !data?.signedUrl) throw new Error(`Cannot sign asset path: ${ref}`);
  return data.signedUrl;
}

async function fetchSceneAssets(ctx: Ctx): Promise<SceneInput[]> {
  const { cfg, supabase, meta, dir, hooks } = ctx;
  const assetsDir = join(dir, "assets");
  await mkdir(assetsDir, { recursive: true });
  const out: SceneInput[] = [];

  for (let i = 0; i < meta.scenes.length; i++) {
    const s = meta.scenes[i]!;
    if (await hooks.isCancelled()) throw new FFmpegCancelled();
    await hooks.onStage("assets", (i / meta.scenes.length) * 100, `Scene ${s.number}`);

    let image: string | null = null;
    if (s.image) {
      const url = await resolveAssetUrl(supabase, cfg.RENDER_BUCKET, s.image);
      image = join(assetsDir, `img-${i}${extOf(s.image)}`);
      await downloadTo(url, image);
    }
    let audio: string | null = null;
    if (s.audio) {
      const url = await resolveAssetUrl(supabase, cfg.RENDER_BUCKET, s.audio);
      audio = join(assetsDir, `aud-${i}${extOf(s.audio)}`);
      await downloadTo(url, audio);
    }
    out.push({ ...s, image, audio });
  }
  return out;
}

function extOf(ref: string): string {
  const base = basename(ref.split("?")[0]!);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "";
}

/** Render one scene image into a silent video segment. */
async function renderSegment(
  ctx: Ctx,
  scene: SceneInput,
  index: number,
): Promise<string> {
  const { cfg, meta, dir, hooks } = ctx;
  const segPath = join(dir, `seg-${index}.mp4`);
  const dims = ASPECTS[meta.aspect] ?? ASPECTS["16:9"]!;

  // Checkpoint: skip already-rendered segments on resume.
  try {
    const st = await stat(segPath);
    if (st.size > 1024) return segPath;
  } catch {
    /* not rendered yet */
  }

  const input = scene.image;
  if (!input) throw new Error(`Scene ${scene.number} has no image`);

  // Story Mode: the scene's narrative beat scales the parallax intensity.
  // 2.5D parallax replaces the static cover when enabled (premium add-on).
  const storyBeats: StoryBeatId[] | null =
    meta.creationMode === "story" ? assignStoryBeats(meta.scenes.map((s) => s.duration)) : null;
  const beat = storyBeats?.[index] ?? null;
  const vf = meta.parallax25d
    ? `${buildParallaxFilter({
        width: dims.width,
        height: dims.height,
        frames: Math.max(1, Math.round(scene.duration * meta.fps)),
        intensity:
          PARALLAX_DEFAULT_INTENSITY * (beat ? storyParallaxMultiplier(beat) : 1),
        direction: index % 2 === 0 ? "in" : "out",
      })},format=yuv420p`
    : `${coverFilter(meta.aspect)},format=yuv420p`;

  const args = [
    "-y",
    "-loop",
    "1",
    "-framerate",
    String(meta.fps),
    "-i",
    input,
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-t",
    String(scene.duration),
    "-r",
    String(meta.fps),
    "-s",
    `${dims.width}x${dims.height}`,
    "-an",
    "-progress",
    "pipe:2",
    segPath,
  ];

  await runFFmpeg({
    ffmpegPath: cfg.FFMPEG_PATH,
    args,
    isCancelled: () => hooks.isCancelled(),
    onProgress: (p) => {
      void hooks.onStage("segments", 0, `Scene ${scene.number} ${p.outTimeSec.toFixed(1)}s`);
    },
  });
  return segPath;
}

/** Concatenate segments, mix audio, burn captions, finalize. */
async function assemble(ctx: Ctx, segments: string[], scenes: SceneInput[]): Promise<string> {
  const { cfg, supabase, meta, dir, hooks } = ctx;
  const dims = ASPECTS[meta.aspect] ?? ASPECTS["16:9"]!;

  // --- combine: concat demuxer (fast, no re-encode) ---
  await hooks.onStage("combine", 0);
  const listPath = join(dir, "concat.txt");
  await writeFile(listPath, segments.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join("\n"));
  const combined = join(dir, "combined.mp4");
  await runFFmpeg({
    ffmpegPath: cfg.FFMPEG_PATH,
    args: ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-progress", "pipe:2", combined],
    isCancelled: () => hooks.isCancelled(),
  });

  // --- audio: scene narration + optional voiceover/music (P4: ducking) ---
  await hooks.onStage("audio", 0);
  const totalDur = scenes.reduce((a, s) => a + s.duration, 0);
  const audioInputs: string[] = [];
  const filterParts: string[] = [];
  let inputIdx = 1; // 0 is the combined video

  // Voice bus: scene narration clips + optional full voiceover
  const voiceFiles: { path: string; at: number; dur: number; vol: number }[] = [];
  let t = 0;
  for (const s of scenes) {
    if (s.audio) voiceFiles.push({ path: s.audio, at: t, dur: s.duration, vol: 1 });
    t += s.duration;
  }
  if (meta.voiceoverUrl) {
    const vo = join(dir, "voiceover.m4a");
    await downloadTo(await resolveAssetUrl(supabase, cfg.RENDER_BUCKET, meta.voiceoverUrl), vo);
    voiceFiles.push({ path: vo, at: 0, dur: totalDur, vol: 1 });
  }
  // Music bus (optional)
  let musicPath: string | null = null;
  if (meta.musicUrl) {
    musicPath = join(dir, "music.m4a");
    await downloadTo(await resolveAssetUrl(supabase, cfg.RENDER_BUCKET, meta.musicUrl), musicPath);
  }

  let withAudio = combined;
  if (voiceFiles.length > 0 || musicPath) {
    const voiceLabels: string[] = [];
    for (const a of voiceFiles) {
      audioInputs.push("-i", a.path);
      const lbl = `v${inputIdx}`;
      filterParts.push(
        `[${inputIdx}:a]adelay=${Math.round(a.at * 1000)}|${Math.round(a.at * 1000)},volume=${a.vol},apad[${lbl}]`,
      );
      voiceLabels.push(`[${lbl}]`);
      inputIdx++;
    }
    // Collapse voice bus to a single [voice] stream
    let voiceBus = "";
    if (voiceLabels.length === 1) {
      voiceBus = voiceLabels[0]!;
    } else if (voiceLabels.length > 1) {
      filterParts.push(`${voiceLabels.join("")}amix=inputs=${voiceLabels.length}:normalize=0[voice]`);
      voiceBus = "[voice]";
    }

    let finalAudio = voiceBus;
    if (musicPath) {
      audioInputs.push("-i", musicPath);
      const mIdx = inputIdx++;
      // Story Mode: the bed follows the per-beat volume envelope (quoted in
      // the filtergraph because the expression contains commas).
      const storyMode = meta.creationMode === "story";
      const bedVolume = storyMode
        ? `volume='${storyMusicVolumeExpr(storyMusicSegments(scenes.map((s) => s.duration)), meta.musicVolume)}':eval=frame`
        : `volume=${meta.musicVolume}`;
      // Music: volume + fade in/out, trim to total duration
      filterParts.push(
        `[${mIdx}:a]${bedVolume},afade=t=in:st=0:d=1,afade=t=out:st=${Math.max(0, totalDur - 2).toFixed(2)}:d=2,apad,atrim=0:${totalDur.toFixed(2)}[music]`,
      );
      if (voiceBus && meta.musicDucking) {
        // P4: duck music under the voice bus via sidechain compression.
        // Story Mode uses the deeper/faster story duck profile.
        const duckParams = storyMode
          ? storyDuckParams()
          : "threshold=0.02:ratio=8:attack=200:release=800";
        filterParts.push(`[music]${voiceBus}sidechaincompress=${duckParams}:makeup=1[ducked]`);
        filterParts.push(`${voiceBus}[ducked]amix=inputs=2:normalize=0[aout]`);
      } else if (voiceBus) {
        filterParts.push(`${voiceBus}[music]amix=inputs=2:normalize=0[aout]`);
      } else {
        filterParts.push(`[music]anull[aout]`);
      }
      finalAudio = "[aout]";
    } else if (voiceBus) {
      filterParts.push(`${voiceBus}anull[aout]`);
      finalAudio = "[aout]";
    }

    withAudio = join(dir, "with-audio.mp4");
    await runFFmpeg({
      ffmpegPath: cfg.FFMPEG_PATH,
      args: [
        "-y",
        "-i",
        combined,
        ...audioInputs,
        "-filter_complex",
        filterParts.join(";"),
        "-map",
        "0:v",
        "-map",
        finalAudio,
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-shortest",
        "-progress",
        "pipe:2",
        withAudio,
      ],
      isCancelled: () => hooks.isCancelled(),
    });
  }

  // --- captions: burn word-level ASS ---
  let captioned = withAudio;
  if (meta.burnCaptions) {
    await hooks.onStage("captions", 0);
    const storyBeats: StoryBeatId[] | null =
      meta.creationMode === "story" ? assignStoryBeats(scenes.map((s) => s.duration)) : null;
    const allCues = scenes.flatMap((s, si) => {
      const offset = scenes.slice(0, si).reduce((a, x) => a + x.duration, 0);
      const cues = s.cues.length > 0 ? s.cues : spreadFallback(s.narration, s.duration);
      const beat = storyBeats?.[si] ?? null;
      const emphasis = beat ? storyCaptionEmphasis(beat) : false;
      return cues.map((c) => ({ ...c, start: c.start + offset, end: c.end + offset, emphasis }));
    });
    if (allCues.length > 0) {
      const assPath = join(dir, "captions.ass");
      // Language behaviour (font, RTL, line length) comes from the languages
      // table — never hardcoded. Unknown codes fall back to defaults.
      const language = await fetchCaptionLanguage(ctx.supabase, meta.languageCode);
      await writeFile(assPath, buildWordAss(allCues, { language: language ?? undefined }));
      captioned = join(dir, "captioned.mp4");
      await runFFmpeg({
        ffmpegPath: cfg.FFMPEG_PATH,
        args: [
          "-y",
          "-i",
          withAudio,
          "-vf",
          `ass=${assPath.replace(/'/g, "'\\''")}`,
          "-c:v",
          "libx264",
          "-preset",
          "medium",
          "-crf",
          "20",
          "-c:a",
          "copy",
          "-progress",
          "pipe:2",
          captioned,
        ],
        isCancelled: () => hooks.isCancelled(),
      });
    }
  }

  // --- finalize: faststart + metadata ---
  await hooks.onStage("finalize", 0);
  const final = join(dir, "final.mp4");
  await runFFmpeg({
    ffmpegPath: cfg.FFMPEG_PATH,
    args: [
      "-y",
      "-i",
      captioned,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      "-metadata",
      `title=${meta.title}`,
      "-progress",
      "pipe:2",
      final,
    ],
    isCancelled: () => hooks.isCancelled(),
  });

  // Validate output
  const dur = await probeDuration(cfg.FFPROBE_PATH, final);
  if (!(dur > 0)) throw new Error("Final MP4 has no duration");
  return final;
}

export function spreadFallback(narration: string, duration: number): { word: string; start: number; end: number }[] {
  const words = narration.split(/\s+/).filter(Boolean);
  if (!words.length || duration <= 0) return [];
  const per = duration / words.length;
  return words.map((word, i) => ({ word, start: i * per, end: (i + 1) * per }));
}

/** Full pipeline for one claimed job. Returns the final MP4 path. */
export async function runPipeline(ctx: Ctx): Promise<string> {
  const { hooks } = ctx;
  await mkdir(ctx.dir, { recursive: true });

  const scenes = await fetchSceneAssets(ctx);

  const segments: string[] = [];
  for (let i = 0; i < scenes.length; i++) {
    if (await hooks.isCancelled()) throw new FFmpegCancelled();
    const pct = (i / scenes.length) * 100;
    await hooks.onStage("segments", pct, `Scene ${scenes[i]!.number}/${scenes.length}`);
    segments.push(await renderSegment(ctx, scenes[i]!, i));
    // Heartbeat checkpoint: record completed segments for resume
    await hooks.onStage("segments", ((i + 1) / scenes.length) * 100, `Scene ${scenes[i]!.number} done`);
  }

  return assemble(ctx, segments, scenes);
}

/** Create an isolated working directory for a job. */
export function jobDir(base: string, jobId: string): string {
  return join(base || tmpdir(), `job-${jobId}`);
}
