/**
 * Sprint 3-4: chapter/segment rendering for long-form videos.
 *
 * A chapter-mode parent render (`meta.chapterMode === true`) is rendered as
 * chapters, not one monolith:
 *
 *   1. Chapters are loaded from `render_chapters` (created at enqueue time by
 *      `enqueueChapterRender`; see src/lib/chapters/).
 *   2. Chapters in `done` whose output MP4 is still downloadable from storage
 *      are skipped — this is the crash-resume checkpoint.
 *   3. Remaining chapters render concurrently (WORKER_CHAPTER_CONCURRENCY),
 *      each as a self-contained MP4: solid-brand-background video +
 *      cached paragraph narration + burned word captions. Every chapter gets
 *      the IDENTICAL continuity-brief object, so voice/pacing/visuals match.
 *   4. Finished chapter MP4s are concatenated with `-c copy` (no re-encode —
 *      all chapters share codec params) into the final video.
 *
 * Chapter rows carry their own status/attempts/claim lease, mirroring the
 * job-level claim/heartbeat/requeue machinery: `requeue_stale_chapters`
 * sends `rendering` chapters with an expired lease back to `queued`
 * (retry budget respected), and each rendering chapter's lease is refreshed
 * while it renders.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkerConfig } from "./config.js";
import { FFmpegCancelled, probeDuration, runFFmpeg } from "./ffmpeg.js";
import {
  ASPECTS,
  buildWordAss,
  downloadTo,
  resolveAssetUrl,
  spreadFallback,
} from "./pipeline.js";
import type {
  ContinuityBrief,
  RenderJob,
  RenderJobMeta,
  StageId,
} from "./types.js";

export const CHAPTER_LEASE_SECONDS = 300;

export type ChapterParagraph = {
  text: string;
  audio_path: string | null;
  duration_seconds: number | null;
};

export type ChapterStatus = "queued" | "rendering" | "done" | "failed";

export type ChapterRow = {
  id: string;
  render_id: string;
  chapter_index: number;
  title: string;
  script_text: string;
  paragraphs: ChapterParagraph[];
  status: ChapterStatus;
  attempts: number;
  max_attempts: number;
  claimed_at: string | null;
  claimed_by: string | null;
  output_path: string | null;
  error: string | null;
};

export type ChapterDriverCtx = {
  cfg: WorkerConfig;
  supabase: SupabaseClient;
  job: RenderJob;
  meta: RenderJobMeta;
  dir: string;
  hooks: {
    onStage: (stage: StageId, progress: number, detail?: string) => Promise<void>;
    isCancelled: () => Promise<boolean>;
  };
};

export type ChapterRenderCtx = {
  cfg: WorkerConfig;
  supabase: SupabaseClient;
  job: RenderJob;
  meta: RenderJobMeta;
  /** Directory where chapter-N.mp4 files are written. */
  cdir: string;
  isCancelled: () => Promise<boolean>;
  onChapterProgress?: (chapterIndex: number, detail: string) => Promise<void>;
};

export type RenderChapterFn = (
  ctx: ChapterRenderCtx,
  chapter: ChapterRow,
  brief: ContinuityBrief,
) => Promise<string>;

// ── Chapter row state ─────────────────────────────────────────────────────

export async function loadChapters(
  supabase: SupabaseClient,
  renderId: string,
): Promise<ChapterRow[]> {
  const { data, error } = await supabase
    .from("render_chapters")
    .select("*")
    .eq("render_id", renderId)
    .order("chapter_index", { ascending: true });
  if (error) throw new Error(`loadChapters failed: ${error.message}`);
  return (data ?? []) as ChapterRow[];
}

export async function claimChapter(
  supabase: SupabaseClient,
  chapterId: string,
  workerId: string,
): Promise<void> {
  const { error } = await supabase
    .from("render_chapters")
    .update({
      status: "rendering",
      claimed_at: new Date().toISOString(),
      claimed_by: workerId,
      started_at: new Date().toISOString(),
      error: null,
    })
    .eq("id", chapterId);
  if (error) throw new Error(`claimChapter failed: ${error.message}`);
}

