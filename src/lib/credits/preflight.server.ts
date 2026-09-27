/**
 * Combined pre-flight credit gate (Phase 1, Credits). SERVER-ONLY.
 *
 * Order of operations for any expensive provider call:
 *   1. ESTIMATE the cost (never a real charge — see estimates.server.ts).
 *   2. Check the user's balance covers the estimate.
 *   3. Check workspace/project budget caps against month-to-date spend.
 *   4. Only then call the provider; debit through the ledger RPCs as before.
 *
 * Debits NEVER happen before these checks pass, and the checks themselves
 * never write to the ledger. The actual debit still goes through the
 * atomic RPCs in `../credits.ts`, which re-check the balance inside the
 * transaction (this check is a pre-flight UX gate, not the concurrency
 * guard).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { estimateJobCost, type CostEstimate, type EstimateInput } from "./estimates.server";
import { checkBalanceForJob } from "./balance.server";
import { checkBudgetForSpend } from "./budgets.server";

export type PreflightInput = {
  userId: string;
  workspaceId?: string | undefined;
  projectId?: string | undefined;
} & EstimateInput;

export type PreflightOk = {
  ok: true;
  /** The ESTIMATE the checks were run against (isEstimate: true). */
  estimate: Extract<CostEstimate, { credits: number }>;
  balance: number;
  /** Non-blocking near-cap signals for callers that want to warn. */
  warnings: string[];
};

export type PreflightDenied = {
  ok: false;
  /** Machine-readable gate code for the API surface. */
  code: "INSUFFICIENT_CREDITS" | "BUDGET_EXCEEDED" | "UNKNOWN_COST";
  message: string;
  estimate: CostEstimate;
};

export type PreflightResult = PreflightOk | PreflightDenied;

/**
 * Run the full pre-flight gate. Returns (never throws) a denied result when
 * the job must not proceed; callers turn that into an error response.
 */
export async function preflightCreditsCheck(
  admin: SupabaseClient<Database>,
  input: PreflightInput,
): Promise<PreflightResult> {
  const estimate = estimateJobCost(input);
  if (estimate.credits === null) {
    return {
      ok: false,
      code: "UNKNOWN_COST",
      message:
        `Cannot price this job upfront (${estimate.reason}); refusing to run blind. ` +
        `Add a published price to src/lib/credits/estimates.server.ts first.`,
      estimate,
    };
  }

  const balance = await checkBalanceForJob(admin, input.userId, estimate.credits);
  if (!balance.ok) {
    return {
      ok: false,
      code: "INSUFFICIENT_CREDITS",
      message:
        `Insufficient credits: this job needs ~${estimate.credits} credits (ESTIMATE) ` +
        `but the balance is ${balance.balance} (shortfall ${balance.shortfall}).`,
      estimate,
    };
  }

  if (input.workspaceId || input.projectId) {
    const budget = await checkBudgetForSpend(admin, {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      estimateCredits: estimate.credits,
    });
    if (!budget.allowed) {
      return {
        ok: false,
        code: "BUDGET_EXCEEDED",
        message:
          budget.reason === "project_cap_exceeded"
            ? `Project budget exceeded: projected spend ${budget.detail.project?.projected} credits ` +
              `vs cap ${budget.detail.project?.cap} (month-to-date ${budget.detail.project?.spentMonthToDate}).`
            : `Workspace budget exceeded: projected spend ${budget.detail.workspace?.projected} credits ` +
              `vs monthly cap ${budget.detail.workspace?.cap} (month-to-date ${budget.detail.workspace?.spentMonthToDate}).`,
        estimate,
      };
    }
    const warnings: string[] = [];
    if (budget.reason === "workspace_near_cap") {
      warnings.push(
        `Workspace budget alert: projected ${budget.detail.workspace?.projected}/${budget.detail.workspace?.cap} credits ` +
          `(${budget.detail.workspace?.alertThresholdPct}% threshold).`,
      );
    }
    if (budget.reason === "project_near_cap") {
      warnings.push(
        `Project budget alert: projected ${budget.detail.project?.projected}/${budget.detail.project?.cap} credits.`,
      );
    }
    return { ok: true, estimate, balance: balance.balance, warnings };
  }

  return { ok: true, estimate, balance: balance.balance, warnings: [] };
}
