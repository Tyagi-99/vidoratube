/**
 * Mocked-DB tests for the credit usage read-model (no new table).
 *
 * The mock is a small in-memory query builder: `eq` filters are recorded
 * and applied when the query resolves, so the tests exercise our filtering
 * and attribution logic. Key assertion: attribution joins credit_ledger ->
 * generation_jobs on ref_id, because the ledger has no workspace/project
 * columns of its own.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getCreditUsageLog, logCreditUsage } from "./usage.server";

const LEDGER_ROWS = [
  {
    id: "l1",
    user_id: "user-1",
    delta: -3,
    reason: "Video render (3 finished min): Sunset doc",
    ref_id: "job-1",
    created_at: "2026-09-27T10:00:00Z",
  },
  {
    id: "l2",
    user_id: "user-1",
    delta: 3,
    reason: "Refund: failed render job-1",
    ref_id: "job-1",
    created_at: "2026-09-27T11:00:00Z",
  },
  {
    id: "l3",
    user_id: "user-1",
    delta: -1,
    reason: "TTS narration",
    ref_id: "job-9", // no generation_jobs row -> unattributable
    created_at: "2026-09-27T12:00:00Z",
  },
];

const JOB_ROWS = [{ id: "job-1", workspace_id: "ws-1", project_id: "p-1" }];

function mockAdmin() {
  const from = vi.fn((table: string) => {
    const filters: Array<[string, unknown]> = [];
    const source: unknown[] = table === "credit_ledger" ? LEDGER_ROWS : JOB_ROWS;
    const b: Record<string, unknown> = {};
    const chain = () => b;
    for (const m of ["select", "gte", "in", "order", "limit"]) b[m] = chain;
    b["eq"] = (col: string, val: unknown) => {
      filters.push([col, val]);
      return b;
    };
    // Comparator filters (used for the debit/credit action filter).
    b["lt"] = (col: string, val: number) => {
      filters.push([col, { lt: val }]);
      return b;
    };
    b["gt"] = (col: string, val: number) => {
      filters.push([col, { gt: val }]);
      return b;
    };
    b["then"] = (resolve: (v: unknown) => void) => {
      let data = source;
      for (const [col, val] of filters) {
        data = data.filter((r) => {
          const cell = (r as Record<string, unknown>)[col];
          if (typeof val === "object" && val !== null) {
            if ("lt" in val) return Number(cell) < (val as { lt: number }).lt;
            if ("gt" in val) return Number(cell) > (val as { gt: number }).gt;
          }
          return cell === val;
        });
      }
      resolve({ data, error: null });
    };
    return b;
  });
  return { from, admin: { from } as unknown as SupabaseClient<Database> };
}

describe("getCreditUsageLog", () => {
  it("shapes ledger rows as usage entries with job attribution", async () => {
    const { admin } = mockAdmin();
    const entries = await getCreditUsageLog(admin, { userId: "user-1", jobId: "job-1" });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      userId: "user-1",
      workspaceId: "ws-1",
      projectId: "p-1",
      jobId: "job-1",
    });
    expect(entries.map((e) => e.action).sort()).toEqual(["credit", "debit"]);
    expect(entries.map((e) => e.credits).sort((a, b) => a - b)).toEqual([-3, 3]);
    expect(entries[0]?.reason).toContain("Video render");
  });

  it("reports null workspace/project when the job is unattributable (stated, not hidden)", async () => {
    const { admin } = mockAdmin();
    const entries = await getCreditUsageLog(admin, { userId: "user-1", jobId: "job-9" });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ workspaceId: null, projectId: null });
  });

  it("filters by action at the query level", async () => {
    const { admin } = mockAdmin();
    const entries = await getCreditUsageLog(admin, { userId: "user-1", action: "debit" });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.action === "debit")).toBe(true);
  });
});

describe("logCreditUsage", () => {
  it("resolves the ledger row for a job as the usage log (writes nothing)", async () => {
    const { from, admin } = mockAdmin();
    const entry = await logCreditUsage(admin, {
      userId: "user-1",
      jobId: "job-1",
      action: "render.refund",
      credits: 3,
      metadata: { note: "test" },
    });
    expect(entry.jobId).toBe("job-1");
    expect(entry.credits).toBe(3);
    expect(entry.metadata).toEqual({ note: "test" });
    // Read-model proof: the only tables touched are the ledger + the
    // attribution join. There is no usage table to write to.
    const tables = from.mock.calls.map((c) => c[0] as string);
    expect(tables).toContain("credit_ledger");
    expect(tables).not.toContain("credit_usage");
  });

  it("throws when no ledger entry exists (never synthesizes a row)", async () => {
    const { admin } = mockAdmin();
    await expect(logCreditUsage(admin, { userId: "user-1", jobId: "job-missing" })).rejects.toThrow(
      "No credit_ledger entry found",
    );
  });
});
