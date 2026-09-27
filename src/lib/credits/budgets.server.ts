/**
 * Workspace / project credit budgets (Phase 1, Credits). SERVER-ONLY.
 *
 * Tables (migration 20260928020300_p1_platform.sql):
 *   workspace_budgets(workspace_id PK, monthly_credit_cap NULL = no cap,
 *                     alert_threshold_pct)
 *   project_budgets(project_id PK, credit_cap NULL = no cap)
 *
 * ── WHERE SPEND COMES FROM (read this before "optimizing") ────────────────
 * `credit_ledger` carries NO workspace_id / project_id column — only
 * user_id, delta, reason, ref_id. Attributing ledger rows to a workspace
 * would be guesswork (e.g. parsing reason text), so we deliberately do NOT
 * do it. Month-to-date spend is computed from
 * `generation_jobs.cost_actual_credits`, which DOES carry workspace_id,
 * project_id, user_id and created_at. Limitation: spend only counts jobs
 * that record `cost_actual_credits`; legacy paths that debit purely through
 * the ledger RPCs without a generation_jobs row are invisible to budgets.
 * This is stated, not hidden.
 *
 * Authorization: budget writes are privileged. The workspace role helper
 * lives in `../agency/agency.functions.ts` (`getWorkspaceRole`); this module
 * deliberately does NOT import it, to keep the authorization decision with
 * the caller (server function) that already holds the request context.
 * Callers MUST pass `isPrivileged=true` only after verifying the caller is
 * a workspace owner/admin (or the project owner for project budgets).
 * Passing a wrong value is a security bug — it is documented at every
 * call site, not hidden behind a default.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/* ------------------------------------------------------------------ */
/* Types for the Phase-1 tables (not yet in the generated DB types).   */
/* ------------------------------------------------------------------ */

type WorkspaceBudgetRow = {
  workspace_id: string;
  monthly_credit_cap: number | null;
  alert_threshold_pct: number;
  created_at: string;
  updated_at: string;
};

type ProjectBudgetRow = {
  project_id: string;
  credit_cap: number | null;
  created_at: string;
  updated_at: string;
};

type GenerationJobCostRow = {
  cost_actual_credits: number | null;
};

type Phase1Tables = {
  workspace_budgets: {
    Row: WorkspaceBudgetRow;
    Insert: {
      workspace_id: string;
      monthly_credit_cap?: number | null | undefined;
      alert_threshold_pct?: number | undefined;
    };
    Update: {
      monthly_credit_cap?: number | null | undefined;
      alert_threshold_pct?: number | undefined;
    };
    Relationships: [];
  };
  project_budgets: {
    Row: ProjectBudgetRow;
    Insert: { project_id: string; credit_cap?: number | null | undefined };
    Update: { credit_cap?: number | null | undefined };
    Relationships: [];
  };
  generation_jobs: {
    Row: GenerationJobCostRow;
    Insert: never;
    Update: never;
    Relationships: [];
  };
};

type WithPhase1Tables = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Database["public"]["Tables"] & Phase1Tables;
  };
};

type Admin = SupabaseClient<WithPhase1Tables>;

function asAdmin(admin: SupabaseClient<Database>): Admin {
  return admin as unknown as Admin;
}

/* ------------------------------------------------------------------ */
/* Workspace budgets                                                   */
/* ------------------------------------------------------------------ */

export type WorkspaceBudget = {
  workspaceId: string;
  /** NULL = no cap (uncapped). */
  monthlyCreditCap: number | null;
  alertThresholdPct: number;
};

export async function getWorkspaceBudget(
  admin: SupabaseClient<Database>,
  workspaceId: string,
): Promise<WorkspaceBudget | null> {
  const { data, error } = await asAdmin(admin)
    .from("workspace_budgets")
    .select("workspace_id, monthly_credit_cap, alert_threshold_pct")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`Could not read workspace budget: ${error.message}`);
  if (!data) return null;
  return {
    workspaceId: data.workspace_id,
    monthlyCreditCap: data.monthly_credit_cap == null ? null : Number(data.monthly_credit_cap),
    alertThresholdPct: Number(data.alert_threshold_pct ?? 80),
  };
}