/** Refresh a rendering chapter's lease so it isn't reclaimed mid-render. */
export async function touchChapterClaim(
  supabase: SupabaseClient,
  chapterId: string,
): Promise<void> {
  const { error } = await supabase
    .from("render_chapters")
    .update({ claimed_at: new Date().toISOString() })
    .eq("id", chapterId)
    .eq("status", "rendering");
  if (error) throw new Error(`touchChapterClaim failed: ${error.message}`);
}

export async function completeChapter(
  supabase: SupabaseClient,
  chapterId: string,
  outputPath: string,
): Promise<void> {
  const { error } = await supabase
    .from("render_chapters")
    .update({
      status: "done",
      finished_at: new Date().toISOString(),
      output_path: outputPath,
      claimed_at: null,
      claimed_by: null,
      error: null,
    })
    .eq("id", chapterId);
  if (error) throw new Error(`completeChapter failed: ${error.message}`);
}

/**
 * Record a failed chapter attempt. Returns the new status: `queued` when
 * retries remain, `failed` (terminal) when the budget is exhausted.
 */
export async function failChapterAttempt(
  supabase: SupabaseClient,
  chapter: ChapterRow,
  message: string,
): Promise<ChapterStatus> {
  const attempts = chapter.attempts + 1;
  const status: ChapterStatus = attempts >= chapter.max_attempts ? "failed" : "queued";
  const { error } = await supabase
    .from("render_chapters")
    .update({
      status,
      attempts,
      claimed_at: null,
      claimed_by: null,
      error: message.slice(0, 1000),
    })
    .eq("id", chapter.id);
  if (error) throw new Error(`failChapterAttempt failed: ${error.message}`);
  return status;
}

/** A `done` chapter whose output is gone from storage must render again. */
export async function resetChapterToQueued(
  supabase: SupabaseClient,
  chapterId: string,
): Promise<void> {
  const { error } = await supabase
    .from("render_chapters")
    .update({
      status: "queued",
      output_path: null,
      finished_at: null,
      started_at: null,
      claimed_at: null,
      claimed_by: null,
      error: null,
    })
    .eq("id", chapterId);
  if (error) throw new Error(`resetChapterToQueued failed: ${error.message}`);
}

// ── Work planning (pure) ──────────────────────────────────────────────────

export type ChapterPlan = {
  /** Chapters that still need rendering. */
  toRender: ChapterRow[];
  /** Chapters skipped: done with a usable output file. */
  toReuse: ChapterRow[];
  /** Terminally failed chapters — the driver must fail the parent render. */
  failed: ChapterRow[];
};

/**
 * Decide what a driver pass must do. `usableOutputIds` holds the ids of
 * `done` chapters whose output MP4 was verified downloadable (the resume
 * checkpoint). Pure — unit-tested without ffmpeg or a database.
 */
export function planChapterWork(
  chapters: ChapterRow[],
  usableOutputIds: Set<string>,
): ChapterPlan {
  const toRender: ChapterRow[] = [];
  const toReuse: ChapterRow[] = [];
  const failed: ChapterRow[] = [];
  for (const c of chapters) {
    if (c.status === "failed") failed.push(c);
    else if (c.status === "done" && usableOutputIds.has(c.id)) toReuse.push(c);
    else toRender.push(c);
  }
  return { toRender, toReuse, failed };
}

/** Run `fn` over items with at most `limit` in flight. Rejects on first error. */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const n = Math.max(1, Math.min(Math.max(1, limit), items.length));
  let next = 0;
  const workers = Array.from({ length: n }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i]!);
    }
  });
  await Promise.all(workers);
}

// ── Chapter rendering ─────────────────────────────────────────────────────

export function chapterStoragePath(job: RenderJob, chapterIndex: number): string {
  return `${job.user_id}/renders/${job.id}/chapters/${chapterIndex}.mp4`;
}

export function chapterLocalPath(cdir: string, chapterIndex: number): string {
  return join(cdir, `chapter-${chapterIndex}.mp4`);
}

