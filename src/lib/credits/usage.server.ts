/**
 * Credit usage logs (Phase 1, Credits). SERVER-ONLY.
 *
 * READ-MODEL over `credit_ledger` — no new table. Every debit and refund
 * already writes a ledger entry through the idempotent RPCs
 * (`debit_credits_for_minutes`, `refund_credits_for_minutes`,
 * `debit_credits_for_job_once` in `../credits.ts`), so the ledger IS the
 * usage log. This module only shapes those rows for display/reporting.
 *
 * Two attributions the ledger cannot do on its own:
 * - workspace_id / project_id: `credit_ledger` has no such columns, so they
 *   are resolved by joining `generation_jobs` on the ledger row's `ref_id`
 *   (the debit RPCs use the job id as ref). Jobs debited without a
 *   generation_jobs row report workspace/project as null — stated, not
 *   hidden.
 * - `action`: the ledger stores free-text `reason`; this module derives a
 *   coarse action ("debit" | "credit") from the sign of `delta` and exposes
 *   the raw reason alongside.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type UsageLogEntry = {
  /** credit_ledger row id. */
  id: string;
  userId: string;
  /** Resolved via generation_jobs.ref join; null when unattributable. */
  workspaceId: string | null;
  /** Resolved via generation_jobs.ref join; null when unattributable. */
  projectId: string | null;
  /** credit_ledger.ref_id (the job id the debit RPCs use as ref). */
  jobId: string | null;
  /** Derived from delta sign: "debit" (< 0) | "credit" (> 0). */
  action: "debit" | "credit";
  /** Signed credit delta exactly as recorded in the ledger. */
  credits: number;
  /** Raw ledger reason (free text from the debit call site). */
  reason: string;
  createdAt: string;
};

export type UsageLogQuery = {
  userId: string;
  workspaceId?: string | undefined;
  projectId?: string | undefined;
  /** Filter to one job (matches ledger ref_id). */
  jobId?: string | undefined;
  /** Filter to debits or credits. */
  action?: "debit" | "credit" | undefined;
  /** ISO timestamp lower bound. */
  since?: string | undefined;
  limit?: number | undefined;
};

type LedgerRow = {
  id: string;
  user_id: string;
  delta: number;
  reason: string;
  ref_id: string | null;
  created_at: string;
};

/**
 * Read-model query over the ledger. Workspace/project scoping is applied by
 * resolving each row's job attribution (see module header) — rows that
 * cannot be attributed to the requested scope are excluded.
 */
export async function getCreditUsageLog(
  admin: SupabaseClient<Database>,
  query: UsageLogQuery,
): Promise<UsageLogEntry[]> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 500);
  let q = admin
    .from("credit_ledger")
    .select("id, user_id, delta, reason, ref_id, created_at")
    .eq("user_id", query.userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (query.jobId) q = q.eq("ref_id", query.jobId);
  if (query.action === "debit") q = q.lt("delta", 0);
  if (query.action === "credit") q = q.gt("delta", 0);
  if (query.since) q = q.gte("created_at", query.since);

  const { data, error } = await q;
  if (error) throw new Error(`Could not read credit usage log: ${error.message}`);
  const rows = (data ?? []) as LedgerRow[];

  // Attribute workspace/project via generation_jobs (ledger has no columns).
  const jobIds = [...new Set(rows.map((r) => r.ref_id).filter((id): id is string => !!id))];
  const attribution = new Map<string, { workspaceId: string | null; projectId: string | null }>();
  if (jobIds.length > 0) {
    // generation_jobs is a Phase-1 table not yet in the generated DB types;
    // select only the columns we need via a loose cast.
    const { data: jobs, error: jobsError } = await (
      admin as unknown as SupabaseClient<Database>
    )
      .from("generation_jobs" as never)
      .select("id, workspace_id, project_id")
      .in("id" as never, jobIds as never);
    if (jobsError) throw new Error(`Could not attribute usage to jobs: ${jobsError.message}`);
    for (const j of (jobs ?? []) as { id: string; workspace_id: string | null; project_id: string | null }[]) {
      attribution.set(j.id, { workspaceId: j.workspace_id, projectId: j.project_id });
    }
  }

  const entries: UsageLogEntry[] = rows.map((r) => {
    const attr = r.ref_id ? attribution.get(r.ref_id) : undefined;
    return {
      id: r.id,
      userId: r.user_id,
      workspaceId: attr?.workspaceId ?? null,
      projectId: attr?.projectId ?? null,
      jobId: r.ref_id,
      action: Number(r.delta) < 0 ? "debit" : "credit",
      credits: Number(r.delta),
      reason: r.reason,
      createdAt: r.created_at,
    };
  });

  // Scope filters apply AFTER attribution (the ledger itself cannot filter).
  return entries.filter((e) => {
    if (query.workspaceId && e.workspaceId !== query.workspaceId) return false;
    if (query.projectId && e.projectId !== query.projectId) return false;
    return true;
  });
}

export type LogCreditUsageInput = {
  userId: string;
  workspaceId?: string | undefined;
  projectId?: string | undefined;
  jobId: string;
  /** e.g. "render.debit", "render.refund", "tts.debit" — matched loosely. */
  action?: string | undefined;
  /** Expected signed delta; used only to pick the right row, never written. */
  credits?: number | undefined;
  metadata?: Record<string, unknown> | undefined;
};

/**
 * "Log" a credit usage event — as a READ-MODEL over the ledger.
 *
 * This function WRITES NOTHING. Writes happen exclusively through the debit
 * / refund RPCs in `../credits.ts`, which always insert a ledger row; that
 * row is the log. Here we locate the ledger row(s) for the job and return
 * them shaped as usage-log entries (the closest match to `action`/`credits`
 * when several exist). Throws when no ledger row exists for the job — a
 * usage event with no ledger entry is a data-integrity bug, not something
 * to paper over with a synthetic row.
 *
 * `metadata` is accepted for forward-compatibility and echoed back; it is
 * NOT persisted (there is no usage table by design).
 */
export async function logCreditUsage(
  admin: SupabaseClient<Database>,
  input: LogCreditUsageInput,
): Promise<UsageLogEntry & { metadata: Record<string, unknown> }> {
  const entries = await getCreditUsageLog(admin, {
    userId: input.userId,
    jobId: input.jobId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
  });
  if (entries.length === 0) {
    throw new Error(
      `No credit_ledger entry found for job ${input.jobId} — usage must be recorded ` +
        `through the debit/refund RPCs in src/lib/credits.ts first.`,
    );
  }
  const pick =
    entries.find(
      (e) =>
        (input.action === undefined ||
          e.reason.toLowerCase().includes(input.action.toLowerCase().split(".")[0] ?? "")) &&
        (input.credits === undefined || e.credits === input.credits),
    ) ?? (entries[0] as UsageLogEntry);
  return { ...pick, metadata: input.metadata ?? {} };
}
