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
  it("sums attributed ledger debits (voice/render/video-job paths included)", async () => {
    const seen: string[] = [];
    const ledgerCalls: string[][] = [];
    const from = vi.fn((table: string) => {
      seen.push(table);
      if (table === "credit_ledger") {
        ledgerCalls.push([]);
        // First call: delta rows; second: ref_id attribution.
        return ledgerCalls.length === 1
          ? chainable(noErr([{ delta: -7 }, { delta: -3 }, { delta: 5 }]))
          : chainable(noErr([]));
      }
      return chainable(noErr([]));
    });
    const admin = { from } as unknown as SupabaseClient<Database>;
    await expect(getMonthToDateSpend(admin, { workspaceId: "ws-1" })).resolves.toBe(10);
    // Proves the spend source: the ledger first, not generation_jobs alone.
    expect(seen[0]).toBe("credit_ledger");
  });

  it("counts legacy generation_jobs costs only when no ledger debit is attributed", async () => {
    const from = vi.fn((table: string) => {
      if (table === "credit_ledger") {
        // select("delta") list query vs select("ref_id") attribution query:
        // distinguish by chaining — the mock serves both from one canned map
        // keyed by call order.
        const n = from.mock.calls.filter((c) => c[0] === "credit_ledger").length;
        return n === 1 ? chainable(noErr([])) : chainable(noErr([{ ref_id: "job-attributed" }]));
      }
      return chainable(
        noErr([
          { id: "job-attributed", cost_actual_credits: 100 },
          { id: "job-legacy", cost_actual_credits: 25 },
        ]),
      );
    });
    const admin = { from } as unknown as SupabaseClient<Database>;
    // 100 is excluded (attributed debit exists); 25 counted via fallback.
    await expect(getMonthToDateSpend(admin, { workspaceId: "ws-1" })).resolves.toBe(25);
  });

  it("requires a scope", async () => {
    const { admin } = mockAdmin({});
    await expect(getMonthToDateSpend(admin, {})).rejects.toThrow("requires a workspaceId");
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
   * Spend dispatch: getMonthToDateSpend queries the ledger (delta rows) first,
   * then generation_jobs, then the ledger again (ref attribution). The mock
   * serves wsSpent/projSpent through the ledger delta rows — matching the
   * module's call order — but only for scopes the test actually enables.
   * Odd credit_ledger calls = delta query; even = ref_id attribution (empty).
   */
  function budgetAdmin(opts: BudgetOpts, scopes: { ws: boolean; proj: boolean }) {
    const spendQueue: number[] = [];
    if (scopes.ws) spendQueue.push(opts.wsSpent ?? 0);
    if (scopes.proj) spendQueue.push(opts.projSpent ?? 0);
    // credit_ledger is queried twice per scope (deltas, then ref attribution),
    // but the second query is skipped when there are no legacy jobs. The
    // generation_jobs query always sits between the two, so use it as the
    // marker that flips the next ledger query to "attribution".
    let deltaQueriesServed = 0;
    let expectAttribution = false;
    const from = vi.fn((table: string) => {
      if (table === "workspace_budgets") {
        // A fresh budget read starts a new spend-check cycle: the next
        // ledger query is the delta query, not an attribution query.
        expectAttribution = false;
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
        expectAttribution = false;
        return chainable(
          noErr(
            opts.projCap === undefined
              ? null
              : { project_id: "p-1", credit_cap: opts.projCap ?? null },
          ),
        );
      }
      if (table === "credit_ledger") {
        if (!expectAttribution) {
          const spent = spendQueue[deltaQueriesServed] ?? 0;
          deltaQueriesServed += 1;
          return chainable(noErr(spent === 0 ? [] : [{ delta: -spent }]));
        }
        expectAttribution = false;
        return chainable(noErr([]));
      }
      if (table === "generation_jobs") {
        // No legacy unattributed jobs in these tests; flip the marker so a
        // subsequent ledger query is treated as the attribution query (the
        // module skips it entirely when the jobs list is empty).
        expectAttribution = true;
        return chainable(noErr([]));
      }
      return chainable(noErr([]));
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
    let deltaServed = false;
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
      if (table === "credit_ledger") {
        // First ledger query per spend call = deltas; the attribution query
        // is skipped when generation_jobs returns no legacy rows.
        if (!deltaServed) {
          deltaServed = true;
          return chainable(noErr(opts.wsSpent ? [{ delta: -(opts.wsSpent ?? 0) }] : []));
        }
        return chainable(noErr([]));
      }
      return chainable(noErr([]));
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
