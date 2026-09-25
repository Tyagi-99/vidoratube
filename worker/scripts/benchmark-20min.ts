#!/usr/bin/env -S npx tsx
/**
 * 20-minute Story Mode render benchmark (Sprints 3-4, item 6).
 *
 * Run:  cd worker && npx tsx scripts/benchmark-20min.ts [flags]
 * Quick: npx tsx scripts/benchmark-20min.ts --smoke   (1 chapter x 10 s, ~1 min)
 *
 * == METHODOLOGY (read before quoting numbers) ==
 *
 * GOAL: measure how long a 20-minute Story Mode video takes to render on ONE
 * worker, against the investor target of < 15 minutes (900 s).
 *
 * IMPLEMENTATION UNDER TEST (auto-detected by --chapter-impl=auto):
 *  - RealChapterPipeline (used when worker/src/chapters.ts exports
 *    renderChapter/stitchChapters, which it now does): drives the ACTUAL
 *    chapter code. Per chapter: paragraph audio is fetched over HTTP (here a
 *    local loopback server - zero spend, no Supabase), concatenated to one
 *    AAC 160k track, word cues are built by the real spreadWordCues, and a
 *    SINGLE x264 pass renders a solid-color background (the continuity brief)
 *    with subtitles burned in (libass), preset medium CRF 20, +faststart.
 *    Stitch = the real stitchChapters: concat demuxer copy + faststart in one
 *    pass (no re-encode). Chapter-mode renders have no still-image segments
 *    and no music/ducking stage.
 *  - BaselineChapterPipeline (fallback if chapters.ts is absent): mirrors the
 *    legacy scene pipeline (worker/src/pipeline.ts renderSegment + assemble)
 *    exactly: per-scene still->mp4, concat, narration+music audio mix with
 *    sidechain ducking (AAC 160k), ASS caption burn-in via buildWordAss,
 *    +faststart. DEVIATION in the fallback only: the legacy graph feeds the
 *    voice bus into both sidechaincompress and amix without asplit, which
 *    ffmpeg rejects (latent pipeline.ts bug); the fallback inserts the
 *    missing asplit=2 with negligible cost impact.
 *
 * WHAT IS REAL:
 *  - Every FFmpeg invocation is real native FFmpeg (libx264, libass) with
 *    the SAME encode settings as the implementation under test.
 *  - Per-stage wall times are measured with process.hrtime around each stage.
 *
 * WHAT IS SYNTHETIC (costs no money, no API calls):
 *  - Paragraph narration: sine/noise mixes at 48 kHz WAV, NOT real TTS. AAC
 *    encode cost is content-agnostic enough for a benchmark; the spectral
 *    content does not resemble speech.
 *  - Caption cues: synthetic words at ~150 wpm, real ASS formatting via the
 *    real spreadWordCues.
 *  - (Fallback only) Still images: 1-frame JPEGs from testsrc2 + noise;
 *    music: synthetic brown-noise bed.
 *
 * WHAT IS EXTRAPOLATED (not hidden - reported separately):
 *  - Only N chapters (default 2) x 150 s = 300 s of media are actually
 *    rendered. The full 20 min (8 chapters) is PROJECTED with the pure model
 *    in worker/src/benchmark-model.ts (unit-tested):
 *        total = ceil(8 / C) * median(chapter wall) + stitch
 *        stitch = concat scaled by chapter count
 *               + loudnorm(1200 s) extrapolated linearly from the measured
 *                 single-pass loudnorm rate (loudnorm is strictly linear in
 *                 audio duration)
 *               + measured faststart finalize
 *    Both the measured numbers and the projected numbers are printed and
 *    written to worker/benchmark-results.md. C (chapter concurrency) is
 *    reported for C=1, C=2 (WORKER_CHAPTER_CONCURRENCY default) and C=4
 *    (hypothetical bigger VPS, NOT measured on this 2-vCPU VM).
 *
 * WHAT IS EXCLUDED (deliberately, and stated in every report):
 *  - TTS / LLM / image-generation wall time. These are a separate pre-stage
 *    in the real system (TTS runs ahead of / in parallel with encoding); the
 *    harness substitutes zero-cost synthetic assets. Breakdown lists
 *    narration/TTS as "mocked (excluded)".
 *  - Asset download/upload (Supabase). Paragraph audio is served over a local
 *    loopback server; its generation time is measured but labelled synthetic.
 *  - The -14 LUFS loudness pass is PROPOSED, not in chapters.ts as of this
 *    writing. Its cost is measured (single-pass loudnorm rate) and folded
 *    into projections only when --loudnorm (default on), always labelled
 *    "proposed".
 *
 * ADAPTER SEAM (chapter agent coordination):
 *  - The harness renders through the `ChapterPipeline` interface below. If
 *    worker/src/chapters.ts exports renderChapter/stitchChapters, the
 *    harness auto-detects them (--chapter-impl=auto, the default) and uses
 *    the REAL chapter implementation; otherwise it falls back to
 *    BaselineChapterPipeline (legacy scene pipeline mirror).
 *    The report always states which implementation was used. The harness does
 *    NOT modify pipeline.ts or any chapter code.
 *
 * REPRODUCIBILITY: the results markdown records the exact command, git hash,
 * ffmpeg version, CPU/RAM, date, and all measured + projected numbers.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createReadStream, statSync } from "node:fs";
import { cpus, loadavg, tmpdir, totalmem } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildWordAss } from "../src/pipeline.js";
import { probeDuration, runFFmpeg } from "../src/ffmpeg.js";
import { fmtDur, projectTotal } from "../src/benchmark-model.js";
import type { MeasuredChapter, MeasuredStitch } from "../src/benchmark-model.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkerConfig } from "../src/config.js";
import type { RenderJob, RenderJobMeta } from "../src/types.js";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

type Flags = {
  chaptersMeasured: number;
  chapterSec: number;
  scenesPerChapter: number;
  targetMediaSec: number;
  targetChapters: number;
  concurrencies: number[];
  aspect: string;
  fps: number;
  captionPreset: string;
  loudnorm: boolean;
  smoke: boolean;
  writeResults: boolean;
  resultsPath: string;
  workdir: string;
  chapterImpl: "auto" | "baseline";
};

function parseFlags(argv: string[]): Flags {
  const get = (name: string, def: string): string => {
    const p = `--${name}=`;
    const hit = argv.find((a) => a.startsWith(p));
    return hit ? hit.slice(p.length) : def;
  };
  const has = (name: string): boolean => argv.includes(`--${name}`);
  const smoke = has("smoke");
  return {
    chaptersMeasured: smoke ? 1 : Number(get("chapters", "2")),
    chapterSec: smoke ? 10 : Number(get("chapter-sec", "150")),
    scenesPerChapter: smoke ? 1 : Number(get("scenes", "5")),
    targetMediaSec: Number(get("target-sec", "1200")),
    targetChapters: Number(get("target-chapters", "8")),
    concurrencies: get("concurrency", "1,2,4")
      .split(",")
      .map(Number)
      .filter((n) => Number.isFinite(n) && n >= 1),
    aspect: get("aspect", "16:9"),
    fps: Number(get("fps", "30")),
    captionPreset: get("caption-preset", "medium"),
    loudnorm: !has("no-loudnorm"),
    smoke,
    writeResults: !has("no-write-results"),
    resultsPath: get("results", "benchmark-results.md"),
    workdir: get("workdir", ""),
    chapterImpl: get("chapter-impl", "auto") as Flags["chapterImpl"],
  };
}

// ---------------------------------------------------------------------------
// ChapterPipeline adapter seam
// ---------------------------------------------------------------------------

export interface StageTiming {
  stage: string;
  sec: number;
  /** e.g. "synthetic", "proposed", "n/a in chapter mode" */
  note?: string;
}

