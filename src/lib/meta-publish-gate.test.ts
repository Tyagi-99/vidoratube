import { describe, expect, it } from "vitest";
import { runPublishJobToMeta } from "./meta.functions";

/**
 * P0/P1/P2 fix proofs (2026-09-29 audit) for the Meta publish path.
 *
 * publishJobToMeta previously checked only the legacy assertPublishJobApproved
 * (job-row status + approved_by/approved_at), which the authenticated client
 * can FORGE via the publish_jobs RLS policy — bypassing the approvals table,
 * the safety gate, and the strict evidence gate entirely. It also never
 * verified the video finished rendering, and the atomic claim ran before the
 * gates (gate failures burned the job).
 *
 * These call the real runPublishJobToMeta core with a fake Supabase client
 * and a MOCK Meta uploader, proving:
 *
 *   1. A FORGED approval (approved_by/approved_at set on the job row, NO
 *      approvals-table record) is REJECTED — the mock uploader is NOT called.
 *   2. Score < 50 BLOCKS a public Meta publish at execution time.
 *   3. Strict mode + unconfirmed claims BLOCKS the Meta publish.
 *   4. A job whose video hasn't finished rendering is rejected.
 *   5. A fully-gated job (approval record + score OK + strict off + video
 *      completed) PROCEEDS and calls the uploader exactly once.
 */

interface FakeDb {
  from: (table: string) => any;
  tables: Record<string, any[]>;
}

function makeDb(initial: Record<string, any[]>): FakeDb {
  const seeded: Record<string, Record<string, unknown>[]> = {
    projects: [{ id: "proj-1", user_id: USER, research_strict_mode: false }],
    ...initial,
  };
  const tables: Record<string, any[]> = {};
  for (const [k, v] of Object.entries(seeded)) {
    tables[k] = v.map((r) => ({ ...r }));
  }

  function from(table: string) {
    const rows = (tables[table] ??= []);
    const filters: ((r: any) => boolean)[] = [];
    let orderCol: string | null = null;
    let orderAsc = true;
    let limitN: number | null = null;
    let updatePatch: any = null;
    let countExact = false;

    const applyWrite = (matched: any[]) => {
      if (updatePatch) {
        for (const r of matched) Object.assign(r, updatePatch);
      }
      return matched;
    };
    const query = () => {
      let r = rows.filter((row) => filters.every((f) => f(row)));
      if (orderCol) {
        r = [...r].sort((a, b) =>
          orderAsc ? (a[orderCol!] < b[orderCol!] ? -1 : 1) : a[orderCol!] > b[orderCol!] ? -1 : 1,
        );
      }
      if (limitN !== null) r = r.slice(0, limitN);
      return r;
    };

    const api: any = {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.count === "exact") countExact = true;
        return api;
      },
      eq: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val);
        return api;
      },
      neq: (col: string, val: unknown) => {
        filters.push((r) => r[col] !== val);
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
        rows.push({ ...row });
        return Promise.resolve({ data: row, error: null });
      },
      maybeSingle: async () => {
        const r = applyWrite(query());
        return { data: r[0] ?? null, error: null };
      },
      single: async () => {
        const r = applyWrite(query());
        return r[0] ? { data: r[0], error: null } : { data: null, error: { message: "no rows" } };
      },
      then: (resolve: (v: any) => void) => {
        const r = applyWrite(query());
        resolve(countExact ? { data: [], error: null, count: r.length } : { data: r, error: null });
      },
    };
    return api;
  }

  return { from, tables };
}

const USER = "user-1";

function approvedJob(overrides: Record<string, any> = {}) {
  return {
    id: "job-1",
    // The FORGERY: row-level approved_* columns set directly by the client —
    // this is what the old assertPublishJobApproved accepted.
    status: "approved",
    approved_by: USER,
    approved_at: new Date().toISOString(),
    project_id: "proj-1",
    video_job_id: "video-1",
    user_id: USER,
    title: "Test video",
    description: "desc",
    privacy: "public",
    made_for_kids: false,
    scheduled_for: null,
    ...overrides,
  };
}

function completedVideoJob() {
  return { id: "video-1", user_id: USER, status: "completed", result_url: "https://x/render.mp4" };
}

function makeMetaUploader() {
  const calls: any[] = [];
  return {
    calls,
    getConnection: async () => ({ page_id: "test-page", ig_user_id: "test-ig", access_token: "enc" }),
    decryptToken: async () => "page-token",
    assertTargetEnabled: (t: "facebook" | "instagram") => (t === "facebook" ? "test-page" : "test-ig"),
    videoUrl: async () => "https://x/signed.mp4",
    publishFacebook: async (input: any) => {
      calls.push({ target: "facebook", input });
      return { videoId: "fb-123" };
    },
    publishInstagram: async (input: any) => {
      calls.push({ target: "instagram", input });
      return { mediaId: "ig-456", permalink: "https://ig/p/456" };
    },
  };
}

describe("runPublishJobToMeta — forged approval is rejected (P0)", () => {
  it("REJECTS a job whose approval exists only as forged row columns", async () => {
    const db = makeDb({
      publish_jobs: [approvedJob()],
      video_jobs: [completedVideoJob()],
      approvals: [], // no unforgeable approval record
      safety_scores: [],
    });
    const up = makeMetaUploader();
    await expect(
      runPublishJobToMeta({
        supabase: db,
        supabaseAdmin: db,
        userId: USER,
        publishJobId: "job-1",
        targets: ["facebook"],
        metaUploader: up,
      }),
    ).rejects.toThrow(/no human approval/i);
    expect(up.calls).toHaveLength(0);
    // Gates run BEFORE the atomic claim: the job stays approved, not burned.
    expect(db.tables["publish_jobs"]![0]!.status).toBe("approved");
  });
});

