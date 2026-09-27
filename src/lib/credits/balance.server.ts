/**
 * Credit balance checks (Phase 1, Credits). SERVER-ONLY.
 *
 * The canonical balance is `profiles.credits` — the debit RPCs
 * (`debit_credits_for_minutes`, `debit_credits_for_job_once`) update it
 * atomically together with the `credit_ledger` insert, which is why
 * `getBillingState` in `../billing.functions.ts` reads the balance from
 * `profiles` and treats the ledger as the audit trail. We follow the same
 * convention here: balance reads come from `profiles.credits`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type BalanceCheck = {
  /** True when balance covers the estimate. */
  ok: boolean;
  /** Current balance in whole credits (from profiles.credits). */
  balance: number;
  /** Credits missing when !ok, else 0. */
  shortfall: number;
};

/** Read the canonical balance from profiles.credits (never the ledger sum). */
export async function getCreditBalance(
  admin: SupabaseClient<Database>,
  userId: string,
): Promise<number> {
  const { data, error } = await admin
    .from("profiles")
    .select("credits")
    .eq("id", userId)
    .single();
  if (error) throw new Error(`Could not read credit balance: ${error.message}`);
  return Number(data?.credits ?? 0);
}

/**
 * Pre-flight balance check: can this user afford `estimateCredits`?
 *
 * This is a CHECK, not a debit — it never touches the ledger. Callers must
 * still debit through `debitMinutesForJob` / `debit_credits_for_minutes`
 * (which re-checks atomically inside the RPC), because the balance can move
 * between this check and the debit.
 */
export async function checkBalanceForJob(
  admin: SupabaseClient<Database>,
  userId: string,
  estimateCredits: number,
): Promise<BalanceCheck> {
  const estimate = Number.isFinite(estimateCredits) && estimateCredits > 0 ? estimateCredits : 0;
  const balance = await getCreditBalance(admin, userId);
  const shortfall = Math.max(0, estimate - balance);
  return { ok: shortfall === 0, balance, shortfall };
}