async function downloadChapterOutput(
  supabase: SupabaseClient,
  bucket: string,
  storagePath: string,
  dest: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase.storage.from(bucket).download(storagePath);
    if (error || !data) return false;
    const buf = Buffer.from(await data.arrayBuffer());
    if (buf.length < 1024) return false;
    await writeFile(dest, buf);
    return true;
  } catch {
    return false;
  }
}

async function uploadChapterOutput(
  supabase: SupabaseClient,
  bucket: string,
  storagePath: string,
  localPath: string,
): Promise<void> {
  const buf = await readFile(localPath);
  const { error } = await supabase.storage.from(bucket).upload(
    storagePath,
    new Blob([buf], { type: "video/mp4" }),
    { contentType: "video/mp4", upsert: true },
  );
  if (error) throw new Error(`Chapter upload failed: ${error.message}`);
}

/** Defensive fallback when a chapter-mode row has no brief in meta. */
export function defaultContinuityBrief(): ContinuityBrief {
  return {
    version: 1,
    voice: { id: "default", languageCode: "en", model: "eleven_flash_v2_5" },
    pacing: { wordsPerMinute: 150 },
    visuals: {
      background: { type: "solid", color: "0x17130e" },
      captionStyle: { font: "Inter", fontSize: 64, primaryColor: "&H00FFFFFF" },
    },
    tone: "",
  };
}

function estimateSeconds(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, (words / 150) * 60);
}

/**
 * Render one chapter to a self-contained MP4: solid-background video at the
 * job's aspect/fps, the chapter's cached paragraph narration concatenated
 * into one audio track, and word-level captions burned in.
 *
 * Codec params are identical for every chapter (libx264 medium crf 20 +
 * AAC 160k) so stitching is a `-c copy` concat with no re-encode.
 */
