/**
 * Concurrency guards for the video-job pipeline.
 *
 * The client polls `advanceVideoJob`, so two tabs (or a retry racing a slow
 * request) can enter the same paid stage twice. These helpers make each stage
 * transition atomic: the first caller to claim the stage runs the side
 * effects, everyone else gets the fresh job state back with no side effects.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { CLIENT_COMPOSE_STAGES } from "./final-video";

type VideoJobRow = Database["public"]["Tables"]["video_jobs"]["Row"];

/** Jobs older than this in `running` are considered stuck and reaped. */
export const REAP_AFTER_MS = 30 * 60 * 1000;

const TERMINAL_STAGES = ["done", "failed"] as const;

/**
 * Atomically claim a stage by moving it to `<stage>_claimed`.
 * Returns the claimed row for the winner, or null for losers (someone else
 * claimed it first, or the job already moved on / resolved).
 */
export async function claimJobStage(
  client: SupabaseClient<Database>,
  jobId: string,
  userId: string,
  expectedStage: string,
): Promise<VideoJobRow | null> {
  const { data, error } = await client
    .from("video_jobs")
    .update({ stage: `${expectedStage}_claimed`, step: "Working" })
    .eq("id", jobId)
    .eq("user_id", userId)
    .eq("stage", expectedStage)
    .not("status", "in", "(completed,failed)")
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Release a claim back to the original stage (e.g. after a side-effect failure). */
export async function releaseJobStageClaim(
  client: SupabaseClient<Database>,
  jobId: string,
  userId: string,
  expectedStage: string,
): Promise<void> {
  const { error } = await client
    .from("video_jobs")
    .update({ stage: expectedStage })
    .eq("id", jobId)
    .eq("user_id", userId)
    .eq("stage", `${expectedStage}_claimed`);
  if (error) throw new Error(error.message);
}

/** True when a job is stuck and the reaper may fail it (and refund if charged). */
export function isReapableJob(
  job: { status: string; stage: string; updated_at: string },
  nowMs: number = Date.now(),
): boolean {
  if (job.status !== "running") return false;
  if ((TERMINAL_STAGES as readonly string[]).includes(job.stage)) return false;
  const updated = Date.parse(job.updated_at);
  if (Number.isNaN(updated)) return false;
  return nowMs - updated > REAP_AFTER_MS;
}

/**
 * True when the browser may attach a final MP4: the job is still running and
 * sitting in a client-compose stage (stills + voiceover ready, no MP4 yet).
 */
export function canFinalizeJobStage(
  job: { status: string; stage: string },
): boolean {
  return (
    job.status === "running" &&
    (CLIENT_COMPOSE_STAGES as readonly string[]).includes(job.stage)
  );
}