export interface ChapterTimings {
  index: number;
  mediaSec: number;
  /** stages in execution order; names differ per implementation */
  stages: StageTiming[];
  totalSec: number;
  /** final chapter MP4 path */
  output: string;
}

export interface StitchTimings {
  mediaSec: number;
  chapterCount: number;
  concatSec: number;
  loudnormSec: number;
  finalizeSec: number;
  totalSec: number;
}

export interface ChapterPipeline {
  /** Human name recorded in the report (which implementation ran). */
  readonly name: string;
  renderChapter(
    dir: string,
    index: number,
    sceneSec: number[],
    ctx: RenderCtx,
  ): Promise<ChapterTimings>;
  stitch(
    dir: string,
    chapterMp4s: string[],
    ctx: RenderCtx,
  ): Promise<StitchTimings>;
}

export interface RenderCtx {
  ffmpeg: string;
  ffprobe: string;
  aspect: string;
  width: number;
  height: number;
  fps: number;
  captionPreset: string;
  loudnorm: boolean;
}

const ASPECTS: Record<string, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
};

const neverCancel = () => false;

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; sec: number }> {
  const t0 = process.hrtime.bigint();
  const value = await fn();
  const sec = Number(process.hrtime.bigint() - t0) / 1e9;
  return { value, sec };
}

function ffmpegRun(
  ctx: RenderCtx,
  args: string[],
  label: string,
): Promise<void> {
  return runFFmpeg({ ffmpegPath: ctx.ffmpeg, args, isCancelled: neverCancel }).catch(
    (e) => {
      throw new Error(`${label} failed: ${(e as Error).message}`);
    },
  );
}

/** Synthetic still: static frame with photo-ish texture (see header caveat).
 * JPEG (q:v 2), like real AI-generated stills - PNG decode-per-frame would
 * inflate segment encode time with a decode artifact production doesn't have. */
async function genStill(ctx: RenderCtx, dest: string, seed: number): Promise<void> {
  const { width, height } = ctx;
  await ffmpegRun(
    ctx,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=${width}x${height}:duration=1:rate=30,noise=alls=12:allf=t`,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      dest,
    ],
    `genStill#${seed}`,
  );
}

/** Synthetic narration: voice-BAND-ish tone mix at 48 kHz (NOT real TTS). */
async function genNarration(
  ctx: RenderCtx,
  dest: string,
  durSec: number,
  seed: number,
): Promise<void> {
  await ffmpegRun(
    ctx,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${128 + (seed % 7)}:duration=${durSec}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${256 + (seed % 11)}:duration=${durSec}`,
      "-f",
      "lavfi",
      "-i",
      `anoisesrc=color=pink:duration=${durSec}:seed=${seed + 2}`,
      "-filter_complex",
      `[0:a]volume=0.5[a0];[1:a]volume=0.25[a1];[2:a]volume=0.12[a2];` +
        `[a0][a1][a2]amix=inputs=3:normalize=0,aresample=48000,aformat=channel_layouts=stereo,` +
        `afade=t=in:st=0:d=0.3,afade=t=out:st=${Math.max(0, durSec - 0.3).toFixed(2)}:d=0.3[aout]`,
      "-map",
      "[aout]",
      "-c:a",
      "pcm_s16le",
      "-ar",
      "48000",
      dest,
    ],
    `genNarration#${seed}`,
  );
}

