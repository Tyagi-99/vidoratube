import { describe, expect, it } from "vitest";
import {
  runApprovePublishJob,
  runExecutePublishJob,
} from "./publish.functions";

/**
 * Sprint 7-8 C — server-enforcement PROOF tests.
 *
 * These call the real server-function cores (runApprovePublishJob /
 * runExecutePublishJob) with a fake Supabase client and a MOCK platform
 * uploader, proving:
 *
 *   1. executePublishJob REJECTS when no approval row exists (a forged
 *      publish_jobs row can never upload), and the mock uploader is NOT
 *      called.
 *   2. executePublishJob PROCEEDS once an approval row exists (written by
 *      approvePublishJob), calling the uploader exactly once.
 *   3. Score < 50 BLOCKS public publishing at BOTH gates (approve + execute).
 *   4. Score < 50 on private/unlisted proceeds WITH a recorded warning.
 */

interface FakeDb {
  from: (table: string) => any;
  tables: Record<string, any[]>;
  writes: { table: string; op: string; row?: any; patch?: any }[];
}

/** In-memory Supabase stand-in supporting the query chains we use. */
function makeDb(initial: Record<string, any[]>): FakeDb {
  const tables: Record<string, any[]> = {};
  for (const [k, v] of Object.entries(initial)) {
    tables[k] = v.map((r) => ({ ...r }));
  }
  const writes: FakeDb["writes"] = [];

  function from(table: string) {
    const rows = (tables[table] ??= []);
    const filters: ((r: any) => boolean)[] = [];
    let orderCol: string | null = null;
    let orderAsc = true;
    let limitN: number | null = null;
    let updatePatch: any = null;
    let insertRow: any = null;

    const applyWrite = (matched: any[]) => {
      if (updatePatch) {
        for (const r of matched) Object.assign(r, updatePatch);
        writes.push({ table, op: "update", patch: updatePatch });
      }
      return matched;
    };
    const query = () => {
      let r = rows.filter((row) => filters.every((f) => f(row)));
      if (orderCol) {
        r = [...r].sort((a, b) =>
          orderAsc
            ? a[orderCol!] < b[orderCol!]
              ? -1
              : 1
            : a[orderCol!] > b[orderCol!]
              ? -1
              : 1,
        );
      }
      if (limitN !== null) r = r.slice(0, limitN);
      return r;
    };

    const api: any = {
      select: () => api,
      eq: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val);
        return api;
      },
      in: (col: string, vals: unknown[]) => {
        filters.push((r) => (vals as unknown[]).includes(r[col]));
        return api;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        orderCol = col;
        orderAsc = opts?.ascending !== false;
        return api;
      },
      limit: (n: number) => {
        limitN = n;
        return api;
      },
      update: (patch: any) => {
        updatePatch = patch;
        return api;
      },
      insert: (row: any) => {
        insertRow = row;
        writes.push({ table, op: "insert", row });
        rows.push({ ...row });
        return api;
      },
      maybeSingle: async () => {
        const r = applyWrite(query());
        return { data: r[0] ?? null, error: null };
      },
      single: async () => {
        const r = applyWrite(query());
        return r[0]
          ? { data: r[0], error: null }
          : { data: null, error: { message: "no rows" } };
      },
      // Terminal `await builder.eq(...)` support (e.g. the failed-status write).
      then: (resolve: (v: any) => void) => {
        const r = applyWrite(query());
        resolve({ data: r, error: null });
      },
    };
    void insertRow;
    return api;
  }

  return { from, tables, writes };
}

function makeUploader() {
  const calls: any[] = [];
  return {
    calls,
    publishVideoJob: async (_admin: any, input: any) => {
      calls.push(input);
      return { videoId: "yt-abc123" };
    },
    setVideoThumbnail: async () => {},
  };
}

const USER = "user-1";

