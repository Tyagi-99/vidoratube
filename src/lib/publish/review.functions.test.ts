import { describe, expect, it, vi, beforeEach } from "vitest";
import { runRejectPublishJob } from "./review.functions";

/**
 * Phase 4, Stream A (F29) — server-only rejection tests.
 * Proves: draft/approved/scheduled → canceled with an audit row; published
 * jobs can't be rejected; another user's job can't be rejected.
 */

const USER = "user-1";

function makeFakeDb(initialJobs: any[]) {
  const jobs = initialJobs.map((j) => ({ ...j }));
  const apiFor = () => {
    const filters: ((r: any) => boolean)[] = [];
    let patch: any = null;
    let statuses: string[] | null = null;
    const api: any = {
      select: () => api,
      eq: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val);
        return api;
      },
      in: (col: string, vals: string[]) => {
        if (col === "status") statuses = vals;
        else filters.push((r) => (vals as unknown[]).includes(r[col]));
        return api;
      },
      update: (p: any) => {
        patch = p;
        return api;
      },
      maybeSingle: async () => {
        let rows = jobs.filter((r) => filters.every((f) => f(r)));
        if (statuses) rows = rows.filter((r) => statuses!.includes(r.status));
        if (patch) {
          for (const r of rows) Object.assign(r, patch);
          return { data: rows[0] ?? null, error: null };
        }
        // Return a copy: the real client returns fresh objects, so the
        // pre-update `job` snapshot keeps its original status for the audit.
        return { data: rows[0] ? { ...rows[0] } : null, error: null };
      },
    };
    return api;
  };
  return { from: (_t: string) => apiFor(), jobs };
}

function job(overrides: Record<string, any> = {}) {
  return { id: "job-1", user_id: USER, status: "draft", ...overrides };
}

vi.mock("@/lib/audit-log.server", () => {
  const audits: any[] = [];
  return { auditSafely: async (input: any) => void audits.push(input), __audits: audits };
});

beforeEach(async () => {
  const mod = await import("@/lib/audit-log.server");
  ((mod as any).__audits ?? []).length = 0;
});

async function recordedAudits() {
  const mod = await import("@/lib/audit-log.server");
  return (mod as any).__audits as any[];
}

describe("runRejectPublishJob", () => {
  it.each(["draft", "approved", "scheduled"])(
    "rejects a %s job → canceled, audit-logged with the reason",
    async (status) => {
      const db = makeFakeDb([job({ status })]);
      const result = await runRejectPublishJob({
        supabase: db as any,
        userId: USER,
        input: { publish_job_id: "job-1", reason: "Thumbnail doesn't match the hook." },
      });
      expect(result).toEqual({ ok: true });
      expect(db.jobs[0].status).toBe("canceled");
      const audits = await recordedAudits();
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action: "publish.rejected",
        entityType: "publish_job",
        entityId: "job-1",
      });
      expect(audits[0].metadata.reason).toBe("Thumbnail doesn't match the hook.");
      expect(audits[0].metadata.previous_status).toBe(status);
    },
  );

  it("REFUSES to reject a published job", async () => {
    const db = makeFakeDb([job({ status: "published" })]);
    await expect(
      runRejectPublishJob({
        supabase: db as any,
        userId: USER,
        input: { publish_job_id: "job-1", reason: "too late" },
      }),
    ).rejects.toThrow(/can't be rejected/);
    expect(db.jobs[0].status).toBe("published");
    expect(await recordedAudits()).toHaveLength(0);
  });

  it("REFUSES another user's job", async () => {
    const db = makeFakeDb([job()]);
    await expect(
      runRejectPublishJob({
        supabase: db as any,
        userId: "intruder",
        input: { publish_job_id: "job-1", reason: "x" },
      }),
    ).rejects.toThrow(/not found/);
  });
});