/**
 * Create/replace the workspace budget.
 *
 * SECURITY: pass `isPrivileged=true` ONLY after the caller has verified the
 * acting user is a workspace owner/admin (e.g. via `getWorkspaceRole` in
 * `../agency/agency.functions.ts`). This module performs no role check
 * itself — the caller owns that decision.
 */
export async function setWorkspaceBudget(
  admin: SupabaseClient<Database>,
  workspaceId: string,
  input: { monthlyCreditCap?: number | null | undefined; alertThresholdPct?: number | undefined },
  isPrivileged: boolean,
): Promise<WorkspaceBudget> {
  if (!isPrivileged) {
    throw new Error("Only workspace owners/admins can set the workspace budget.");
  }
  const cap = input.monthlyCreditCap ?? null;
  if (cap !== null && (!Number.isFinite(cap) || cap < 0)) {
    throw new Error("monthlyCreditCap must be a non-negative number or null (uncapped).");
  }
  const threshold = input.alertThresholdPct ?? 80;
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 100) {
    throw new Error("alertThresholdPct must be an integer between 1 and 100.");
  }
  const { data, error } = await asAdmin(admin)
    .from("workspace_budgets")
    .upsert(
      {
        workspace_id: workspaceId,
        monthly_credit_cap: cap,
        alert_threshold_pct: threshold,
      },
      { onConflict: "workspace_id" },
    )
    .select("workspace_id, monthly_credit_cap, alert_threshold_pct")
    .single();
  if (error) throw new Error(`Could not set workspace budget: ${error.message}`);
  return {
    workspaceId: data.workspace_id,
    monthlyCreditCap: data.monthly_credit_cap == null ? null : Number(data.monthly_credit_cap),
    alertThresholdPct: Number(data.alert_threshold_pct),
  };
}

/* ------------------------------------------------------------------ */
/* Project budgets                                                     */
/* ------------------------------------------------------------------ */

export type ProjectBudget = {
  projectId: string;
  /** NULL = no cap (uncapped). */
  creditCap: number | null;
};

export async function getProjectBudget(
  admin: SupabaseClient<Database>,
  projectId: string,
): Promise<ProjectBudget | null> {
  const { data, error } = await asAdmin(admin)
    .from("project_budgets")
    .select("project_id, credit_cap")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw new Error(`Could not read project budget: ${error.message}`);
  if (!data) return null;
  return {
    projectId: data.project_id,
    creditCap: data.credit_cap == null ? null : Number(data.credit_cap),
  };
}

/**
 * Create/replace the project budget.
 *
 * SECURITY: pass `isPrivileged=true` ONLY after the caller has verified the
 * acting user may manage this project (project owner or workspace
 * owner/admin). This module performs no role check itself.
 */
export async function setProjectBudget(
  admin: SupabaseClient<Database>,
  projectId: string,
  input: { creditCap?: number | null | undefined },
  isPrivileged: boolean,
): Promise<ProjectBudget> {
  if (!isPrivileged) {
    throw new Error("Only the project owner (or a workspace admin) can set the project budget.");
  }
  const cap = input.creditCap ?? null;
  if (cap !== null && (!Number.isFinite(cap) || cap < 0)) {
    throw new Error("creditCap must be a non-negative number or null (uncapped).");
  }
  const { data, error } = await asAdmin(admin)
    .from("project_budgets")
    .upsert({ project_id: projectId, credit_cap: cap }, { onConflict: "project_id" })
    .select("project_id, credit_cap")
    .single();
  if (error) throw new Error(`Could not set project budget: ${error.message}`);
  return {
    projectId: data.project_id,
    creditCap: data.credit_cap == null ? null : Number(data.credit_cap),
  };
}

/* ------------------------------------------------------------------ */
/* Spend + enforcement                                                 */
/* ------------------------------------------------------------------ */

