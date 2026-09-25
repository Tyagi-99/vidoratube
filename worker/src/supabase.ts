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

/** Requeue jobs stuck in `running` past the lease (crashed workers). */
export async function requeueStaleJobs(
  supabase: SupabaseClient,
  leaseSeconds: number,
): Promise<number> {
  const { data, error } = await supabase
    .from("renders")
    .update({ status: "queued", stage: "queued", claimed_at: null, claimed_by: null })
    .eq("status", "running")
    .eq("engine", "server_ffmpeg")
    .lt("claimed_at", new Date(Date.now() - leaseSeconds * 1000).toISOString())
    .select("id");
  if (error) throw new Error(`requeue failed: ${error.message}`);
  return data?.length ?? 0;
}
