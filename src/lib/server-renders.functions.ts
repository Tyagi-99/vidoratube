import { createServerFn } from "@tanstack/react-start";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAppUser } from "./server-auth";
import type { Database } from "@/integrations/supabase/types";
import { quoteMultiAspectRender } from "./billing/per-minute";

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

export type AspectRatio = "16:9" | "9:16" | "1:1";

/** Every aspect the server worker can output (mirrored in worker/src/pipeline.ts ASPECTS). */
export const ALL_ASPECTS: AspectRatio[] = ["16:9", "9:16", "1:1"];

export const ASPECT_RESOLUTIONS: Record<AspectRatio, string> = {
  "16:9": "1920x1080",
  "9:16": "1080x1920",
  "1:1": "1080x1080",
};

/**
 * Resolve which aspects to render for one enqueue call.
 *
 * Precedence: an explicit `aspects` list wins; otherwise a legacy `aspect`
 * keeps single-aspect callers (e.g. RenderPanel) on exactly the aspect they
 * chose; otherwise the default is all three aspects.
 */
export function resolveRenderAspects(input: {
  aspects?: AspectRatio[] | undefined;
  aspect?: AspectRatio | undefined;
}): AspectRatio[] {
  if (input.aspects && input.aspects.length > 0) {
    return [...new Set(input.aspects)];
  }
  if (input.aspect) return [input.aspect];
  return [...ALL_ASPECTS];
}

const EnqueueSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().max(200).default("Untitled video"),
  scenes: z.array(SceneSchema).min(1).max(200),
  /** Legacy single aspect; kept for back-compat. Prefer `aspects`. */
  aspect: z.enum(["16:9", "9:16", "1:1"]).optional(),
  /** Aspects to render, one `renders` row each. Defaults to all three. */
  aspects: z.array(z.enum(["16:9", "9:16", "1:1"])).min(1).max(3).optional(),
  fps: z.number().int().min(24).max(60).default(30),
  burnCaptions: z.boolean().default(true),
  musicUrl: z.string().max(500).nullable().default(null),
  musicVolume: z.number().min(0).max(1).default(0.15),
  musicDucking: z.boolean().default(true),
  voiceoverUrl: z.string().max(500).nullable().default(null),
  /** Billing mode for measured cost-per-minute attribution. */
  mode: z.enum(["story", "cinema"]).default("story"),
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

    // One renders row per aspect, linked by a shared group id.
    const groupId = randomUUID();
    const rows = buildServerRenderRows({ userId, groupId, input: data });

    // P7: reserve the EXACT quoted render cost BEFORE creating the jobs, so
    // a failed reserve never leaves orphan queued renders. Idempotent per
    // render id; settled deterministically by finalize_render_billing (the
    // quote is exact, so there is no wall-clock overage/refund).
    // One reserve per aspect row: each row renders independently on the
    // worker and bills independently, so each reserves its own quote.
    const { reserveRenderBilling } = await import("./billing.functions");
    for (const row of rows) {
      const expected = (row.meta as { expected_credits?: number } | null)?.expected_credits;
      if (typeof expected !== "number" || expected < 1) {
        throw new Error("Render quote missing — refusing to enqueue without an exact cost.");
      }
      await reserveRenderBilling(supabaseAdmin, userId, row.id!, expected);
    }

    const { data: inserted, error } = await supabase
      .from("renders")
      .insert(rows)
      .select("*");
    if (error) throw new Error(error.message);
    return { groupId, rows: inserted ?? [] };
  });

export type ServerRenderInsert =
  Database["public"]["Tables"]["renders"]["Insert"];

/**
 * Build one `renders` insert row per aspect for a single enqueue call.
 *
 * Pure (no I/O) so the multi-aspect grouping is unit-testable without a
 * database. Rows share `meta.group_id` so the queue UI can present one
 * enqueue call as a unit; each row carries its own `meta.aspect`,
 * `aspect_ratio`, and `resolution`, which the worker's per-aspect pipeline
 * (worker/src/pipeline.ts ASPECTS) renders independently.
 *
 * Pricing: every aspect row renders the same timeline, so every row gets
 * the same EXACT quote from quoteMultiAspectRender (the single source of
 * truth also used by the RenderPanel cost display — the number shown
 * before the render is the number reserved here). The quote is stored in
 * meta (expected_credits / expected_minutes, plus the billing mode) so
 * finalize_render_billing can settle deterministically.
 */