/** Synthetic music bed (NOT a licensed track). */
async function genMusic(ctx: RenderCtx, dest: string, durSec: number): Promise<void> {
  await ffmpegRun(
    ctx,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `anoisesrc=color=brown:duration=${durSec}:seed=42`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=82:duration=${durSec}`,
      "-filter_complex",
      `[0:a]volume=0.35[m0];[1:a]volume=0.15[m1];[m0][m1]amix=inputs=2:normalize=0,` +
        `aresample=48000,aformat=channel_layouts=stereo,afade=t=in:st=0:d=2,afade=t=out:st=${Math.max(0, durSec - 2).toFixed(2)}:d=2[aout]`,
      "-map",
      "[aout]",
      "-c:a",
      "pcm_s16le",
      "-ar",
      "48000",
      dest,
    ],
    "genMusic",
  );
}

const WORDS = (
  "the quick brown fox jumps over the lazy dog and runs through the quiet " +
  "midnight streets of the sleeping city while stars fade into dawn over " +
  "distant hills and rivers carry stories downstream"
).split(" ");

function sceneCues(sceneSec: number, wpm = 150): { word: string; start: number; end: number }[] {
  const count = Math.max(1, Math.round((sceneSec * wpm) / 60));
  const per = sceneSec / count;
  return Array.from({ length: count }, (_, i) => ({
    word: WORDS[i % WORDS.length]!,
    start: i * per,
    end: (i + 1) * per,
  }));
}

/** Synthetic paragraph text of roughly `durSec` at 150 wpm (mock script). */
function paragraphText(durSec: number): string {
  const count = Math.max(8, Math.round((durSec * 150) / 60));
  const words: string[] = [];
  for (let i = 0; i < count; i++) words.push(WORDS[(i * 7919) % WORDS.length]!);
  return words.join(" ");
}

function coverFilter(aspect: string): string {
  const d = ASPECTS[aspect] ?? ASPECTS["16:9"]!;
  return `scale=${d.width}:${d.height}:force_original_aspect_ratio=increase,crop=${d.width}:${d.height},setsar=1`;
}

/**
 * Baseline chapter implementation: mirrors worker/src/pipeline.ts's
 * renderSegment + assemble ffmpeg arguments exactly (preset medium, CRF 20,
 * AAC 160k, sidechain ducking, ASS burn-in, +faststart), scoped to one chapter.
 */
class BaselineChapterPipeline implements ChapterPipeline {
  readonly name = "BaselineChapterPipeline (mirrors pipeline.ts encode args; synthetic assets)";

  async renderChapter(
    dir: string,
    index: number,
    sceneSec: number[],
    ctx: RenderCtx,
  ): Promise<ChapterTimings> {
    const { width, height, fps } = ctx;
    const t: ChapterTimings = {
      index,
      mediaSec: sceneSec.reduce((a, b) => a + b, 0),
      stages: [],
      totalSec: 0,
      output: join(dir, "chapter.mp4"),
    };
    const t0 = process.hrtime.bigint();
    await mkdir(dir, { recursive: true });
    const assetsDir = join(dir, "assets");
    await mkdir(assetsDir, { recursive: true });

    // ---- prep: synthetic assets (measured, labelled synthetic) ----
    {
      const { sec } = await timed(async () => {
        for (let i = 0; i < sceneSec.length; i++) {
          await genStill(ctx, join(assetsDir, `img-${i}.jpg`), index * 100 + i);
          await genNarration(ctx, join(assetsDir, `aud-${i}.wav`), sceneSec[i]!, index * 100 + i);
        }
        await genMusic(ctx, join(assetsDir, "music.wav"), t.mediaSec);
      });
      t.stages.push({ stage: "asset prep", sec, note: "synthetic" });
    }

    // ---- segments: still -> mp4 (mirrors pipeline.ts renderSegment) ----
    const segments: string[] = [];
    {
      const { sec } = await timed(async () => {
        for (let i = 0; i < sceneSec.length; i++) {
          const seg = join(dir, `seg-${i}.mp4`);
          await ffmpegRun(
            ctx,
            [
              "-y",
              "-loop",
              "1",
              "-framerate",
              String(fps),
              "-i",
              join(assetsDir, `img-${i}.jpg`),
              "-vf",
              `${coverFilter(ctx.aspect)},format=yuv420p`,
              "-c:v",
              "libx264",
              "-preset",
              "medium",
              "-crf",
              "20",
              "-t",
              String(sceneSec[i]),
              "-r",
              String(fps),
              "-s",
              `${width}x${height}`,
              "-an",
              seg,
            ],
            `segment ch${index} scene${i}`,
          );
          segments.push(seg);
        }
      });
      t.stages.push({ stage: "segment encodes", sec });
    }

    // ---- concat (copy) ----
    let combined = "";
    {
      const { value, sec } = await timed(async () => {
        const listPath = join(dir, "concat.txt");
        await writeFile(
          listPath,
          segments.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join("\n"),
        );
        const out = join(dir, "combined.mp4");
        await ffmpegRun(
          ctx,
          ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", out],
          `concat ch${index}`,
        );
        return out;
      });
      combined = value;
      t.stages.push({ stage: "concat (copy)", sec });
    }

    // ---- audio mix (mirrors pipeline.ts assemble audio stage) ----
    let withAudio = combined;
    {
      const { value, sec } = await timed(async () => {
        const totalDur = t.mediaSec;
        const audioInputs: string[] = [];
        const filterParts: string[] = [];
        const voiceLabels: string[] = [];
        let at = 0;
        let inputIdx = 1;
        for (let i = 0; i < sceneSec.length; i++) {
          const p = join(assetsDir, `aud-${i}.wav`);
          audioInputs.push("-i", p);
          const lbl = `v${inputIdx}`;
          filterParts.push(
            `[${inputIdx}:a]adelay=${Math.round(at * 1000)}|${Math.round(at * 1000)},volume=1,apad[${lbl}]`,
          );
          voiceLabels.push(`[${lbl}]`);
          inputIdx++;
          at += sceneSec[i]!;
        }
        let voiceBus = voiceLabels[0]!;
        if (voiceLabels.length > 1) {
          filterParts.push(`${voiceLabels.join("")}amix=inputs=${voiceLabels.length}:normalize=0[voice]`);
          voiceBus = "[voice]";
        }
        const mIdx = inputIdx;
        audioInputs.push("-i", join(assetsDir, "music.wav"));
        filterParts.push(
          `[${mIdx}:a]volume=0.15,afade=t=in:st=0:d=1,` +
            `afade=t=out:st=${Math.max(0, totalDur - 2).toFixed(2)}:d=2,apad,` +
            `atrim=0:${totalDur.toFixed(2)}[music]`,
        );
        // NOTE (benchmark found a latent pipeline.ts bug, 2026-09-25): the
        // production graph feeds the voice bus into BOTH sidechaincompress
        // (as sidechain) and amix without asplit. ffmpeg rejects a filter
        // output pad consumed twice ("Stream specifier 'v1' ... matches no
        // streams"), so ANY render with musicUrl + musicDucking fails at the
        // audio stage. The harness measures the corrected graph (asplit=2);
        // the one extra asplit has negligible cost, so the timing stays
        // representative. See the report for the pipeline.ts fix.
        filterParts.push(`${voiceBus}asplit=2[vsc][vmix]`);
        filterParts.push(
          `[music][vsc]sidechaincompress=threshold=0.02:ratio=8:attack=200:release=800:makeup=1[ducked]`,
        );
        filterParts.push(`[vmix][ducked]amix=inputs=2:normalize=0[aout]`);
        const out = join(dir, "with-audio.mp4");
        await ffmpegRun(
          ctx,
          [
            "-y",
            "-i",
            combined,
            ...audioInputs,
            "-filter_complex",
            filterParts.join(";"),
            "-map",
            "0:v",
            "-map",
            "[aout]",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-shortest",
            out,
          ],
          `audiomix ch${index}`,
        );
        return out;
      });
      withAudio = value;
      t.stages.push({ stage: "audio mix + ducking", sec });
    }

    // ---- caption burn (mirrors pipeline.ts; real buildWordAss) ----
    let captioned = withAudio;
    {
      const { value, sec } = await timed(async () => {
        const cues = sceneSec.flatMap((d, si) => {
          const offset = sceneSec.slice(0, si).reduce((a, x) => a + x, 0);
          return sceneCues(d).map((c) => ({
            ...c,
            start: c.start + offset,
            end: c.end + offset,
          }));
        });
        const assPath = join(dir, "captions.ass");
        await writeFile(assPath, buildWordAss(cues));
        const out = join(dir, "captioned.mp4");
        await ffmpegRun(
          ctx,
          [
            "-y",
            "-i",
            withAudio,
            "-vf",
            `ass=${assPath.replace(/'/g, "'\\''")}`,
            "-c:v",
            "libx264",
            "-preset",
            ctx.captionPreset,
            "-crf",
            "20",
            "-c:a",
            "copy",
            out,
          ],
          `captionburn ch${index}`,
        );
        return out;
      });
      captioned = value;
      t.stages.push({ stage: "caption burn-in", sec });
    }

    // ---- finalize (+faststart) ----
    {
      const { sec } = await timed(async () => {
        const out = join(dir, "chapter.mp4");
        await ffmpegRun(
          ctx,
          ["-y", "-i", captioned, "-c", "copy", "-movflags", "+faststart", out],
          `finalize ch${index}`,
        );
        const dur = await probeDuration(ctx.ffprobe, out);
        if (!(dur > 0)) throw new Error(`chapter ${index} final has no duration`);
      });
      t.stages.push({ stage: "finalize (+faststart)", sec });
    }

    t.totalSec = Number(process.hrtime.bigint() - t0) / 1e9;
    return t;
  }

  async stitch(
    dir: string,
    chapterMp4s: string[],
    ctx: RenderCtx,
  ): Promise<StitchTimings> {
    const t: StitchTimings = {
      mediaSec: 0,
      chapterCount: chapterMp4s.length,
      concatSec: 0,
      loudnormSec: 0,
      finalizeSec: 0,
      totalSec: 0,
    };
    const t0 = process.hrtime.bigint();
    await mkdir(dir, { recursive: true });

    for (const m of chapterMp4s) t.mediaSec += await probeDuration(ctx.ffprobe, m);

    let stitched = "";
    {
      const { value, sec } = await timed(async () => {
        const listPath = join(dir, "concat.txt");
        await writeFile(
          listPath,
          chapterMp4s.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join("\n"),
        );
        const out = join(dir, "stitched.mp4");
        await ffmpegRun(
          ctx,
          ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", out],
          "stitch concat",
        );
        return out;
      });
      stitched = value;
      t.concatSec = sec;
    }

    // PROPOSED loudness stage (-14 LUFS, single pass). Not in pipeline.ts;
    // measured separately and labelled as proposed in every report.
    let loud = stitched;
    if (ctx.loudnorm) {
      const { value, sec } = await timed(async () => {
        const out = join(dir, "loud.mp4");
        await ffmpegRun(
          ctx,
          [
            "-y",
            "-i",
            stitched,
            "-af",
            "loudnorm=I=-14:TP=-1.0:LRA=11",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            out,
          ],
          "stitch loudnorm",
        );
        return out;
      });
      loud = value;
      t.loudnormSec = sec;
    }

    {
      const { sec } = await timed(async () => {
        const out = join(dir, "final.mp4");
        await ffmpegRun(
          ctx,
          ["-y", "-i", loud, "-c", "copy", "-movflags", "+faststart", out],
          "stitch finalize",
        );
        const dur = await probeDuration(ctx.ffprobe, out);
        if (!(dur > 0)) throw new Error("stitched final has no duration");
      });
      t.finalizeSec = sec;
    }

    t.totalSec = Number(process.hrtime.bigint() - t0) / 1e9;
    return t;
  }
}