function draftJob(overrides: Record<string, any> = {}) {
  return {
    id: "job-1",
    status: "draft",
    project_id: "proj-1",
    video_job_id: "video-1",
    user_id: USER,
    title: "Test video",
    description: "desc",
    tags: [],
    privacy: "public",
    made_for_kids: false,
    thumbnail_id: null,
    scheduled_for: null,
    ...overrides,
  };
}

function approveInput(overrides: Record<string, any> = {}) {
  return {
    publish_job_id: "job-1",
    title: "Test video",
    description: "desc",
    tags: [],
    privacy: "public" as const,
    madeForKids: false,
    safety_override: false,
    ...overrides,
  };
}

describe("runApprovePublishJob — safety gate", () => {
  it("BLOCKS public approval when the score is < 50 (no override)", async () => {
    const db = makeDb({
      publish_jobs: [draftJob()],
      safety_scores: [{ project_id: "proj-1", user_id: USER, score: 42 }],
      approvals: [],
    });
    await expect(
      runApprovePublishJob({
        supabase: db,
        supabaseAdmin: db,
        userId: USER,
        input: approveInput(),
      }),
    ).rejects.toThrow(/blocked/i);
    // No approval record was written.
    expect(db.tables["approvals"]!).toHaveLength(0);
  });

  it("approves a private publish with score < 50 and notes the warning", async () => {
    const db = makeDb({
      publish_jobs: [draftJob({ privacy: "private" })],
      safety_scores: [{ project_id: "proj-1", user_id: USER, score: 42 }],
      approvals: [],
    });
    const { publishJob, safetyWarning } = await runApprovePublishJob({
      supabase: db,
      supabaseAdmin: db,
      userId: USER,
      input: approveInput({ privacy: "private" }),
    });
    expect(publishJob.status).toBe("approved");
    expect(safetyWarning).toContain("42/100");
    const rows = db.tables["approvals"]!;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.scope).toBe("youtube-private");
    expect(rows[0]!.approver_id).toBe(USER);
    expect(rows[0]!.notes).toContain("42/100");
  });

  it("approves a public publish with score >= 50, no warning", async () => {
    const db = makeDb({
      publish_jobs: [draftJob()],
      safety_scores: [{ project_id: "proj-1", user_id: USER, score: 80 }],
      approvals: [],
    });
    const { publishJob, safetyWarning } = await runApprovePublishJob({
      supabase: db,
      supabaseAdmin: db,
      userId: USER,
      input: approveInput(),
    });
    expect(publishJob.status).toBe("approved");
    expect(safetyWarning).toBeNull();
    expect(db.tables["approvals"]![0]!.scope).toBe("youtube-public");
  });

  it("approves when no score exists (scoring is advisory)", async () => {
    const db = makeDb({ publish_jobs: [draftJob()], safety_scores: [], approvals: [] });
    const { publishJob } = await runApprovePublishJob({
      supabase: db,
      supabaseAdmin: db,
      userId: USER,
      input: approveInput(),
    });
    expect(publishJob.status).toBe("approved");
  });

  it("rejects non-draft jobs", async () => {
    const db = makeDb({
      publish_jobs: [draftJob({ status: "approved" })],
      safety_scores: [],
      approvals: [],
    });
    await expect(
      runApprovePublishJob({
        supabase: db,
        supabaseAdmin: db,
        userId: USER,
        input: approveInput(),
      }),
    ).rejects.toThrow(/only draft/i);
  });
});