export function buildServerRenderRows(params: {
  userId: string;
  groupId: string;
  input: z.infer<typeof EnqueueSchema>;
}): ServerRenderInsert[] {
  const aspects = resolveRenderAspects(params.input);
  const durationSeconds = params.input.scenes.reduce(
    (sum, s) => sum + (Number(s.duration) || 0),
    0,
  );
  // The enqueue input carries the billing mode (defaults to "story" — the
  // only render configuration the product offers today, so the only
  // honest quote). Premium add-ons (premium voice, cinema stock, 2.5D,
  // dubbing) are priced by the same function and flow through here when
  // they ship as options.
  const quote = quoteMultiAspectRender({
    durationSeconds,
    mode: params.input.mode,
    aspectCount: aspects.length,
  });
  return aspects.map((aspect) => ({
    id: randomUUID(),
    user_id: params.userId,
    project_id: params.input.projectId,
    type: "full",
    engine: "server_ffmpeg",
    format: "mp4",
    status: "queued",
    stage: "queued",
    progress: 0,
    aspect_ratio: aspect,
    resolution: ASPECT_RESOLUTIONS[aspect],
    reserved_minutes: quote.perAspect.minutes,
    meta: {
      scenes: params.input.scenes,
      title: params.input.title,
      aspect,
      fps: params.input.fps,
      burnCaptions: params.input.burnCaptions,
      musicUrl: params.input.musicUrl,
      musicVolume: params.input.musicVolume,
      musicDucking: params.input.musicDucking,
      voiceoverUrl: params.input.voiceoverUrl,
      group_id: params.groupId,
      // Sprint 1: billing-mode attribution for measured cost-per-minute.
      // The quote above uses this same mode, so expected_credits matches.
      mode: params.input.mode,
      expected_credits: quote.perAspect.totalCredits,
      expected_minutes: quote.perAspect.minutes,
    },
  }));
}

/** Request graceful cancellation of a server render. */
export const cancelServerRender = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // If the worker hasn't claimed it yet, cancel immediately.
    const { data: row } = await supabase
      .from("renders")
      .select("id,status,reserved_minutes")
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
      // The worker will never see this row, so refund the enqueue reserve
      // here. refundMinutesForJob is idempotent per render id and only
      // refunds what was actually debited — a racing double-cancel is a no-op.
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { refundMinutesForJob } = await import("./credits");
        await refundMinutesForJob(
          supabaseAdmin,
          userId,
          data.id,
          row.reserved_minutes ?? 0,
          `Refund: cancelled queued server render ${data.id}`,
        );
      } catch {
        // The row is already cancelled; never fail the call on refund issues.
      }
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

/**
 * How long a worker may go without a heartbeat before its jobs are
 * considered abandoned. Mirrors the default lease of the
 * `requeue_stale_renders` RPC and `claim_render_job`.
 */
export const RENDER_JOB_LEASE_SECONDS = 300;

/**
 * Server-render queue depth for /status and /admin.
 *
 * Returns {queued, running, stale} for engine='server_ffmpeg' rows. `stale`
 * counts running jobs whose heartbeat (renders.claimed_at, refreshed by
 * heartbeat_render_job) is older than the lease — the same predicate the
 * requeue RPC uses, so this is the number the next requeue pass would
 * reclaim. Service-role read of infrastructure state, gated to logged-in
 * users (no user rows are returned).
 */
export const getRenderQueueDepth = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const staleBefore = new Date(
      Date.now() - RENDER_JOB_LEASE_SECONDS * 1000,
    ).toISOString();

    const countJobs = async (
      status: "queued" | "running",
      onlyStale: boolean,
    ): Promise<number> => {
      let q = supabaseAdmin
        .from("renders")
        .select("id", { count: "exact", head: true })
        .eq("engine", "server_ffmpeg")
        .eq("status", status);
      if (onlyStale) {
        q = q.or(`claimed_at.is.null,claimed_at.lt.${staleBefore}`);
      }
      const { count, error } = await q;
      if (error) throw new Error(error.message);
      return count ?? 0;
    };

    const [queued, running, stale] = await Promise.all([
      countJobs("queued", false),
      countJobs("running", false),
      countJobs("running", true),
    ]);
    return { queued, running, stale };
  });
