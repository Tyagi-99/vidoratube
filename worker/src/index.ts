/**
 * VidoraTube server render worker.
 *
 * Polls the `renders` table for queued `server_ffmpeg` jobs, claims them
 * atomically, renders with native FFmpeg, uploads the MP4, and marks the job
 * done. Survives restarts: crashed jobs are reclaimed via the claim lease.
 *
 *   npm run dev    — watch mode (tsx)
 *   npm run build && npm start
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Optional: RENDER_BUCKET, FFMPEG_PATH, FFPROBE_PATH, WORKER_ID,
 *           POLL_INTERVAL_SEC, WORK_DIR, CONCURRENCY.
 */
import { mkdir, rm } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadConfig, type WorkerConfig } from "./config.js";
import { probeDuration } from "./ffmpeg.js";
import { jobDir, runPipeline } from "./pipeline.js";
import {
  claimJob,
  createServiceClient,
  finishJob,
  heartbeat,
  reportWorkerHeartbeat,
  requeueStaleJobs,
  shouldCancel,
} from "./supabase.js";
import { RenderJobMetaSchema, type RenderJob, type StageId } from "./types.js";

const LEASE_SECONDS = 300;

let shuttingDown = false;
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    console.log(`[worker] ${sig} received — finishing current stage then exiting`);
    shuttingDown = true;
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function processJob(cfg: WorkerConfig, supabase: SupabaseClient, job: RenderJob): Promise<void> {
  const dir = jobDir(cfg.WORK_DIR, job.id);
  console.log(`[worker] processing job ${job.id} (attempt ${job.attempts}/${job.max_attempts})`);

  const metaParse = RenderJobMetaSchema.safeParse(job.meta);
  if (!metaParse.success) {
    await finishJob(supabase, job.id, {
      status: "failed",
      error: `Invalid job payload: ${metaParse.error.issues.map((i) => i.message).join("; ")}`,
    });
    return;
  }
  const meta = metaParse.data;

  let cancelled = false;
  const hooks = {
    onStage: async (stage: StageId, progress: number, detail?: string) => {
      // Map pipeline stages (0-100 each) onto an overall progress bar.
      const weights: Record<StageId, [number, number]> = {
        claimed: [0, 2],
        assets: [2, 12],
        segments: [12, 62],
        combine: [62, 70],
        audio: [70, 80],
        captions: [80, 90],
        finalize: [90, 96],
        upload: [96, 100],
        done: [100, 100],
      };
      const [lo, hi] = weights[stage] ?? [0, 100];
      const overall = lo + ((hi - lo) * Math.min(100, Math.max(0, progress))) / 100;
      await heartbeat(supabase, job.id, cfg.WORKER_ID, detail ? `${stage}: ${detail}` : stage, overall);
    },
    isCancelled: async () => {
      if (shuttingDown || cancelled) return true;
      const c = await shouldCancel(supabase, job.id).catch(() => false);
      if (c) cancelled = true;
      return cancelled;
    },
  };

  try {
    const finalMp4 = await runPipeline({ cfg, supabase, job, meta, dir, hooks });

    if (await hooks.isCancelled()) {
      await finishJob(supabase, job.id, { status: "cancelled", error: "Cancelled by user" });
      return;
    }

    // Upload
    await hooks.onStage("upload", 0, "Uploading MP4");
    const storagePath = `${job.user_id}/renders/${job.id}.mp4`;
    const { error: upErr } = await supabase.storage
      .from(cfg.RENDER_BUCKET)
      .upload(storagePath, await BunOrNodeFile(finalMp4), {
        contentType: "video/mp4",
        upsert: true,
      });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

    const { data: signed } = await supabase.storage
      .from(cfg.RENDER_BUCKET)
      .createSignedUrl(storagePath, 60 * 60 * 24 * 7);

    const { size } = await import("node:fs/promises").then((m) => m.stat(finalMp4));
    const duration = await probeDuration(cfg.FFPROBE_PATH, finalMp4).catch(() => null);
    const dims = { "16:9": "1920x1080", "9:16": "1080x1920", "1:1": "1080x1080" } as const;

    await finishJob(supabase, job.id, {
      status: "completed",
      file_url: signed?.signedUrl ?? null,
      file_size: size,
      duration,
      resolution: dims[meta.aspect as keyof typeof dims] ?? dims["16:9"],
      checkpoint: { storagePath },
    });
    console.log(`[worker] job ${job.id} completed (${size} bytes)`);
  } catch (err) {
    const isCancel = (err as Error)?.name === "FFmpegCancelled" || cancelled || shuttingDown;
    if (isCancel) {
      await finishJob(supabase, job.id, { status: "cancelled", error: "Cancelled" });
      console.log(`[worker] job ${job.id} cancelled`);
    } else {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[worker] job ${job.id} failed: ${message}`);
      // Retry: back to queued if attempts remain; else failed.
      if (job.attempts < job.max_attempts) {
        await supabase
          .from("renders")
          .update({ status: "queued", stage: "queued", claimed_at: null, claimed_by: null, error: message })
          .eq("id", job.id);
        console.log(`[worker] job ${job.id} requeued for retry`);
      } else {
        await finishJob(supabase, job.id, { status: "failed", error: message.slice(0, 1000) });
      }
    }
  } finally {
    // Keep the work dir on failure for debugging; clean up on success handled above.
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Node 20-compatible file upload body. */
async function BunOrNodeFile(path: string): Promise<Blob> {
  const { readFile } = await import("node:fs/promises");
  const buf = await readFile(path);
  return new Blob([buf], { type: "video/mp4" });
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const supabase = createServiceClient(cfg);
  await mkdir(cfg.WORK_DIR, { recursive: true });
  console.log(`[worker] ${cfg.WORKER_ID} started — bucket=${cfg.RENDER_BUCKET} ffmpeg=${cfg.FFMPEG_PATH}`);

  // Crash recovery on boot.
  const requeued = await requeueStaleJobs(supabase, LEASE_SECONDS).catch((e) => {
    console.error("[worker] requeue failed:", (e as Error).message);
    return 0;
  });
  if (requeued > 0) console.log(`[worker] reclaimed ${requeued} stale job(s)`);

  // Independent liveness signal (see worker_heartbeats migration): heartbeat
  // on boot and every minute, so the app sees an idle worker as online even
  // before it has ever claimed a job. Failures are logged, never fatal —
  // a heartbeat outage must not stop rendering.
  const beat = () =>
    reportWorkerHeartbeat(supabase, cfg.WORKER_ID).catch((e) =>
      console.error("[worker] heartbeat failed:", (e as Error).message),
    );
  await beat();
  const beatTimer = setInterval(beat, 60_000);
  beatTimer.unref?.();

  while (!shuttingDown) {
    try {
      const job = await claimJob(supabase, cfg.WORKER_ID);
      if (!job) {
        await sleep(cfg.POLL_INTERVAL_SEC * 1000);
        continue;
      }
      await processJob(cfg, supabase, job);
    } catch (err) {
      console.error("[worker] loop error:", (err as Error).message);
      await sleep(cfg.POLL_INTERVAL_SEC * 1000);
    }
  }
  clearInterval(beatTimer);
  console.log("[worker] shutdown complete");
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
