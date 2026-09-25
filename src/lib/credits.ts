/**
 * Credit debits for renders and project-based flows.
 *
 * Renders charge per finished minute (see src/lib/billing/per-minute.ts):
 * `debitMinutesForJob` uses the idempotent `debit_credits_for_minutes` RPC
 * with the job id as the ref, so retries can never double-charge.
 * `refundMinutesForJob` credits the minutes back when a render fails.
 * Call with the service-role client, BEFORE the expensive provider call.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const OUT_OF_CREDITS_MESSAGE =
  "You're out of credits. Upgrade your plan to keep rendering.";

function toOutOfCredits(error: { message: string }): never {
  if (error.message.includes("INSUFFICIENT_CREDITS")) {
    throw new Error(OUT_OF_CREDITS_MESSAGE);
  }
  throw new Error(error.message);
}

/**
 * Debit N finished minutes for a job. Idempotent per jobId.
 * Requires the 20260925194000_per_minute_credits migration.
 */
export async function debitMinutesForJob(
  supabaseAdmin: SupabaseClient<Database>,
  userId: string,
  jobId: string,
  minutes: number,
  reason: string,
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("debit_credits_for_minutes", {
    p_user_id: userId,
    p_minutes: Math.max(1, Math.ceil(minutes)),
    p_reason: reason,
    p_ref_id: jobId,
  });
  if (error) toOutOfCredits(error);
}

/**
 * Refund N finished minutes for a failed job. Idempotent per jobId —
 * a job that was never charged, or already refunded, is a no-op.
 */
export async function refundMinutesForJob(
  supabaseAdmin: SupabaseClient<Database>,
  userId: string,
  jobId: string,
  minutes: number,
  reason: string,
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("refund_credits_for_minutes", {
    p_user_id: userId,
    p_minutes: Math.max(1, Math.ceil(minutes)),
    p_reason: reason,
    p_ref_id: jobId,
  });
  if (error) throw new Error(error.message);
}

/**
 * @deprecated Use debitMinutesForJob. Kept for the Mode 2/3 voiceover flows
 * until they move to minute-based billing.
 */
export async function debitOneCreditForProject(
  supabaseAdmin: SupabaseClient<Database>,
  userId: string,
  projectId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("debit_credits_for_job_once", {
    p_user_id: userId,
    p_reason: reason,
    p_job_id: projectId,
  });
  if (error) toOutOfCredits(error);
}
