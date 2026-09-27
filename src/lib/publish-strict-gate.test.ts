/**
 * Stream B — publish integration tests (D99 strict gate).
 *
 * Proves the server-enforced strict evidence gate against a chainable
 * Supabase fake: no network, no YouTube.
 *
 * - assertPublishStrictGate (used by BOTH approval and execution paths)
 *   blocks when strict mode is on and any claim lacks a human CONFIRM.
 * - runExecutePublishJob re-checks the gate BEFORE the uploader runs —
 *   a blocked project never reaches publishVideoJob.
 * - Strict-off projects are unaffected (existing behavior preserved).
 */
import { describe, expect, it, vi } from "vitest";
import { assertPublishStrictGate, runExecutePublishJob } from "./publish.functions";

const UID = "123e4567-e89b-12d3-a456-426614174000";
const PID = "223e4567-e89b-12d3-a456-426614174000";
const JOB = "323e4567-e89b-12d3-a456-426614174000";

type TableCfg = {
  single?: unknown;
  rows?: unknown[];
  count?: number;
  countNeq?: number;
};

type FakeResult = {
  data: unknown;
  error: { message: string } | null;
  count?: number | null;
};

type FakeChain = {
  select: (_cols?: string, opts?: { count?: string; head?: boolean }) => FakeChain;
  eq: () => FakeChain;
  neq: () => FakeChain;
  in: () => FakeChain;
  order: () => FakeChain;
  limit: () => FakeChain;
  update: () => FakeChain;
  insert: () => FakeChain;
  maybeSingle: () => Promise<FakeResult>;
  single: () => Promise<FakeResult>;
  then: (onfulfilled: (value: FakeResult) => void) => void;
};

/** Minimal thenable Postgrest-style chain. `neq()` distinguishes the
 * "unconfirmed" count query from the total count query. */
function chainable(table: string, cfg: TableCfg): FakeChain {
  let sawNeq = false;
  let sawCount = false;
  const countValue = () => (sawNeq ? (cfg.countNeq ?? 0) : (cfg.count ?? 0));
  const b: FakeChain = {
    select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
      if (opts?.count === "exact" && opts?.head) sawCount = true;
      return b;
    },
    eq: () => b,
    neq: () => {
      sawNeq = true;
      return b;
    },
    in: () => b,
    order: () => b,
    limit: () => b,
    update: () => b,
    insert: () => b,
    maybeSingle: async (): Promise<FakeResult> =>
      sawCount
        ? { data: null, count: countValue(), error: null }
        : { data: cfg.single ?? null, error: null },
    single: async (): Promise<FakeResult> =>
      sawCount
        ? { data: null, count: countValue(), error: null }
        : { data: cfg.single ?? null, error: null },
    then: (onfulfilled: (value: FakeResult) => void) => {
      // Count queries await the builder directly (no terminal method).
      onfulfilled(
        table === "research_claims"
          ? { data: [], count: countValue(), error: null }
          : { data: cfg.rows ?? [], error: null },
      );
    },
  };
  return b;
}

const fakeDb = (tables: Record<string, TableCfg>) => ({
  from: (t: string) => chainable(t, tables[t] ?? {}),
});

const job = {
  id: JOB,
  status: "approved",
  project_id: PID,
  video_job_id: "vj-1",
  made_for_kids: false,
  privacy: "unlisted",
  title: "Test video",
  description: "desc",
  tags: [],
  thumbnail_id: null,
  scheduled_for: null,
};

function dbFor(opts: { strictMode: boolean; totalClaims?: number; unconfirmed?: number }) {
  return fakeDb({
    publish_jobs: { single: job },
    approvals: { single: { id: "appr-1" } },
    safety_scores: { single: { score: 90 } },
    projects: { single: { id: PID, research_strict_mode: opts.strictMode } },
    research_sources: { rows: [{ id: "src-1" }] },
    research_claims: { count: opts.totalClaims ?? 2, countNeq: opts.unconfirmed ?? 1 },
  });
}

function uploader() {
  return {
    publishVideoJob: vi.fn().mockResolvedValue({ videoId: "vid-123" }),
    setVideoThumbnail: vi.fn().mockResolvedValue(undefined),
  };
}

describe("assertPublishStrictGate (shared by approval + execution)", () => {
  it("blocks when strict mode is on and a claim lacks a human CONFIRM", async () => {
    const db = dbFor({ strictMode: true, unconfirmed: 1 });
    await expect(assertPublishStrictGate(db, UID, PID)).rejects.toThrow(/Strict review is ON/);
  });

  it("passes when strict mode is on and every claim is confirmed", async () => {
    const db = dbFor({ strictMode: true, totalClaims: 2, unconfirmed: 0 });
    await expect(assertPublishStrictGate(db, UID, PID)).resolves.toBeUndefined();
  });

  it("passes for strict-off projects even with unreviewed claims (existing projects unaffected)", async () => {
    const db = dbFor({ strictMode: false, unconfirmed: 5 });
    await expect(assertPublishStrictGate(db, UID, PID)).resolves.toBeUndefined();
  });

  it("throws when the project is not found (fail-closed)", async () => {
    const db = fakeDb({ projects: { single: null } });
    await expect(assertPublishStrictGate(db, UID, PID)).rejects.toThrow(/Project not found/);
  });
});

describe("runExecutePublishJob strict gate", () => {
  it("blocks BEFORE the uploader runs when claims are unconfirmed", async () => {
    const db = dbFor({ strictMode: true, unconfirmed: 2 });
    const up = uploader();
    await expect(
      runExecutePublishJob({
        supabase: db,
        supabaseAdmin: db,
        userId: UID,
        publishJobId: JOB,
        uploader: up,
      }),
    ).rejects.toThrow(/Strict review is ON/);
    expect(up.publishVideoJob).not.toHaveBeenCalled();
  });

  it("uploads when strict mode is on and all claims are confirmed", async () => {
    const db = dbFor({ strictMode: true, totalClaims: 3, unconfirmed: 0 });
    const up = uploader();
    const out = await runExecutePublishJob({
      supabase: db,
      supabaseAdmin: db,
      userId: UID,
      publishJobId: JOB,
      uploader: up,
    });
    expect(up.publishVideoJob).toHaveBeenCalledTimes(1);
    expect(out.videoId).toBe("vid-123");
  });

  it("uploads for strict-off projects regardless of claim state", async () => {
    const db = dbFor({ strictMode: false, unconfirmed: 9 });
    const up = uploader();
    const out = await runExecutePublishJob({
      supabase: db,
      supabaseAdmin: db,
      userId: UID,
      publishJobId: JOB,
      uploader: up,
    });
    expect(up.publishVideoJob).toHaveBeenCalledTimes(1);
    expect(out.videoId).toBe("vid-123");
  });
});
