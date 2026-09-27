/**
 * Mocked-DB unit tests: balance checks, budget enforcement, pre-flight gate.
 *
 * The mock is a minimal chainable query builder: `from(table)` dispatches to
 * canned `{ data, error }` per table, and every chain method returns the
 * builder itself. Terminal methods (`single`, `maybeSingle`, await) resolve
 * the canned result. This tests OUR logic (shortfall math, cap enforcement,
 * gate ordering) — not the Supabase client.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { checkBalanceForJob, getCreditBalance } from "./balance.server";
import {
  checkBudgetForSpend,
  getMonthToDateSpend,
  getProjectBudget,
  getWorkspaceBudget,
  setProjectBudget,
  setWorkspaceBudget,
} from "./budgets.server";
import { preflightCreditsCheck } from "./preflight.server";

type Canned = { data: unknown; error: { message: string } | null };

function chainable(result: Canned) {
  const b: Record<string, unknown> = {};
  const chain = () => b;
  for (const m of ["select", "eq", "gte", "lte", "lt", "gt", "in", "order", "limit", "upsert"]) {
    b[m] = chain;
  }
  b["maybeSingle"] = async () => result;
  b["single"] = async () => result;
  // `await builder` support for list queries (generation_jobs spend).
  b["then"] = (resolve: (v: Canned) => void) => resolve(result);
  return b;
}

function mockAdmin(tables: Record<string, Canned>, onFrom?: (table: string) => void) {
  const from = vi.fn((table: string) => {
    onFrom?.(table);
    return chainable(tables[table] ?? { data: null, error: null });
  });
  return { from, admin: { from } as unknown as SupabaseClient<Database> };
}

const noErr = (data: unknown): Canned => ({ data, error: null });

describe("getCreditBalance", () => {
  it("reads profiles.credits (the canonical balance, like getBillingState)", () => {
    const seen: string[] = [];
    const { admin } = mockAdmin({ profiles: noErr({ credits: 42 }) }, (t) => seen.push(t));
    return expect(getCreditBalance(admin, "user-1"))
      .resolves.toBe(42)
      .then(() => {
        expect(seen).toEqual(["profiles"]);
      });
  });

  it("throws a clear error when the read fails", async () => {
    const { admin } = mockAdmin({ profiles: { data: null, error: { message: "boom" } } });
    await expect(getCreditBalance(admin, "user-1")).rejects.toThrow(
      "Could not read credit balance",
    );
  });
});

describe("checkBalanceForJob", () => {
  it("ok when balance covers the estimate; shortfall 0", async () => {
    const { admin } = mockAdmin({ profiles: noErr({ credits: 10 }) });
    await expect(checkBalanceForJob(admin, "user-1", 6)).resolves.toEqual({
      ok: true,
      balance: 10,
      shortfall: 0,
    });
  });

  it("not ok with exact shortfall when balance is short", async () => {
    const { admin } = mockAdmin({ profiles: noErr({ credits: 10 }) });
    await expect(checkBalanceForJob(admin, "user-1", 15)).resolves.toEqual({
      ok: false,
      balance: 10,
      shortfall: 5,
    });
  });

  it("zero balance, positive estimate -> full shortfall", async () => {
    const { admin } = mockAdmin({ profiles: noErr({ credits: 0 }) });
    const r = await checkBalanceForJob(admin, "user-1", 3);
    expect(r.ok).toBe(false);
    expect(r.shortfall).toBe(3);
  });
});

describe("workspace budgets", () => {
  it("returns null when no budget row exists (uncapped)", async () => {
    const { admin } = mockAdmin({ workspace_budgets: noErr(null) });
    await expect(getWorkspaceBudget(admin, "ws-1")).resolves.toBeNull();
  });

  it("setWorkspaceBudget requires privilege", async () => {
    const { admin } = mockAdmin({});
    await expect(
      setWorkspaceBudget(admin, "ws-1", { monthlyCreditCap: 100 }, false),
    ).rejects.toThrow("Only workspace owners/admins");
  });

  it("setWorkspaceBudget upserts when privileged", async () => {
    const row = { workspace_id: "ws-1", monthly_credit_cap: 100, alert_threshold_pct: 80 };
    const { from, admin } = mockAdmin({ workspace_budgets: noErr(row) });
    const out = await setWorkspaceBudget(admin, "ws-1", { monthlyCreditCap: 100 }, true);
    expect(out).toEqual({ workspaceId: "ws-1", monthlyCreditCap: 100, alertThresholdPct: 80 });
    expect(from).toHaveBeenCalledWith("workspace_budgets");
  });

  it("rejects out-of-range alert thresholds and negative caps", async () => {
    const { admin } = mockAdmin({});
    await expect(
      setWorkspaceBudget(admin, "ws-1", { alertThresholdPct: 101 }, true),
    ).rejects.toThrow("alertThresholdPct");
    await expect(setWorkspaceBudget(admin, "ws-1", { monthlyCreditCap: -5 }, true)).rejects.toThrow(
      "monthlyCreditCap",
    );
  });
});

describe("project budgets", () => {
  it("returns null when no budget row exists (uncapped)", async () => {
    const { admin } = mockAdmin({ project_budgets: noErr(null) });
    await expect(getProjectBudget(admin, "p-1")).resolves.toBeNull();
  });

  it("setProjectBudget requires privilege", async () => {
    const { admin } = mockAdmin({});
    await expect(setProjectBudget(admin, "p-1", { creditCap: 50 }, false)).rejects.toThrow(
      "Only the project owner",
    );
  });
});

describe("getMonthToDateSpend", () => {
  it("sums cost_actual_credits from generation_jobs (NOT the ledger)", async () => {
    const seen: string[] = [];
    const { admin } = mockAdmin(
      {
        generation_jobs: noErr([
          { cost_actual_credits: 10 },
          { cost_actual_credits: 2.5 },
          { cost_actual_credits: null },
        ]),
      },
      (t) => seen.push(t),
    );
    await expect(getMonthToDateSpend(admin, { workspaceId: "ws-1" })).resolves.toBe(12.5);
    // Proves the spend source: generation_jobs, never credit_ledger.
    expect(seen).toEqual(["generation_jobs"]);
  });
});

describe("checkBudgetForSpend", () => {
  type BudgetOpts = {
    wsCap?: number | null;
    wsSpent?: number;
    wsThreshold?: number;
    projCap?: number | null;
    projSpent?: number;
  };

  /**
   * Spend dispatch: checkBudgetForSpend queries workspace spend first, then
   * project spend. The mock serves wsSpent to the first generation_jobs
   * query and projSpent to the second — matching the module's call order —
   * but only for scopes the test actually enables.
   */
  function budgetAdmin(opts: BudgetOpts, scopes: { ws: boolean; proj: boolean }) {
    const spendQueue: number[] = [];
    if (scopes.ws) spendQueue.push(opts.wsSpent ?? 0);
    if (scopes.proj) spendQueue.push(opts.projSpent ?? 0);
    const from = vi.fn((table: string) => {
      if (table === "workspace_budgets") {
        return chainable(
          noErr(
            opts.wsCap === undefined && opts.wsThreshold === undefined
              ? null
              : {
                  workspace_id: "ws-1",
                  monthly_credit_cap: opts.wsCap ?? null,
                  alert_threshold_pct: opts.wsThreshold ?? 80,
                },
          ),
        );
      }
      if (table === "project_budgets") {
        return chainable(
          noErr(
            opts.projCap === undefined
              ? null
              : { project_id: "p-1", credit_cap: opts.projCap ?? null },
          ),
        );
      }
      const spent = spendQueue.shift() ?? 0;
      return chainable(noErr([{ cost_actual_credits: spent }]));
    });
    return { from, admin: { from } as unknown as SupabaseClient<Database> };
  }
  const wsOnly = (o: BudgetOpts) => budgetAdmin(o, { ws: true, proj: false });
  const projOnly = (o: BudgetOpts) => budgetAdmin(o, { ws: false, proj: true });
  const both = (o: BudgetOpts) => budgetAdmin(o, { ws: true, proj: true });

  it("blocks when projected spend exceeds the workspace cap", async () => {
    const { admin } = wsOnly({ wsCap: 100, wsSpent: 90 });
    const r = await checkBudgetForSpend(admin, { workspaceId: "ws-1", estimateCredits: 20 });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("workspace_cap_exceeded");
    expect(r.detail.workspace?.projected).toBe(110);
  });

  it("allows when under the cap", async () => {
    const { admin } = wsOnly({ wsCap: 100, wsSpent: 50 });
    const r = await checkBudgetForSpend(admin, { workspaceId: "ws-1", estimateCredits: 20 });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("ok");
  });

  it("null cap = uncapped: never blocks", async () => {
    const { admin } = wsOnly({ wsCap: null, wsSpent: 10_000 });
    const r = await checkBudgetForSpend(admin, { workspaceId: "ws-1", estimateCredits: 5_000 });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("ok");
  });

  it("no budget row = uncapped: never blocks", async () => {
    const { admin } = wsOnly({ wsSpent: 10_000 });
    const r = await checkBudgetForSpend(admin, { workspaceId: "ws-1", estimateCredits: 5_000 });
    expect(r.allowed).toBe(true);
  });

  it("flags near-cap (80% threshold) without blocking", async () => {
    const { admin } = wsOnly({ wsCap: 100, wsSpent: 75 });
    const r = await checkBudgetForSpend(admin, { workspaceId: "ws-1", estimateCredits: 10 });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("workspace_near_cap");
    expect(r.detail.workspace?.alert).toBe(true);
  });

  it("blocks when projected spend exceeds the project cap", async () => {
    const { admin } = projOnly({ projCap: 50, projSpent: 40 });
    const r = await checkBudgetForSpend(admin, { projectId: "p-1", estimateCredits: 20 });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("project_cap_exceeded");
  });

  it("enforces both scopes: project breach reported even when workspace is fine", async () => {
    const { admin } = both({ wsCap: 1000, wsSpent: 10, projCap: 50, projSpent: 45 });
    const r = await checkBudgetForSpend(admin, {
      workspaceId: "ws-1",
      projectId: "p-1",
      estimateCredits: 10,
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("project_cap_exceeded");
  });
});