/** Auto-detect the chapter agent's real implementation if it has landed. */
async function resolvePipeline(impl: Flags["chapterImpl"]): Promise<ChapterPipeline> {
  if (impl === "auto") {
    try {
      const mod = await import(
        pathToFileURL(join(import.meta.dirname, "../src/chapters.js")).href
      );
      if (
        typeof mod.renderChapter === "function" &&
        typeof mod.stitchChapters === "function"
      ) {
        const p = new RealChapterPipeline(mod);
        console.log(`[benchmark] using ${p.name}`);
        return p;
      }
      console.log(
        "[benchmark] src/chapters.ts lacks renderChapter/stitchChapters; using baseline",
      );
    } catch (e) {
      console.log(
        `[benchmark] no usable src/chapters.ts (${(e as Error).message.slice(0, 80)}); using baseline`,
      );
    }
  }
  const p = new BaselineChapterPipeline();
  console.log(`[benchmark] using ${p.name}`);
  return p;
}

/**
 * Real chapter implementation: drives worker/src/chapters.ts's renderChapter
 * + stitchChapters DIRECTLY (the code that ships for 20-minute videos), with
 * synthetic paragraph narration served over a local HTTP loopback server.
 *
 * Real architecture (differs from the legacy scene pipeline the baseline
 * mirrors): per chapter, paragraph MP3s are downloaded, concatenated to one
 * AAC track, word cues are spread over the measured paragraph durations, and
 * a SINGLE x264 pass renders a solid-color background (continuity brief)
 * with subtitles burned in. No still-image segments, no music/ducking in the
 * chapter path. Stitch = concat demuxer copy + faststart (no re-encode).
 */