describe("runExecutePublishJob — approval enforcement (PROOF)", () => {
  function approvedJobDb(overrides: Record<string, any> = {}) {
    return makeDb({
      publish_jobs: [draftJob({ status: "approved", ...overrides })],
      safety_scores: [{ project_id: "proj-1", user_id: USER, score: 80 }],
      approvals: [],
      publish_warnings: [],
    });
  }

  it("REJECTS when no approval row exists — uploader is NEVER called", async () => {
    const db = approvedJobDb();
    const uploader = makeUploader();
    await expect(
      runExecutePublishJob({
        supabase: db,
        supabaseAdmin: db,
        userId: USER,
        publishJobId: "job-1",
        uploader,
      }),
    ).rejects.toThrow(/no human approval/i);
    expect(uploader.calls).toHaveLength(0);
    // The job is marked failed with the reason (audit trail).
    expect(db.tables["publish_jobs"]![0]!.status).toBe("failed");
    expect(db.tables["publish_jobs"]![0]!.error).toMatch(/no human approval/i);
  });

  it("PROCEEDS once the approval row exists — uploader called exactly once", async () => {
    const db = approvedJobDb();
    db.tables["approvals"]!.push({
      user_id: USER,
      publish_job_id: "job-1",
      scope: "youtube-public",
      approver_id: USER,
    });
    const uploader = makeUploader();
    const res = await runExecutePublishJob({
      supabase: db,
      supabaseAdmin: db,
      userId: USER,
      publishJobId: "job-1",
      uploader,
    });
    expect(uploader.calls).toHaveLength(1);
    expect(res.videoId).toBe("yt-abc123");
    expect(res.url).toBe("https://youtu.be/yt-abc123");
    expect(db.tables["publish_jobs"]![0].status).toBe("published");
  });

  it("REJECTS a public publish whose CURRENT score is < 50 (defense in depth)", async () => {
    const db = approvedJobDb();
    db.tables["safety_scores"]! = [
      { project_id: "proj-1", user_id: USER, score: 42 },
    ];
    db.tables["approvals"]!.push({
      user_id: USER,
      publish_job_id: "job-1",
      scope: "youtube-public",
      approver_id: USER,
    });
    const uploader = makeUploader();
    await expect(
      runExecutePublishJob({
        supabase: db,
        supabaseAdmin: db,
        userId: USER,
        publishJobId: "job-1",
        uploader,
      }),
    ).rejects.toThrow(/blocked/i);
    expect(uploader.calls).toHaveLength(0);
  });

  it("private publish with score < 50 proceeds AND records a warning", async () => {
    const db = approvedJobDb({ privacy: "private" });
    db.tables["safety_scores"]! = [
      { project_id: "proj-1", user_id: USER, score: 42 },
    ];
    db.tables["approvals"]!.push({
      user_id: USER,
      publish_job_id: "job-1",
      scope: "youtube-private",
      approver_id: USER,
    });
    const uploader = makeUploader();
    const res = await runExecutePublishJob({
      supabase: db,
      supabaseAdmin: db,
      userId: USER,
      publishJobId: "job-1",
      uploader,
    });
    expect(uploader.calls).toHaveLength(1);
    expect(res.safetyWarning).toContain("42/100");
    const warnings = db.tables["publish_warnings"]!;
    expect(warnings).toHaveLength(1);
    expect(warnings[0].kind).toBe("safety-low-score");
    expect(warnings[0].message).toContain("42/100");
  });

  it("an approval for the WRONG scope does not authorize the publish", async () => {
    const db = approvedJobDb(); // privacy: public
    db.tables["approvals"]!.push({
      user_id: USER,
      publish_job_id: "job-1",
      scope: "youtube-private", // wrong scope
      approver_id: USER,
    });
    const uploader = makeUploader();
    await expect(
      runExecutePublishJob({
        supabase: db,
        supabaseAdmin: db,
        userId: USER,
        publishJobId: "job-1",
        uploader,
      }),
    ).rejects.toThrow(/no human approval/i);
    expect(uploader.calls).toHaveLength(0);
  });

  it("rejects jobs that are not approved/scheduled", async () => {
    const db = approvedJobDb({ status: "draft" });
    const uploader = makeUploader();
    await expect(
      runExecutePublishJob({
        supabase: db,
        supabaseAdmin: db,
        userId: USER,
        publishJobId: "job-1",
        uploader,
      }),
    ).rejects.toThrow(/not ready/i);
    expect(uploader.calls).toHaveLength(0);
  });
});