describe("preflightCreditsCheck", () => {
  function fullAdmin(opts: { balance: number; wsCap?: number | null; wsSpent?: number }) {
    const from = vi.fn((table: string) => {
      if (table === "profiles") return chainable(noErr({ credits: opts.balance }));
      if (table === "workspace_budgets") {
        return chainable(
          noErr(
            opts.wsCap === undefined
              ? null
              : { workspace_id: "ws-1", monthly_credit_cap: opts.wsCap, alert_threshold_pct: 80 },
          ),
        );
      }
      return chainable(noErr([{ cost_actual_credits: opts.wsSpent ?? 0 }]));
    });
    return { from, admin: { from } as unknown as SupabaseClient<Database> };
  }

  it("denies with INSUFFICIENT_CREDITS when the balance is short", async () => {
    const { from, admin } = fullAdmin({ balance: 1 });
    const r = await preflightCreditsCheck(admin, {
      userId: "user-1",
      jobType: "tts",
      provider: "elevenlabs",
      characters: 100_000, // 21-credit ESTIMATE
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("INSUFFICIENT_CREDITS");
      expect(r.message).toContain("shortfall 20");
      expect(r.estimate.isEstimate).toBe(true);
    }
    // Balance check runs before any budget query.
    expect(from).toHaveBeenCalledWith("profiles");
    expect(from).not.toHaveBeenCalledWith("workspace_budgets");
  });

  it("denies with BUDGET_EXCEEDED when the cap is hit (balance is fine)", async () => {
    const { admin } = fullAdmin({ balance: 1000, wsCap: 100, wsSpent: 95 });
    const r = await preflightCreditsCheck(admin, {
      userId: "user-1",
      workspaceId: "ws-1",
      jobType: "render",
      minutes: 10, // 10-credit ESTIMATE -> projected 105 > 100
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("BUDGET_EXCEEDED");
      expect(r.message).toContain("Workspace budget exceeded");
    }
  });

  it("denies with UNKNOWN_COST when the provider price is unknown", async () => {
    const { from, admin } = fullAdmin({ balance: 1000 });
    const r = await preflightCreditsCheck(admin, {
      userId: "user-1",
      jobType: "video_gen",
      provider: "fal.ai",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("UNKNOWN_COST");
    // No DB touched at all: we refuse to run blind before spending a query.
    expect(from).not.toHaveBeenCalled();
  });

  it("passes with warnings when near (not over) the cap", async () => {
    const { admin } = fullAdmin({ balance: 1000, wsCap: 100, wsSpent: 75 });
    const r = await preflightCreditsCheck(admin, {
      userId: "user-1",
      workspaceId: "ws-1",
      jobType: "render",
      minutes: 10,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.estimate.credits).toBe(10);
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]).toContain("Workspace budget alert");
    }
  });
});
