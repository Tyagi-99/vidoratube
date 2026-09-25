/**
 * Credit debits for Modes 2/3 (project-based flows).
 *
 * Uses the idempotent `debit_credits_for_job_once` RPC with the project id as
 * the ref: whichever billable step runs first (script generation or TTS)
 * charges exactly 1 credit, and later steps are no-ops. Call with the
 * service-role client, BEFORE the expensive provider call.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const OUT_OF_CREDITS_MESSAGE =
  "You're out of credits. Upgrade your plan to keep rendering.";

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
  if (error) {
    if (error.message.includes("INSUFFICIENT_CREDITS")) {
      throw new Error(OUT_OF_CREDITS_MESSAGE);
    }
    throw new Error(error.message);
  }
}
