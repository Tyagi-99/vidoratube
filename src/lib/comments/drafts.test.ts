/**
 * Phase 4 Stream D: draft-reply state machine tests.
 *
 * Safety invariants under test:
 *   1. draft → approved → posted is the ONLY path; postApprovedReply throws
 *      unless the stored status is exactly 'approved' (server-enforced).
 *   2. Creating a draft never touches the network (no auto-post).
 *   3. NO code path deletes platform comments — enforced by grepping the
 *      comments module source for delete-shaped calls.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  approveDraftReply,
  createDraftReply,
  getDraftReply,
  postApprovedReply,
} from "./drafts.server";
import { createMockAdmin } from "./mock-admin";

vi.mock("../youtube.server", () => ({
  getValidAccessToken: vi.fn(async () => ({ accessToken: "tok", refreshed: null })),
  encryptToken: vi.fn(async (s: string) => `enc:${s}`),
}));

const BASE_ROW = {
  id: "comment-1",
  user_id: "user-1",
  platform: "youtube",
  external_comment_id: "yt_c1",
  replied: false,
  metadata: {},
};

function adminWithComment(metadata: Record<string, unknown> | null) {
  return createMockAdmin({
    comments: () => ({ ...BASE_ROW, metadata: metadata ?? {} }),
    youtube_connections: () => ({
      access_token: "enc:tok",
      refresh_token: "enc:ref",
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }),
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("draft → approve → post state machine", () => {
  it("createDraftReply stores an inert draft and never touches the network", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { admin, ops } = adminWithComment({});

    const draft = await createDraftReply(admin as never, {
      userId: "user-1",
      commentId: "comment-1",
      text: "Thanks for watching!",
    });

    expect(draft).toMatchObject({
      text: "Thanks for watching!",
      status: "draft",
      approved_by: null,
      posted_at: null,
    });
    expect(fetch).not.toHaveBeenCalled();
    const update = ops.find((o) => o.table === "comments" && o.op === "update");
    expect(
      (update!.payload as { metadata: { draft_reply: { status: string } } }).metadata.draft_reply
        .status,
    ).toBe("draft");
  });

  it("postApprovedReply REFUSES to post an unapproved draft (the server gate)", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { admin } = adminWithComment({
      draft_reply: { text: "hi", status: "draft", approved_by: null, posted_at: null },
    });

    await expect(
      postApprovedReply(admin as never, { userId: "user-1", commentId: "comment-1" }),
    ).rejects.toThrow(/not approved/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("approveDraftReply moves draft → approved and stamps the approver", async () => {
    const { admin, ops } = adminWithComment({
      draft_reply: { text: "hi", status: "draft", approved_by: null, posted_at: null },
    });
    const draft = await approveDraftReply(admin as never, {
      userId: "user-1",
      commentId: "comment-1",
    });
    expect(draft.status).toBe("approved");
    expect(draft.approved_by).toBe("user-1");
    const update = ops.find((o) => o.table === "comments" && o.op === "update");
    expect(
      (update!.payload as { metadata: { draft_reply: { status: string } } }).metadata.draft_reply
        .status,
    ).toBe("approved");
  });

  it("approveDraftReply throws when there is no draft", async () => {
    const { admin } = adminWithComment({});
    await expect(
      approveDraftReply(admin as never, { userId: "user-1", commentId: "comment-1" }),
    ).rejects.toThrow(/no draft/i);
  });

  it("postApprovedReply posts an approved draft via comments.insert, then marks posted+replied", async () => {
    const fetch = vi.fn(
      async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response,
    );
    vi.stubGlobal("fetch", fetch);
    const { admin, ops } = adminWithComment({
      draft_reply: { text: "Thanks!", status: "approved", approved_by: "user-1", posted_at: null },
    });

    const result = await postApprovedReply(admin as never, {
      userId: "user-1",
      commentId: "comment-1",
    });

    expect(result.posted).toBe(true);
    expect(result.draft.status).toBe("posted");
    expect(result.draft.posted_at).not.toBeNull();
    // The platform call is comments.insert with parentId — never a delete.
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("youtube/v3/comments");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.snippet.parentId).toBe("yt_c1");
    expect(body.snippet.textOriginal).toBe("Thanks!");
    // Bookkeeping: replied=true, status posted.
    const update = ops.find((o) => o.table === "comments" && o.op === "update");
    const payload = update!.payload as {
      replied: boolean;
      metadata: { draft_reply: { status: string } };
    };
    expect(payload.replied).toBe(true);
    expect(payload.metadata.draft_reply.status).toBe("posted");
  });

  it("postApprovedReply returns needs_reconnect (draft kept) when the grant lacks scope", async () => {
    const fetch = vi.fn(
      async () => ({ ok: false, status: 403, json: async () => ({}) }) as Response,
    );
    vi.stubGlobal("fetch", fetch);
    const { admin, ops } = adminWithComment({
      draft_reply: { text: "Thanks!", status: "approved", approved_by: "user-1", posted_at: null },
    });
    const result = await postApprovedReply(admin as never, {
      userId: "user-1",
      commentId: "comment-1",
    });
    expect(result.posted).toBe(false);
    if (!result.posted) expect(result.reason).toBe("needs_reconnect");
    // The draft is NOT marked posted; nothing is lost.
    expect(ops.filter((o) => o.table === "comments" && o.op === "update")).toHaveLength(0);
  });

  it("getDraftReply returns null when no draft exists", async () => {
    const { admin } = adminWithComment({});
    expect(
      await getDraftReply(admin as never, { userId: "user-1", commentId: "comment-1" }),
    ).toBeNull();
  });
});

describe("no platform comment-delete code path", () => {
  const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

  it("no comments module source calls a platform delete endpoint", () => {
    const files = [
      "sentiment.ts",
      "youtube-ingest.server.ts",
      "insights.server.ts",
      "drafts.server.ts",
      "comments.functions.ts",
    ];
    const offenders: string[] = [];
    for (const f of files) {
      const raw = readFileSync(join(MODULE_DIR, f), "utf8");
      // Strip comments: doc comments legitimately SAY "never delete" —
      // only executable code counts.
      const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
      const hits = src.match(
        /(commentThreads\.delete|comments\.delete|\.delete\(|method:\s*["']DELETE["'])/g,
      );
      if (hits) offenders.push(`${f}: ${hits.join("; ")}`);
    }
    expect(offenders).toEqual([]);
  });
});