/** First instant of the current calendar month (UTC). */
export function monthStartUtc(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * Month-to-date spend in credits for a workspace or project.
 *
 * SOURCE: `generation_jobs.cost_actual_credits` — NOT `credit_ledger`, which
 * has no workspace/project columns (see module header). Rows with NULL
 * cost_actual_credits count as 0. All job statuses count: actual cost is
 * actual cost, whether the job succeeded or failed.
 */
export async function getMonthToDateSpend(
  admin: SupabaseClient<Database>,
  scope: { workspaceId?: string | undefined; projectId?: string | undefined },
): Promise<number> {
  const a = asAdmin(admin);
  let query = a
    .from("generation_jobs")
    .select("cost_actual_credits")
    .gte("created_at", monthStartUtc());
  if (scope.projectId) query = query.eq("project_id" as never, scope.projectId);
  else if (scope.workspaceId) query = query.eq("workspace_id" as never, scope.workspaceId);
  else throw new Error("getMonthToDateSpend requires a workspaceId or projectId.");
  const { data, error } = await query;
  if (error) throw new Error(`Could not compute month-to-date spend: ${error.message}`);
  return (data ?? []).reduce((sum, row) => sum + (Number(row.cost_actual_credits) || 0), 0);
}

export type BudgetCheckInput = {
  workspaceId?: string | undefined;
  projectId?: string | undefined;
  /** ESTIMATE for the job about to run (see estimates.server.ts). */
  estimateCredits: number;
};

export type BudgetCheck = {
  allowed: boolean;
  reason:
    | "ok"
    | "workspace_cap_exceeded"
    | "project_cap_exceeded"
    | "workspace_near_cap"
    | "project_near_cap";
  detail: {
    workspace?:
      | {
          cap: number | null;
          spentMonthToDate: number;
          projected: number;
          alertThresholdPct: number;
          alert: boolean;
        }
      | undefined;
    project?:
      | {
          cap: number | null;
          spentMonthToDate: number;
          projected: number;
        }
      | undefined;
  };
};

/**
 * Pre-flight budget check: does `estimateCredits` fit inside the workspace
 * and/or project caps given month-to-date spend?
 *
 * - NULL cap (or no budget row) = uncapped -> that scope never blocks.
 * - `projected = spentMonthToDate + estimateCredits`; blocked when
 *   projected > cap.
 * - Crossing `alertThresholdPct` of the workspace cap without exceeding it
 *   is still allowed, but flagged (`workspace_near_cap`) so callers can warn.
 */
export async function checkBudgetForSpend(
  admin: SupabaseClient<Database>,
  input: BudgetCheckInput,
): Promise<BudgetCheck> {
  const estimate =
    Number.isFinite(input.estimateCredits) && input.estimateCredits > 0 ? input.estimateCredits : 0;
  const detail: BudgetCheck["detail"] = {};
  let reason: BudgetCheck["reason"] = "ok";

  if (input.workspaceId) {
    const budget = await getWorkspaceBudget(admin, input.workspaceId);
    const spent = await getMonthToDateSpend(admin, { workspaceId: input.workspaceId });
    const cap = budget?.monthlyCreditCap ?? null;
    const threshold = budget?.alertThresholdPct ?? 80;
    const projected = spent + estimate;
    detail.workspace = {
      cap,
      spentMonthToDate: spent,
      projected,
      alertThresholdPct: threshold,
      alert: cap !== null && cap > 0 && projected >= cap * (threshold / 100),
    };
    if (cap !== null && projected > cap) {
      return { allowed: false, reason: "workspace_cap_exceeded", detail };
    }
    if (detail.workspace.alert) reason = "workspace_near_cap";
  }

  if (input.projectId) {
    const budget = await getProjectBudget(admin, input.projectId);
    const spent = await getMonthToDateSpend(admin, { projectId: input.projectId });
    const cap = budget?.creditCap ?? null;
    const projected = spent + estimate;
    detail.project = { cap, spentMonthToDate: spent, projected };
    if (cap !== null && projected > cap) {
      return { allowed: false, reason: "project_cap_exceeded", detail };
    }
    // Project budgets have no alert threshold column; use 80% as the
    // near-cap signal, consistent with the workspace default.
    if (cap !== null && cap > 0 && projected >= cap * 0.8 && reason === "ok") {
      reason = "project_near_cap";
    }
  }

  return { allowed: true, reason, detail };
}