export async function renderChapter(
  ctx: ChapterRenderCtx,
  chapter: ChapterRow,
  brief: ContinuityBrief,
): Promise<string> {
  const { cfg, supabase, meta, cdir, isCancelled } = ctx;
  const out = chapterLocalPath(cdir, chapter.chapter_index);
  const workdir = join(cdir, `work-${chapter.chapter_index}`);
  await mkdir(workdir, { recursive: true });

  const paras = chapter.paragraphs.filter((p) => p.audio_path);
  if (paras.length === 0) {
    throw new Error(`Chapter ${chapter.chapter_index} has no narration audio`);
  }

  // 1. Download paragraph narration; measure real durations with ffprobe.
  const clips: { path: string; dur: number }[] = [];
  for (let i = 0; i < paras.length; i++) {
    if (await isCancelled()) throw new FFmpegCancelled();
    const p = paras[i]!;
    const dest = join(workdir, `p-${i}.mp3`);
    await downloadTo(await resolveAssetUrl(supabase, cfg.RENDER_BUCKET, p.audio_path!), dest);
    const measured = await probeDuration(cfg.FFPROBE_PATH, dest).catch(() => NaN);
    const dur =
      Number.isFinite(measured) && measured > 0
        ? measured
        : p.duration_seconds && p.duration_seconds > 0
          ? p.duration_seconds
          : estimateSeconds(p.text);
    clips.push({ path: dest, dur });
  }
  const total = clips.reduce((a, c) => a + c.dur, 0);
  if (!(total > 0)) throw new Error(`Chapter ${chapter.chapter_index}: zero narration duration`);

  // 2. Concatenate paragraph clips into one chapter audio track.
  const chapterAudio = join(workdir, "chapter.m4a");
  const audioInputs: string[] = [];
  const labels: string[] = [];
  clips.forEach((c, i) => {
    audioInputs.push("-i", c.path);
    labels.push(`[${i}:a]`);
  });
  await runFFmpeg({
    ffmpegPath: cfg.FFMPEG_PATH,
    args: [
      "-y",
      ...audioInputs,
      "-filter_complex",
      `${labels.join("")}concat=n=${clips.length}:v=0:a=1[aout]`,
      "-map",
      "[aout]",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-progress",
      "pipe:2",
      chapterAudio,
    ],
    isCancelled,
  });

  // 3. Word-level captions spread over the measured paragraph durations.
  const cues: { word: string; start: number; end: number }[] = [];
  let t = 0;
  for (let i = 0; i < paras.length; i++) {
    for (const w of spreadFallback(paras[i]!.text, clips[i]!.dur)) {
      cues.push({ word: w.word, start: w.start + t, end: w.end + t });
    }
    t += clips[i]!.dur;
  }
  const assPath = join(workdir, "captions.ass");
  await writeFile(assPath, buildWordAss(cues, brief.visuals.captionStyle.fontSize));

  // 4. One pass: background video + narration + burned captions.
  const dims = ASPECTS[meta.aspect] ?? ASPECTS["16:9"]!;
  await runFFmpeg({
    ffmpegPath: cfg.FFMPEG_PATH,
    args: [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=${brief.visuals.background.color}:s=${dims.width}x${dims.height}:r=${meta.fps}:d=${total.toFixed(2)}`,
      "-i",
      chapterAudio,
      "-vf",
      `subtitles=${assPath.replace(/'/g, "'\\''")}`,
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "20",
      "-r",
      String(meta.fps),
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-shortest",
      "-movflags",
      "+faststart",
      "-progress",
      "pipe:2",
      out,
    ],
    isCancelled,
    onProgress: (p) => {
      void ctx.onChapterProgress?.(chapter.chapter_index, `${p.outTimeSec.toFixed(0)}s`);
    },
  });

  const dur = await probeDuration(cfg.FFPROBE_PATH, out);
  if (!(dur > 0)) throw new Error(`Chapter ${chapter.chapter_index}: output has no duration`);
  return out;
}

/**
 * Stitch finished chapter MP4s into the final video.
 * Concat demuxer + `-c copy`: no re-encode (identical codec params), with
 * +faststart for streaming. Throws when a chapter output is missing/empty.
 */
export async function stitchChapters(
  cfg: WorkerConfig,
  chapterPaths: string[],
  outDir: string,
  isCancelled?: () => boolean | Promise<boolean>,
): Promise<string> {
  if (chapterPaths.length === 0) throw new Error("Nothing to stitch: no chapter outputs");
  for (const p of chapterPaths) {
    const st = await stat(p).catch(() => null);
    if (!st || st.size < 1024) throw new Error(`Chapter output missing or empty: ${p}`);
  }
  const listPath = join(outDir, "chapters-concat.txt");
  await writeFile(
    listPath,
    chapterPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
  );
  const final = join(outDir, "final.mp4");
  await runFFmpeg({
    ffmpegPath: cfg.FFMPEG_PATH,
    args: [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      "-progress",
      "pipe:2",
      final,
    ],
    isCancelled,
  });
  const dur = await probeDuration(cfg.FFPROBE_PATH, final);
  if (!(dur > 0)) throw new Error("Stitched MP4 has no duration");
  return final;
}

// ── Driver ────────────────────────────────────────────────────────────────

export type ChapterDriverDeps = {
  /** Injectable for tests (records briefs, skips ffmpeg). */
  renderOne?: RenderChapterFn;
};

/**
 * Full chapter-mode pipeline for one claimed job. Returns the final MP4 path.
 *
 * Resume semantics: `done` chapters with a downloadable output are skipped;
 * `rendering` chapters with an expired lease are requeued by
 * `requeue_stale_chapters` before planning. Chapter-only re-renders work the
 * same way: only the reset chapter is `queued`, the rest are skipped.
 */
export async function runChapterPipeline(
  ctx: ChapterDriverCtx,
  deps?: ChapterDriverDeps,
): Promise<string> {
  const { cfg, supabase, job, meta, dir, hooks } = ctx;
  const renderOne = deps?.renderOne ?? renderChapter;
  const cdir = join(dir, "chapters");
  await mkdir(cdir, { recursive: true });

  // Crash recovery for this render's chapters (mirrors job-level requeue).
  await supabase
    .rpc("requeue_stale_chapters", { p_lease_seconds: CHAPTER_LEASE_SECONDS })
    .then(
      () => {},
      (e: unknown) =>
        console.error(`[worker] requeue_stale_chapters failed: ${(e as Error).message}`),
    );

  let chapters = await loadChapters(supabase, job.id);
  if (chapters.length === 0) throw new Error("chapterMode render has no chapters");

  // The single brief for this render — passed by reference to every chapter.
  const brief = meta.continuityBrief ?? defaultContinuityBrief();

  // Resume checkpoint: re-download usable outputs of finished chapters.
  const usable = new Set<string>();
  for (const ch of chapters) {
    if (ch.status !== "done" || !ch.output_path) continue;
    const dest = chapterLocalPath(cdir, ch.chapter_index);
    await hooks.onStage("segments", 0, `Chapter ${ch.chapter_index}: checking checkpoint`);
    if (await downloadChapterOutput(supabase, cfg.RENDER_BUCKET, ch.output_path, dest)) {
      usable.add(ch.id);
    } else {
      // Output lost (e.g. storage cleaned) — render this chapter again.
      await resetChapterToQueued(supabase, ch.id);
    }
  }

  const total = chapters.length;
  let doneCount = [...usable].length;

  while (true) {
    chapters = await loadChapters(supabase, job.id);
    const plan = planChapterWork(chapters, usable);
    if (plan.failed.length > 0) {
      const f = plan.failed[0]!;
      throw new Error(`Chapter ${f.chapter_index} failed: ${f.error ?? "unknown error"}`);
    }
    if (plan.toRender.length === 0) break;
    if (await hooks.isCancelled()) throw new FFmpegCancelled();

    let terminal: { index: number; error: string } | null = null;
    const chapterCtx: ChapterRenderCtx = {
      cfg,
      supabase,
      job,
      meta,
      cdir,
      isCancelled: () => hooks.isCancelled(),
      onChapterProgress: async (chapterIndex, detail) => {
        await hooks.onStage(
          "segments",
          ((doneCount / total) * 100),
          `Chapter ${chapterIndex}/${total} ${detail}`,
        );
      },
    };

    await runWithConcurrency(plan.toRender, cfg.WORKER_CHAPTER_CONCURRENCY, async (ch) => {
      await claimChapter(supabase, ch.id, cfg.WORKER_ID);
      const leaseTimer = setInterval(() => {
        void touchChapterClaim(supabase, ch.id).catch(() => {});
      }, 30_000);
      try {
        if (await hooks.isCancelled()) throw new FFmpegCancelled();
        const mp4 = await renderOne(chapterCtx, ch, brief);
        const storagePath = chapterStoragePath(job, ch.chapter_index);
        await uploadChapterOutput(supabase, cfg.RENDER_BUCKET, storagePath, mp4);
        // renderOne writes to chapterLocalPath(cdir, index) by contract;
        // if an injected renderer wrote elsewhere, the upload above used
        // its return value — nothing more to do.
        await completeChapter(supabase, ch.id, storagePath);
        usable.add(ch.id);
        doneCount++;
        await hooks.onStage(
          "segments",
          (doneCount / total) * 100,
          `Chapter ${ch.chapter_index}/${total} done`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof FFmpegCancelled) throw err;
        const status = await failChapterAttempt(supabase, ch, message);
        if (status === "failed") terminal = { index: ch.chapter_index, error: message };
        // `queued` chapters are retried by the outer loop.
      } finally {
        clearInterval(leaseTimer);
      }
    });

    if (terminal) {
      const t = terminal as { index: number; error: string };
      throw new Error(`Chapter ${t.index} failed: ${t.error}`);
    }
  }

  // Stitch all chapters in index order.
  await hooks.onStage("combine", 0, "Stitching chapters");
  chapters = await loadChapters(supabase, job.id);
  const ordered = [...chapters].sort((a, b) => a.chapter_index - b.chapter_index);
  const paths = ordered.map((ch) => chapterLocalPath(cdir, ch.chapter_index));
  return stitchChapters(cfg, paths, dir, () => hooks.isCancelled());
}