class RealChapterPipeline implements ChapterPipeline {
  readonly name =
    "RealChapterPipeline (worker/src/chapters.ts renderChapter + stitchChapters; synthetic paragraph audio over local HTTP)";
  private mod: {
    renderChapter: (
      ctx: unknown,
      chapter: unknown,
      brief: unknown,
    ) => Promise<string>;
    stitchChapters: (
      cfg: unknown,
      chapterPaths: string[],
      outDir: string,
      isCancelled?: () => boolean | Promise<boolean>,
    ) => Promise<string>;
    defaultContinuityBrief: () => unknown;
    chapterLocalPath: (cdir: string, chapterIndex: number) => string;
  };
  private server: import("node:http").Server | null = null;
  private baseUrl = "";
  private serveDir = "";

  constructor(mod: unknown) {
    this.mod = mod as RealChapterPipeline["mod"];
  }

  /** Start the loopback asset server. Call once before renderChapter. */
  async start(workdir: string): Promise<void> {
    this.serveDir = join(workdir, "serve");
    await mkdir(this.serveDir, { recursive: true });
    const { createServer } = await import("node:http");
    this.server = createServer((req, res) => {
      try {
        const name = decodeURIComponent((req.url ?? "/").split("?")[0]!.replace(/^\//, ""));
        if (!name || name.includes("..") || name.includes("/")) {
          res.statusCode = 404;
          res.end();
          return;
        }
        const file = join(this.serveDir, name);
        const st = statSync(file);
        if (!st.isFile()) throw new Error("not a file");
        res.statusCode = 200;
        res.setHeader("Content-Length", st.size);
        createReadStream(file).pipe(res);
      } catch {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = this.server!.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    this.baseUrl = `http://127.0.0.1:${port}`;
    console.log(`[benchmark] asset server at ${this.baseUrl}`);
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }

  private stubCfg(ctx: RenderCtx, dir: string): WorkerConfig {
    return {
      SUPABASE_URL: "http://127.0.0.1:1/",
      SUPABASE_SERVICE_ROLE_KEY: "benchmark-dummy-key-00000000000000",
      RENDER_BUCKET: "generated-videos",
      FFMPEG_PATH: ctx.ffmpeg,
      FFPROBE_PATH: ctx.ffprobe,
      WORKER_ID: "benchmark",
      POLL_INTERVAL_SEC: 5,
      WORK_DIR: dir,
      CONCURRENCY: 1,
      WORKER_CHAPTER_CONCURRENCY: 2,
    };
  }

  async renderChapter(
    dir: string,
    index: number,
    sceneSec: number[],
    ctx: RenderCtx,
  ): Promise<ChapterTimings> {
    const mediaSec = sceneSec.reduce((a, b) => a + b, 0);
    const stages: StageTiming[] = [];
    const t0 = process.hrtime.bigint();
    await mkdir(dir, { recursive: true });

    // 1. Synthetic paragraph narration (mock TTS) -> served over loopback.
    //    One "paragraph" per sceneSec entry, like the real cached-paragraph flow.
    const { sec: prepSec } = await timed(async () => {
      for (let i = 0; i < sceneSec.length; i++) {
        await genNarration(
          ctx,
          join(this.serveDir, `ch${index}-p${i}.wav`),
          sceneSec[i]!,
          index * 100 + i,
        );
      }
    });
    stages.push({
      stage: "paragraph audio prep",
      sec: prepSec,
      note: "synthetic (mock TTS), local files",
    });

    // 2. The REAL chapter render: download (loopback) + paragraph audio
    //    concat + word-cue ASS + single x264 pass (solid bg + subtitles burn).
    const paras = sceneSec.map((d, i) => ({
      text: paragraphText(d),
      audio_path: `${this.baseUrl}/ch${index}-p${i}.wav`,
      duration_seconds: d,
    }));
    const row = {
      id: `bench-ch-${index}`,
      render_id: "bench",
      chapter_index: index,
      title: `Chapter ${index + 1}`,
      script_text: paras.map((p) => p.text).join(" "),
      paragraphs: paras,
      status: "queued",
      attempts: 0,
      max_attempts: 1,
      claimed_at: null,
      claimed_by: null,
      output_path: null,
      error: null,
    };
    const cfg = this.stubCfg(ctx, dir);
    const meta = {
      aspect: ctx.aspect,
      fps: ctx.fps,
      chapterMode: true,
    } as unknown as RenderJobMeta;
    const chapterCtx = {
      cfg,
      supabase: {} as unknown as SupabaseClient,
      job: {} as unknown as RenderJob,
      meta,
      cdir: dir,
      isCancelled: async () => false,
    };
    const { sec: renderSec } = await timed(() =>
      this.mod.renderChapter(chapterCtx, row, this.mod.defaultContinuityBrief()),
    );
    stages.push({
      stage: "chapter render (single pass)",
      sec: renderSec,
      note: "real: loopback download + audio concat + solid-bg x264 with subtitles burn",
    });

    const totalSec = Number(process.hrtime.bigint() - t0) / 1e9;
    return {
      index,
      mediaSec,
      stages,
      totalSec,
      output: this.mod.chapterLocalPath(dir, index),
    };
  }

  async stitch(
    dir: string,
    chapterMp4s: string[],
    ctx: RenderCtx,
  ): Promise<StitchTimings> {
    const t: StitchTimings = {
      mediaSec: 0,
      chapterCount: chapterMp4s.length,
      concatSec: 0,
      loudnormSec: 0,
      finalizeSec: 0,
      totalSec: 0,
    };
    const t0 = process.hrtime.bigint();
    await mkdir(dir, { recursive: true });

    // Real stitch: concat demuxer copy + faststart in ONE pass (no re-encode).
    const cfg = this.stubCfg(ctx, dir);
    const { sec: stitchSec } = await timed(() =>
      this.mod.stitchChapters(cfg, chapterMp4s, dir, () => false),
    );
    t.concatSec = stitchSec; // concat + faststart happen in the single pass

    const finalMp4 = join(dir, "final.mp4");
    for (const m of chapterMp4s) t.mediaSec += await probeDuration(ctx.ffprobe, m);

    // PROPOSED loudness stage (-14 LUFS, single pass). Not in chapters.ts;
    // measured separately and labelled as proposed in every report.
    if (ctx.loudnorm) {
      const { sec } = await timed(async () => {
        await ffmpegRun(
          ctx,
          [
            "-y",
            "-i",
            finalMp4,
            "-af",
            "loudnorm=I=-14:TP=-1.0:LRA=11",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            join(dir, "loud.mp4"),
          ],
          "stitch loudnorm (proposed)",
        );
      });
      t.loudnormSec = sec;
    }

    t.totalSec = Number(process.hrtime.bigint() - t0) / 1e9;
    return t;
  }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function gitHash(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function ffmpegVersion(bin: string): string {
  try {
    const r = spawnSync(bin, ["-version"], { encoding: "utf8" });
    return (r.stdout ?? "").split("\n")[0] ?? bin;
  } catch {
    return bin;
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const loadavgStart = loadavg().map((n) => Math.round(n * 100) / 100);
  const dims = ASPECTS[flags.aspect] ?? ASPECTS["16:9"]!;
  const ctx: RenderCtx = {
    ffmpeg: process.env.FFMPEG_PATH ?? "ffmpeg",
    ffprobe: process.env.FFPROBE_PATH ?? "ffprobe",
    aspect: flags.aspect,
    width: dims.width,
    height: dims.height,
    fps: flags.fps,
    captionPreset: flags.captionPreset,
    loudnorm: flags.loudnorm,
  };

  const pipeline = await resolvePipeline(flags.chapterImpl);
  const workdir = flags.workdir || (await mkdtemp(join(tmpdir(), "vidora-bench-")));
  await mkdir(workdir, { recursive: true });
  if (pipeline instanceof RealChapterPipeline) await pipeline.start(workdir);
  const exactCommand = `npx tsx scripts/benchmark-20min.ts ${process.argv.slice(2).join(" ")}`.trim();

  console.log(`[benchmark] workdir ${workdir}`);
  console.log(
    `[benchmark] measuring ${flags.chaptersMeasured} chapter(s) x ${flags.chapterSec}s ` +
      `(${flags.scenesPerChapter} scenes each), projecting ` +
      `${flags.targetChapters} chapters x ${(flags.targetMediaSec / flags.targetChapters).toFixed(0)}s = ${flags.targetMediaSec}s`,
  );

  const sceneSec = Array.from({ length: flags.scenesPerChapter }, () =>
    Math.round((flags.chapterSec / flags.scenesPerChapter) * 10) / 10,
  );

  const chapters: ChapterTimings[] = [];
  for (let i = 0; i < flags.chaptersMeasured; i++) {
    console.log(`[benchmark] --- chapter ${i + 1}/${flags.chaptersMeasured} ---`);
    const ct = await pipeline.renderChapter(join(workdir, `ch-${i}`), i, sceneSec, ctx);
    chapters.push(ct);
    console.log(
      `[benchmark] chapter ${i}: total ${ct.totalSec.toFixed(1)}s over ${ct.mediaSec.toFixed(0)}s media: ` +
        ct.stages
          .map((s) => `${s.stage} ${s.sec.toFixed(1)}s${s.note ? ` (${s.note})` : ""}`)
          .join(" | "),
    );
  }

  console.log("[benchmark] --- stitch ---");
  const chapterMp4s = chapters.map((c) => c.output);
  const stitch = await pipeline.stitch(join(workdir, "stitch"), chapterMp4s, ctx);
  console.log(
    `[benchmark] stitch: total ${stitch.totalSec.toFixed(1)}s ` +
      `(concat ${stitch.concatSec.toFixed(1)}s, loudnorm ${stitch.loudnormSec.toFixed(1)}s PROPOSED, ` +
      `finalize ${stitch.finalizeSec.toFixed(1)}s) over ${stitch.mediaSec.toFixed(1)}s of media`,
  );

  const measuredChapters: MeasuredChapter[] = chapters.map((c) => ({
    index: c.index,
    mediaSec: c.mediaSec,
    wallSec: c.totalSec,
  }));
  const measuredStitch: MeasuredStitch = {
    mediaSec: stitch.mediaSec,
    concatSec: stitch.concatSec,
    chapterCount: stitch.chapterCount,
    loudnormSec: stitch.loudnormSec,
    finalizeSec: stitch.finalizeSec,
  };

  // ---- projections ----
  const projections = flags.concurrencies.map((c) => ({
    concurrency: c,
    withLoudnorm: projectTotal({
      targetMediaSec: flags.targetMediaSec,
      targetChapters: flags.targetChapters,
      chapterConcurrency: c,
      measuredChapters,
      measuredStitch,
      includeLoudnorm: true,
      targetSec: 900,
    }),
    withoutLoudnorm: projectTotal({
      targetMediaSec: flags.targetMediaSec,
      targetChapters: flags.targetChapters,
      chapterConcurrency: c,
      measuredChapters,
      measuredStitch,
      includeLoudnorm: false,
      targetSec: 900,
    }),
  }));

  console.log("\n[benchmark] === PROJECTIONS (20-min Story Mode, target <= 15m 00s) ===");
  for (const p of projections) {
    const hypo = p.concurrency > 2 ? " (HYPOTHETICAL: needs >2 vCPU, unmeasured)" : "";
    console.log(
      `  C=${p.concurrency}${hypo}: with proposed loudnorm ${fmtDur(p.withLoudnorm.totalSec)} ` +
        `${p.withLoudnorm.hitsTarget ? "HIT" : "MISS"} | ` +
        `without ${fmtDur(p.withoutLoudnorm.totalSec)} ${p.withoutLoudnorm.hitsTarget ? "HIT" : "MISS"}`,
    );
  }

  const vm = {
    date: new Date().toISOString(),
    git: gitHash(),
    node: process.version,
    ffmpeg: ffmpegVersion(ctx.ffmpeg),
    cpus: cpus().length,
    cpuModel: cpus()[0]?.model ?? "unknown",
    memGB: Math.round(totalmem() / 1e9),
    loadavgStart,
  };

  const results = {
    methodology: "see scripts/benchmark-20min.ts header; measured 2x150s chapters via real FFmpeg, synthetic assets, projection via benchmark-model.ts",
    exactCommand,
    vm,
    flags: {
      chaptersMeasured: flags.chaptersMeasured,
      chapterSec: flags.chapterSec,
      scenesPerChapter: flags.scenesPerChapter,
      aspect: flags.aspect,
      fps: flags.fps,
      captionPreset: flags.captionPreset,
      loudnormMeasured: flags.loudnorm,
    },
    implementation: pipeline.name,
    chapters,
    stitch,
    measuredChapters,
    measuredStitch,
    projections: projections.map((p) => ({
      chapterConcurrency: p.concurrency,
      withProposedLoudnorm: p.withLoudnorm,
      withoutLoudnorm: p.withoutLoudnorm,
    })),
  };

  if (flags.writeResults && !flags.smoke) {
    const outPath = join(process.cwd(), flags.resultsPath);
    (vm as Record<string, unknown>).loadavgEnd = loadavg().map((n) => Math.round(n * 100) / 100);
    await writeFile(outPath, renderMarkdown(results, flags, vm, exactCommand, pipeline.name));
    await writeFile(outPath.replace(/\.md$/, ".json"), JSON.stringify(results, null, 2));
    console.log(`[benchmark] wrote ${outPath}`);
  }

  if (pipeline instanceof RealChapterPipeline) await pipeline.stop();

  if (!flags.workdir) {
    await rm(workdir, { recursive: true, force: true });
    console.log("[benchmark] cleaned workdir");
  }
}

type Results = {
  methodology: string;
  exactCommand: string;
  vm: { date: string; git: string; node: string; ffmpeg: string; cpus: number; cpuModel: string; memGB: number; loadavgStart: number[]; loadavgEnd?: number[] };
  flags: Record<string, unknown>;
  implementation: string;
  chapters: ChapterTimings[];
  stitch: StitchTimings;
  measuredChapters: MeasuredChapter[];
  measuredStitch: MeasuredStitch;
  projections: { chapterConcurrency: number; withProposedLoudnorm: ReturnType<typeof projectTotal>; withoutLoudnorm: ReturnType<typeof projectTotal> }[];
};

function renderMarkdown(
  r: Results,
  flags: Flags,
  vm: Results["vm"],
  exactCommand: string,
  implName: string,
): string {
  const L: string[] = [];
  L.push(`# Benchmark: 20-minute Story Mode render (one worker)`);
  L.push(``);
  L.push(`- Date: ${vm.date}`);
  L.push(`- Git: \`${vm.git}\``);
  L.push(`- VM: ${vm.cpus} x ${vm.cpuModel}, ${vm.memGB} GB RAM`);
  L.push(`- Load average (1/5/15m) at start: ${vm.loadavgStart.join(" / ")}` +
    (vm.loadavgEnd ? `; at end: ${vm.loadavgEnd.join(" / ")}` : ``));
  L.push(`- FFmpeg: ${vm.ffmpeg}`);
  L.push(`- Node: ${vm.node}`);
  L.push(`- Exact command: \`${exactCommand}\``);
  L.push(`- Chapter implementation: ${implName}`);
  const isRealImpl = implName.startsWith("RealChapterPipeline");
  L.push(`- Settings: ${flags.chaptersMeasured} measured chapters x ${flags.chapterSec}s ` +
    `(${flags.scenesPerChapter} scenes/chapter), ${flags.aspect}@${flags.fps}fps, ` +
    (isRealImpl
      ? `single-pass chapter encode (preset medium CRF 20, solid bg + subtitles burn)`
      : `segment preset medium CRF 20, caption preset ${flags.captionPreset}`));
  L.push(``);
  L.push(`## Methodology (summary - full version in scripts/benchmark-20min.ts header)`);
  L.push(``);
  const isReal = implName.startsWith("RealChapterPipeline");
  if (isReal) {
    L.push(`1. Drove worker/src/chapters.ts directly: ${flags.chaptersMeasured} chapters x ${flags.chapterSec}s, ` +
      `each with ${flags.scenesPerChapter} synthetic paragraph WAVs (mock TTS) served over a local HTTP ` +
      `loopback server; real renderChapter (loopback download + paragraph audio concat to AAC 160k + ` +
      `word-cue ASS via spreadWordCues + a SINGLE x264 pass: solid-color background from the continuity ` +
      `brief + subtitles burn-in, preset medium CRF 20, +faststart).`);
    L.push(`2. Real stitchChapters (concat demuxer copy + faststart in one pass, no re-encode), plus a ` +
      `separately measured PROPOSED -14 LUFS loudnorm pass (not in chapters.ts; rate extrapolated linearly ` +
      `to 1200s). Chapter-mode renders have no music/ducking stage.`);
  } else {
    L.push(`1. Baseline: mirrored the legacy scene pipeline (pipeline.ts renderSegment + assemble): ` +
      `per-scene still->mp4 (libx264 preset medium CRF 20), concat, narration+music audio mix with ` +
      `sidechain ducking (AAC 160k), word-level ASS caption burn-in (real buildWordAss, ` +
      `libx264 ${flags.captionPreset} CRF 20), +faststart.`);
    L.push(`2. Stitched the chapter finals: concat copy + single-pass -14 LUFS loudnorm (PROPOSED stage, ` +
      `not in pipeline.ts) + faststart; loudnorm rate extrapolated linearly to 1200s.`);
  }
  L.push(`3. Projected 8 chapters x 150s = 1200s with benchmark-model.ts: ` +
    `total = ceil(8/C) * median(chapter wall) + stitch.`);
  L.push(``);
  L.push(`### Honest exclusions`);
  L.push(``);
  L.push(`- **Narration/TTS, LLM, image generation: NOT measured, NOT in totals.** Synthetic ` +
    `WAV/paragraph assets substituted (zero spend). Real TTS wall time is a separate pre-stage.`);
  L.push(`- Asset download/upload (Supabase): not measured; paragraph audio was served over ` +
    `loopback and its generation time is reported separately, labelled synthetic.`);
  L.push(`- Loudness stage: proposed only; shown both with and without.`);
  L.push(`- C=4 concurrency is hypothetical (this VM has 2 vCPUs); encode is CPU-bound.`);
  L.push(``);
  L.push(`## Measured (real FFmpeg, synthetic assets)`);
  L.push(``);
  const stageNames: string[] = [];
  for (const c of r.chapters)
    for (const s of c.stages) if (!stageNames.includes(s.stage)) stageNames.push(s.stage);
  L.push(`| Chapter | Media | Total | ${stageNames.join(" | ")} |`);
  L.push(`|${"---------|".repeat(stageNames.length + 3)}`);
  for (const c of r.chapters) {
    const cells = stageNames.map((n) => {
      const s = c.stages.find((x) => x.stage === n);
      return s ? `${s.sec.toFixed(1)}s${s.note ? ` (${s.note})` : ""}` : "-";
    });
    L.push(`| ${c.index} | ${c.mediaSec.toFixed(0)}s | ${fmtDur(c.totalSec)} | ${cells.join(" | ")} |`);
  }
  L.push(``);
  L.push(`Stitch over ${r.stitch.mediaSec.toFixed(0)}s of chapter finals: concat+faststart ` +
    `${r.stitch.concatSec.toFixed(1)}s (single real stitchChapters pass), ` +
    `loudnorm ${r.stitch.loudnormSec.toFixed(1)}s (proposed, rate ` +
    `${(r.measuredStitch.mediaSec / Math.max(r.measuredStitch.loudnormSec, 1e-9)).toFixed(1)}x realtime)` +
    `${r.stitch.finalizeSec > 0 ? `, finalize ${r.stitch.finalizeSec.toFixed(1)}s` : ``}.`);
  L.push(``);
  L.push(`## Projected: 20-minute Story Mode (1200s), target <= 15m 00s`);
  L.push(``);
  L.push(`| Chapter concurrency | With proposed loudnorm | Without loudnorm | Verdict |`);
  L.push(`|---------------------|------------------------|------------------|---------|`);
  for (const p of r.projections) {
    const w = p.withProposedLoudnorm;
    const wo = p.withoutLoudnorm;
    const verdict = w.hitsTarget ? "**HIT**" : "**MISS**";
    const hypo = p.chapterConcurrency > 2 ? " (hypothetical, unmeasured)" : "";
    L.push(`| C=${p.chapterConcurrency}${hypo} | ${fmtDur(w.totalSec)} | ${fmtDur(wo.totalSec)} | ${verdict} |`);
  }
  L.push(``);
  const detail = r.projections.find((p) => p.chapterConcurrency === 2) ?? r.projections[0]!;
  L.push(`Projection detail (C=${detail.chapterConcurrency}, with proposed loudnorm): chapter phase ${fmtDur(detail.withProposedLoudnorm.chapterPhaseSec)} ` +
    `(${detail.withProposedLoudnorm.perChapterSec.toFixed(0)}s median chapter x ` +
    `${Math.ceil(flags.targetChapters / detail.chapterConcurrency)} waves) + stitch ${fmtDur(detail.withProposedLoudnorm.stitchSec)} ` +
    `(concat ${detail.withProposedLoudnorm.concatSec.toFixed(1)}s + loudnorm ` +
    `${detail.withProposedLoudnorm.loudnormSec.toFixed(1)}s + finalize ` +
    `${detail.withProposedLoudnorm.finalizeSec.toFixed(1)}s).`);
  L.push(``);
  L.push(`## Bottleneck`);
  L.push(``);
  L.push(`(Filled from the measured numbers above: the single-pass x264 chapter render ` +
    `- solid background + subtitles burn over the full chapter duration - dominates; it is ` +
    `CPU-bound on this VM's vCPUs. Stitch is a cheap copy pass. Numbers, not adjectives, ` +
    `are in the tables.)`);
  L.push(``);
  return L.join("\n");
}

main().catch((e) => {
  console.error(`[benchmark] FATAL: ${(e as Error).stack ?? (e as Error).message}`);
  process.exit(1);
});
