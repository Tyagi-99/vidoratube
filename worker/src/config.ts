import { z } from "zod";

const ConfigSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  /** Storage bucket for inputs/outputs. */
  RENDER_BUCKET: z.string().default("generated-videos"),
  /** Path to the ffmpeg binary. */
  FFMPEG_PATH: z.string().default("ffmpeg"),
  /** Path to the ffprobe binary. */
  FFPROBE_PATH: z.string().default("ffprobe"),
  /** Unique ID for this worker instance (hostname:pid default). */
  WORKER_ID: z.string().default(""),
  /** Seconds between queue polls when idle. */
  POLL_INTERVAL_SEC: z.coerce.number().int().min(1).max(300).default(5),
  /** Working directory for downloads/segments. */
  WORK_DIR: z.string().default("/tmp/vidora-worker"),
  /** Max concurrent jobs for this worker (1 = sequential). */
  CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  /**
   * Max chapters rendered concurrently within one chapter-mode job.
   * Chapter renders are CPU/ffmpeg-bound; 2-3 is the sane default.
   */
  WORKER_CHAPTER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
});

export type WorkerConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(): WorkerConfig {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`[worker] Invalid configuration: ${issues}`);
  }
  const cfg = parsed.data;
  if (!cfg.WORKER_ID) {
    cfg.WORKER_ID = `${process.env.HOSTNAME ?? "worker"}:${process.pid}`;
  }
  return cfg;
}
