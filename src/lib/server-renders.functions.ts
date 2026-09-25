import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "./server-auth";

/**
 * Server-side render job management (P2).
 *
 * The browser FFmpeg.wasm path (renders.functions.ts) stays as the fast
 * fallback. These functions enqueue jobs for the native-FFmpeg server worker
 * (`worker/`), which picks them up via the `claim_render_job` RPC.
 */

const WordCueSchema = z.object({
  word: z.string().max(100),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
});

const SceneSchema = z.object({
  id: z.string().max(100),
  number: z.number().int().nonnegative(),
  narration: z.string().max(5000).default(""),
  /** Storage path or https URL to the scene image. */
  image: z.string().max(500).nullable().default(null),
  /** Storage path or https URL to the scene narration audio. */
  audio: z.string().max(500).nullable().default(null),
  duration: z.number().positive().max(600),
  cues: z.array(WordCueSchema).max(2000).default([]),
});

const EnqueueSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().max(200).default("Untitled video"),
  scenes: z.array(SceneSchema).min(1).max(200),
  aspect: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
  fps: z.number().int().min(24).max(60).default(30),
  burnCaptions: z.boolean().default(true),
  musicUrl: z.string().max(500).nullable().default(null),
  musicVolume: z.number().min(0).max(1).default(0.15),
  musicDucking: z.boolean().default(true),
  voiceoverUrl: z.string().max(500).nullable().default(null),
});

/** Enqueue a server-side render. Rate-limited: 10/hour per user. */
export const enqueueServerRender = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => EnqueueSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { enforcePostgresRateLimit } = await import("./rate-limit");
    await enforcePostgresRateLimit(
      supabaseAdmin,
      `render:server:${userId}`,
      { max: 10, windowSeconds: 3600 },
      "You're starting server renders too fast. Please wait a bit and try again.",
    );

    // Project must exist and belong to the user.
    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("id", data.projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!project) throw new Error("Project not found");

    // Every scene needs an image — the worker can't render without visuals.
    const missing = data.scenes.filter((s) => !s.image);
    if (missing.length > 0) {
      throw new Error(`${missing.length} scene(s) are missing visuals. Generate images first.`);
    }

    // P7: reserve per-minute render credits BEFORE creating the job, so a
    // failed reserve never leaves an orphan queued render. Idempotent per
    // render id; settled to actual cost by finalize_render_billing.
    const { randomUUID } = await import("node:crypto");
    const renderId = randomUUID();
    const { reserveRenderBilling } = await import("./billing.functions");
    await reserveRenderBilling(
      supabaseAdmin,
      userId,
      renderId,
      10, // DEFAULT_RENDER_RESERVE_MINUTES
    );

    const { data: row, error } = await supabase
      .from("renders")
      .insert({
        id: renderId,
        user_id: userId,
        project_id: data.projectId,
        type: "full",
        engine: "server_ffmpeg",
        format: "mp4",
        status: "queued",
        stage: "queued",
        progress: 0,
        aspect_ratio: data.aspect,
        resolution:
          data.aspect === "16:9" ? "1920x1080" : data.aspect === "9:16" ? "1080x1920" : "1080x1080",
        reserved_minutes: 10,
        meta: {
          scenes: data.scenes,
          title: data.title,
          aspect: data.aspect,
          fps: data.fps,
          burnCaptions: data.burnCaptions,
          musicUrl: data.musicUrl,
          musicVolume: data.musicVolume,
          musicDucking: data.musicDucking,
          voiceoverUrl: data.voiceoverUrl,
        },
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

/** Request graceful cancellation of a server render. */
export const cancelServerRender = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // If the worker hasn't claimed it yet, cancel immediately.
    const { data: row } = await supabase
      .from("renders")
      .select("id,status")
      .eq("id", data.id)
      .eq("user_id", userId)
      .eq("engine", "server_ffmpeg")
      .maybeSingle();
    if (!row) throw new Error("Render not found");
    if (row.status === "queued") {
      const { error } = await supabase
        .from("renders")
        .update({ status: "cancelled", stage: "cancelled", error: "Cancelled by user" })
        .eq("id", data.id)
        .eq("user_id", userId)
        .eq("status", "queued");
      if (error) throw new Error(error.message);
    } else if (row.status === "running") {
      // The worker polls cancel_requested between stages.
      const { error } = await supabase
        .from("renders")
        .update({ cancel_requested: true })
        .eq("id", data.id)
        .eq("user_id", userId)
        .eq("status", "running");
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

/** List server render jobs for a project (for the queue UI). */
export const listServerRenders = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ projectId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("renders")
      .select("id,status,stage,progress,aspect_ratio,resolution,file_url,error,created_at,render_started_at,render_completed_at")
      .eq("project_id", data.projectId)
      .eq("user_id", context.userId)
      .eq("engine", "server_ffmpeg")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/**
 * Feature-detection for the native-FFmpeg server worker.
 *
 * Returns available=true when a worker has reported an idle heartbeat within
 * the last 15 minutes (see the worker_heartbeats migration). This is
 * independent of jobs: a freshly deployed worker heartbeats on boot, so the
 * app sees it as online before it has ever claimed a render — fixing the
 * bootstrap deadlock where "offline" meant no server renders were ever
 * enqueued and the worker could never prove itself alive.
 *
 * The old job-claim signal is kept as a fallback so workers running an older
 * build (no heartbeat loop yet) still register as available.
 */
export const getServerWorkerStatus = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .handler(async () => {
    // Global infrastructure signal (not user data): service-role read of the
    // latest worker heartbeat. requireAppUser still gates the endpoint to
    // logged-in users.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const HEARTBEAT_WINDOW_MS = 15 * 60 * 1000;

    const { data: beat } = await supabaseAdmin
      .from("worker_heartbeats")
      .select("last_seen_at")
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const beatAt = beat?.last_seen_at ?? null;
    if (beatAt != null && Date.now() - new Date(beatAt).getTime() < HEARTBEAT_WINDOW_MS) {
      return { available: true, lastSeenAt: beatAt };
    }

    // Fallback: a worker on an older build that claimed a render recently.
    const { data: row } = await supabaseAdmin
      .from("renders")
      .select("updated_at")
      .eq("engine", "server_ffmpeg")
      .not("claimed_by", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastSeenAt = row?.updated_at ?? null;
    const available =
      lastSeenAt != null && Date.now() - new Date(lastSeenAt).getTime() < HEARTBEAT_WINDOW_MS;
    return { available, lastSeenAt: beatAt ?? lastSeenAt };
  });
