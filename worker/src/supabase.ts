import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { WorkerConfig } from "./config.js";
import type { RenderJob } from "./types.js";

/** Service-role client. Never expose to browsers — worker-only. */
export function createServiceClient(cfg: WorkerConfig): SupabaseClient {
  return createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function claimJob(
  supabase: SupabaseClient,
  workerId: string,
): Promise<RenderJob | null> {
  const { data, error } = await supabase.rpc("claim_render_job", {
    p_worker_id: workerId,
  });
  if (error) throw new Error(`claim_render_job failed: ${error.message}`);
  return (data as RenderJob | null) ?? null;
}

export async function heartbeat(
  supabase: SupabaseClient,
  jobId: string,
  workerId: string,
  stage: string,
  progress: number,
): Promise<void> {
  const { error } = await supabase.rpc("heartbeat_render_job", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_stage: stage,
    p_progress: Math.round(progress),
  });
  if (error) throw new Error(`heartbeat failed: ${error.message}`);
}

/**
 * Idle liveness heartbeat, independent of jobs.
 *
 * Fixes the bootstrap deadlock: the app used to infer worker liveness only
 * from claimed render rows, so a freshly deployed worker (no claims yet)
 * looked offline forever. The worker calls this on boot and every minute
 * while idle; the app's getServerWorkerStatus reads worker_heartbeats.
 * Service-role only (the table has RLS with no client policies).
 */
export async function reportWorkerHeartbeat(
  supabase: SupabaseClient,
  workerId: string,
): Promise<void> {
  const { error } = await supabase.from("worker_heartbeats").upsert(
    { worker_id: workerId, last_seen_at: new Date().toISOString() },
    { onConflict: "worker_id" },
  );
  if (error) throw new Error(`worker heartbeat failed: ${error.message}`);
}

export async function finishJob(
  supabase: SupabaseClient,
  jobId: string,
  patch: {
    status: "completed" | "failed" | "cancelled";
    file_url?: string | null;
    file_size?: number | null;
    duration?: number | null;
    resolution?: string | null;
    error?: string | null;
    checkpoint?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await supabase
    .from("renders")
    .update({
      status: patch.status,
      stage: patch.status === "completed" ? "done" : patch.status,
      progress: patch.status === "completed" ? 100 : undefined,
      file_url: patch.file_url ?? undefined,
      file_size: patch.file_size ?? undefined,
      duration: patch.duration ?? undefined,
      resolution: patch.resolution ?? undefined,
      error: patch.error ?? null,
      checkpoint: patch.checkpoint ?? undefined,
      render_completed_at: new Date().toISOString(),
      claimed_at: null,
      claimed_by: null,
    })
    .eq("id", jobId);
  if (error) throw new Error(`finishJob failed: ${error.message}`);

  // P7: settle per-minute billing. finalize_render_billing is idempotent;
  // failures here are logged but don't fail the render itself — a later
  // pass can retry (billed_minutes stays NULL).
  if (patch.status === "completed") {
    const { error: billError } = await supabase.rpc("finalize_render_billing", {
      p_render_id: jobId,
    });
    if (billError) {
      console.error(`[worker] finalize_render_billing failed for ${jobId}: ${billError.message}`);
    }
  } else {
    // Failed/cancelled: the render produced nothing, so the exact-quoted
    // reserve must come back. refund_credits_for_minutes is idempotent per
    // job id and only refunds what was actually debited — safe to call on
    // retries and on rows whose reserve never landed.
    const { data: row } = await supabase
      .from("renders")
      .select("user_id, reserved_minutes")
      .eq("id", jobId)
      .maybeSingle();
    if (row) {
      const { error: refundError } = await supabase.rpc("refund_credits_for_minutes", {
        p_user_id: row.user_id,
        p_minutes: row.reserved_minutes ?? 0,
        p_reason: `Refund: ${patch.status} server render ${jobId}`,
        p_ref_id: jobId,
      });
      if (refundError) {
        console.error(`[worker] refund failed for ${jobId}: ${refundError.message}`);
      }
    }
  }
}

export async function shouldCancel(
  supabase: SupabaseClient,
  jobId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("renders")
    .select("cancel_requested,status")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(`cancel check failed: ${error.message}`);
  return data?.cancel_requested === true || data?.status === "cancelled";
}

/**
 * Requeue jobs stuck in `running` past the lease (crashed workers).
 *
 * Delegates to the `requeue_stale_renders` SQL function (migration
 * 20260925210000_requeue_stale_renders.sql), which is the single server-side
 * authority for crash recovery: stale jobs with attempts left go back to
 * 'queued' with attempts incremented; jobs whose retry budget is exhausted
 * are marked 'failed' with 'Worker died; retries exhausted' instead of
 * being requeued forever. Returns the number of jobs requeued.
 */
export async function requeueStaleJobs(
  supabase: SupabaseClient,
  leaseSeconds: number,
): Promise<number> {
  const { data, error } = await supabase.rpc("requeue_stale_renders", {
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error(`requeue failed: ${error.message}`);
  return (data as number | null) ?? 0;
}

/**
 * Requeue chapters stuck in `rendering` past the lease (crashed workers).
 *
 * Delegates to the `requeue_stale_chapters` SQL function (migration
 * 20260925230000_chapters.sql), the chapter-level mirror of
 * `requeue_stale_renders`: stale chapters with attempts left go back to
 * 'queued' with attempts incremented; chapters whose retry budget is
 * exhausted are marked 'failed' with 'Worker died; retries exhausted'.
 * `done` chapters are never touched — their output_path is the resume
 * checkpoint.
 */
export async function requeueStaleChapters(
  supabase: SupabaseClient,
  leaseSeconds: number,
): Promise<number> {
  const { data, error } = await supabase.rpc("requeue_stale_chapters", {
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error(`chapter requeue failed: ${error.message}`);
  return (data as number | null) ?? 0;
}