describe("runPublishJobToMeta — safety gate (P1)", () => {
  it("BLOCKS a public Meta publish when the latest score is < 50", async () => {
    const db = makeDb({
      publish_jobs: [approvedJob()],
      video_jobs: [completedVideoJob()],
      approvals: [
        { user_id: USER, publish_job_id: "job-1", scope: "youtube-public", approver_id: USER },
      ],
      safety_scores: [{ project_id: "proj-1", user_id: USER, score: 30, created_at: "2026-09-29" }],
    });
    const up = makeMetaUploader();
    await expect(
      runPublishJobToMeta({
        supabase: db,
        supabaseAdmin: db,
        userId: USER,
        publishJobId: "job-1",
        targets: ["facebook", "instagram"],
        metaUploader: up,
      }),
    ).rejects.toThrow(/blocked/i);
    expect(up.calls).toHaveLength(0);
  });

  it("proceeds as private with score < 50 (warning path), like the YouTube path", async () => {
    const db = makeDb({
      publish_jobs: [approvedJob({ privacy: "private" })],
      video_jobs: [completedVideoJob()],
      approvals: [
        { user_id: USER, publish_job_id: "job-1", scope: "youtube-private", approver_id: USER },
      ],
      safety_scores: [{ project_id: "proj-1", user_id: USER, score: 30, created_at: "2026-09-29" }],
      publish_warnings: [],
    });
    const up = makeMetaUploader();
    const { results } = await runPublishJobToMeta({
      supabase: db,
      supabaseAdmin: db,
      userId: USER,
      publishJobId: "job-1",
      targets: ["facebook"],
      metaUploader: up,
    });
    expect(up.calls).toHaveLength(1);
    expect(results.facebook).toEqual({ postId: "fb-123" });
  });
});

describe("runPublishJobToMeta — strict evidence gate (P1)", () => {
  it("BLOCKS when strict mode is on and a claim is unconfirmed", async () => {
    const db = makeDb({
      projects: [{ id: "proj-1", user_id: USER, research_strict_mode: true }],
      publish_jobs: [approvedJob()],
      video_jobs: [completedVideoJob()],
      approvals: [
        { user_id: USER, publish_job_id: "job-1", scope: "youtube-public", approver_id: USER },
      ],
      safety_scores: [{ project_id: "proj-1", user_id: USER, score: 90, created_at: "2026-09-29" }],
      research_sources: [{ id: "src-1", project_id: "proj-1", user_id: USER }],
      research_claims: [
        { id: "claim-1", source_id: "src-1", user_id: USER, review_state: "unreviewed" },
      ],
    });
    const up = makeMetaUploader();
    await expect(
      runPublishJobToMeta({
        supabase: db,
        supabaseAdmin: db,
        userId: USER,
        publishJobId: "job-1",
        targets: ["instagram"],
        metaUploader: up,
      }),
    ).rejects.toThrow(/confirm/i);
    expect(up.calls).toHaveLength(0);
  });
});

describe("runPublishJobToMeta — video completion + happy path (P2)", () => {
  it("REJECTS when the attached video has not finished rendering", async () => {
    const db = makeDb({
      publish_jobs: [approvedJob()],
      video_jobs: [{ id: "video-1", user_id: USER, status: "running", result_url: null }],
      approvals: [
        { user_id: USER, publish_job_id: "job-1", scope: "youtube-public", approver_id: USER },
      ],
      safety_scores: [],
    });
    const up = makeMetaUploader();
    await expect(
      runPublishJobToMeta({
        supabase: db,
        supabaseAdmin: db,
        userId: USER,
        publishJobId: "job-1",
        targets: ["facebook"],
        metaUploader: up,
      }),
    ).rejects.toThrow(/not finished rendering/i);
    expect(up.calls).toHaveLength(0);
  });

  it("PROCEEDS when every gate is green and publishes to both targets", async () => {
    const db = makeDb({
      publish_jobs: [approvedJob()],
      video_jobs: [completedVideoJob()],
      approvals: [
        { user_id: USER, publish_job_id: "job-1", scope: "youtube-public", approver_id: USER },
      ],
      safety_scores: [{ project_id: "proj-1", user_id: USER, score: 90, created_at: "2026-09-29" }],
    });
    const up = makeMetaUploader();
    const { results, publishJob } = await runPublishJobToMeta({
      supabase: db,
      supabaseAdmin: db,
      userId: USER,
      publishJobId: "job-1",
      targets: ["facebook", "instagram"],
      metaUploader: up,
    });
    expect(up.calls).toHaveLength(2);
    expect(results.facebook).toEqual({ postId: "fb-123" });
    expect(results.instagram).toEqual({ mediaId: "ig-456", permalink: "https://ig/p/456" });
    expect(publishJob.status).toBe("published");
    expect(publishJob.meta_fb_post_id).toBe("fb-123");
    expect(publishJob.meta_ig_media_id).toBe("ig-456");
  });

  it("requires made-for-kids confirmation before anything else", async () => {
    const db = makeDb({
      publish_jobs: [approvedJob({ made_for_kids: null })],
      video_jobs: [completedVideoJob()],
      approvals: [
        { user_id: USER, publish_job_id: "job-1", scope: "youtube-public", approver_id: USER },
      ],
      safety_scores: [],
    });
    const up = makeMetaUploader();
    await expect(
      runPublishJobToMeta({
        supabase: db,
        supabaseAdmin: db,
        userId: USER,
        publishJobId: "job-1",
        targets: ["facebook"],
        metaUploader: up,
      }),
    ).rejects.toThrow(/made for kids/i);
    expect(up.calls).toHaveLength(0);
  });
});
