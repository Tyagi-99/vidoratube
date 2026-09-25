import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkerConfig } from "./config.js";
import { FFmpegCancelled, probeDuration, runFFmpeg } from "./ffmpeg.js";
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

export function buildWordAss(
  cues: { word: string; start: number; end: number }[],
  fontSize = 64,
): string {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Vidora,Inter,${fontSize},&H00FFFFFF,&H0000FFFF,&H80000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,5,40,40,80,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines: string[] = [];
  for (let i = 0; i < cues.length; i += 4) {
    const g = cues.slice(i, i + 4);
    const text = g
      .map((c) => `{\\kf${Math.max(1, Math.round((c.end - c.start) * 100))}}${escapeAss(c.word)}`)
      .join(" ");
    lines.push(`Dialogue: 0,${assTimestamp(g[0]!.start)},${assTimestamp(g[g.length - 1]!.end)},Vidora,,0,0,0,,${text}`);
  }
  return header + lines.join("\n") + "\n";
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

async function downloadTo(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}): ${url.slice(0, 80)}`);
  await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(dest));
}

/** Resolve a scene asset reference to a downloadable URL. */
async function resolveAssetUrl(
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

  const args = [
    "-y",
    "-loop",
    "1",
    "-framerate",
    String(meta.fps),
    "-i",
    input,
    "-vf",
    `${coverFilter(meta.aspect)},format=yuv420p`,
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
      // Music: volume + fade in/out, trim to total duration
      filterParts.push(
        `[${mIdx}:a]volume=${meta.musicVolume},afade=t=in:st=0:d=1,afade=t=out:st=${Math.max(0, totalDur - 2).toFixed(2)}:d=2,apad,atrim=0:${totalDur.toFixed(2)}[music]`,
      );
      if (voiceBus && meta.musicDucking) {
        // P4: duck music under the voice bus via sidechain compression
        filterParts.push(
          `[music]${voiceBus}sidechaincompress=threshold=0.02:ratio=8:attack=200:release=800:makeup=1[ducked]`,
        );
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
    const allCues = scenes.flatMap((s, si) => {
      const offset = scenes.slice(0, si).reduce((a, x) => a + x.duration, 0);
      const cues = s.cues.length > 0 ? s.cues : spreadFallback(s.narration, s.duration);
      return cues.map((c) => ({ ...c, start: c.start + offset, end: c.end + offset }));
    });
    if (allCues.length > 0) {
      const assPath = join(dir, "captions.ass");
      await writeFile(assPath, buildWordAss(allCues));
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

function spreadFallback(narration: string, duration: number): { word: string; start: number; end: number }[] {
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
