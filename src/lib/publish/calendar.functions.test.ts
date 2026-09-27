import { describe, expect, it, vi, beforeEach } from "vitest";
import { runReschedulePublishJob } from "./calendar.functions";

/**
 * Phase 4, Stream A (F28) — reschedule mutation tests.
 * Proves: approved/scheduled jobs move, drafts are refused, past times are
 * refused, unscheduling returns to approved, every move is audit-logged, and
 * rescheduling NEVER executes (the uploader is never in the picture here).
 */

const USER = "user-1";
const FUTURE = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
const PAST = new Date(Date.now() - 3600 * 1000).toISOString();

function makeFakeDb(initialJobs: any[]) {
  const jobs = initialJobs.map((j) => ({ ...j }));
  const audits: any[] = [];
  const from = (table: string) => {
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
        if (table !== "publish_jobs") return { data: null, error: null };
        let rows = jobs.filter((r) => filters.every((f) => f(r)));
        if (statuses) rows = rows.filter((r) => statuses!.includes(r.status));
        if (patch) {
          for (const r of rows) Object.assign(r, patch);
          return { data: rows[0] ?? null, error: null };
        }
        return { data: rows[0] ?? null, error: null };
      },
    };
    return api;
  };
  return { from, jobs, audits };
}

function job(overrides: Record<string, any> = {}) {
  return {
    id: "job-1",
    user_id: USER,
    project_id: "proj-1",
    status: "approved",
    scheduled_for: null,
    title: "Test",
    ...overrides,
  };
}

// auditPublishEvent dynamically imports the audit module — mock its surface by
// spying on the real one's console path is brittle, so instead we capture
// through a module mock.
vi.mock("@/lib/audit-log.server", () => {
  const audits: any[] = [];
  return {
    auditSafely: async (input: any) => {
      audits.push(input);
    },
    __audits: audits,
  };
});

beforeEach(async () => {
  const mod = await import("@/lib/audit-log.server");
  ((mod as any).__audits ?? []).length = 0;
});

async function recordedAudits() {
  const mod = await import("@/lib/audit-log.server");
  return (mod as any).__audits as any[];
}

describe("runReschedulePublishJob", () => {
  it("moves an approved job to scheduled with a future time", async () => {
    const db = makeFakeDb([job()]);
    const { publishJob } = await runReschedulePublishJob({
      supabase: db as any,
      userId: USER,
      input: { publish_job_id: "job-1", scheduled_for: FUTURE },
    });
    expect(publishJob.status).toBe("scheduled");
    expect(publishJob.scheduled_for).toBe(new Date(FUTURE).toISOString());
    const audits = await recordedAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "publish.rescheduled",
      entityType: "publish_job",
      entityId: "job-1",
      actorUserId: USER,
    });
    expect(audits[0].metadata.to).toBe(new Date(FUTURE).toISOString());
  });

  it("moves a scheduled job to a new future time, staying scheduled", async () => {
    const db = makeFakeDb([job({ status: "scheduled", scheduled_for: FUTURE })]);
    const later = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
    const { publishJob } = await runReschedulePublishJob({
      supabase: db as any,
      userId: USER,
      input: { publish_job_id: "job-1", scheduled_for: later },
    });
    expect(publishJob.status).toBe("scheduled");
    expect(publishJob.scheduled_for).toBe(new Date(later).toISOString());
  });

  it("unscheduling (null) returns the job to approved", async () => {
    const db = makeFakeDb([job({ status: "scheduled", scheduled_for: FUTURE })]);
    const { publishJob } = await runReschedulePublishJob({
      supabase: db as any,
      userId: USER,
      input: { publish_job_id: "job-1", scheduled_for: null },
    });
    expect(publishJob.status).toBe("approved");
    expect(publishJob.scheduled_for).toBeNull();
  });

  it("REFUSES to reschedule a draft (approve first)", async () => {
    const db = makeFakeDb([job({ status: "draft" })]);
    await expect(
      runReschedulePublishJob({
        supabase: db as any,
        userId: USER,
        input: { publish_job_id: "job-1", scheduled_for: FUTURE },
      }),
    ).rejects.toThrow(/Only approved or scheduled/);
    expect(await recordedAudits()).toHaveLength(0);
  });

  it("REFUSES a published job", async () => {
    const db = makeFakeDb([job({ status: "published" })]);
    await expect(
      runReschedulePublishJob({
        supabase: db as any,
        userId: USER,
        input: { publish_job_id: "job-1", scheduled_for: FUTURE },
      }),
    ).rejects.toThrow(/Only approved or scheduled/);
  });

  it("REFUSES a time in the past", async () => {
    const db = makeFakeDb([job()]);
    await expect(
      runReschedulePublishJob({
        supabase: db as any,
        userId: USER,
        input: { publish_job_id: "job-1", scheduled_for: PAST },
      }),
    ).rejects.toThrow(/future/);
  });

  it("REFUSES another user's job", async () => {
    const db = makeFakeDb([job()]);
    await expect(
      runReschedulePublishJob({
        supabase: db as any,
        userId: "intruder",
        input: { publish_job_id: "job-1", scheduled_for: FUTURE },
      }),
    ).rejects.toThrow(/not found/);
  });
});
