/**
 * Phase 4 Stream D: engagement-insight mining + idea handoff tests.
 *
 * - Mining derives insights ONLY from stored comments (never invents).
 * - Re-running is idempotent (already-mined comments are skipped).
 * - createIdeaFromInsight files the idea under a per-user "Audience requests"
 *   research project and is a no-op on the second click.
 */
import { describe, expect, it } from "vitest";
import {
  createIdeaFromInsight,
  listEngagementInsights,
  mineEngagementInsights,
} from "./insights.server";
import { createMockAdmin } from "./mock-admin";

const COMMENTS = [
  {
    id: "cm1",
    user_id: "user-1",
    external_comment_id: "yt_c1",
    author: "Alice",
    body: "Can you please make a video about night trains in India?",
    like_count: 5,
    is_question: false,
    published_at: "2026-09-27T10:00:00Z",
    metadata: { video_id: "vid1" },
  },
  {
    id: "cm2",
    user_id: "user-1",
    external_comment_id: "yt_c2",
    author: "Bob",
    body: "What camera do you use?",
    like_count: 2,
    is_question: true,
    published_at: "2026-09-27T11:00:00Z",
    metadata: { video_id: "vid1" },
  },
  {
    id: "cm3",
    user_id: "user-1",
    external_comment_id: "yt_c3",
    author: "Cara",
    body: "Great video, keep it up",
    like_count: 0,
    is_question: false,
    published_at: "2026-09-27T12:00:00Z",
    metadata: { video_id: "vid1" },
  },
];

describe("mineEngagementInsights", () => {
  it("mines questions and audience requests from real comments only", async () => {
    const { admin, ops } = createMockAdmin({
      comments: () => COMMENTS,
      engagement_insights: () => [], // nothing mined yet
    });

    const result = await mineEngagementInsights(admin as never, { userId: "user-1" });

    expect(result.scanned).toBe(3);
    expect(result.audienceRequests).toBe(1);
    expect(result.questions).toBe(1);
    expect(result.skipped).toBe(0);

    const inserts = ops.filter((o) => o.table === "engagement_insights" && o.op === "insert");
    expect(inserts).toHaveLength(2);
    const kinds = inserts.map((i) => (i.payload as { kind: string }).kind).sort();
    expect(kinds).toEqual(["audience_request", "question"]);
    // The audience request carries the sourced topic — never invented.
    const req = inserts.find((i) => (i.payload as { kind: string }).kind === "audience_request")!;
    expect(
      ((req.payload as { payload: { topic: string } }).payload.topic as string).toLowerCase(),
    ).toContain("night trains");
    // Cara's "Great video" produced nothing.
    expect(
      inserts.every((i) => !(i.payload as { comment_id: string }).comment_id.includes("cm3")),
    ).toBe(true);
  });

  it("is idempotent: already-mined comments are skipped", async () => {
    // First insightExists call (cm1 audience_request) finds a row; the rest don't.
    let checks = 0;
    const { admin, ops } = createMockAdmin({
      comments: () => COMMENTS,
      engagement_insights: () => (++checks === 1 ? [{ id: "ins-1" }] : []),
    });
    const result = await mineEngagementInsights(admin as never, { userId: "user-1" });
    expect(result.scanned).toBe(3);
    expect(result.skipped).toBe(1);
    expect(result.questions).toBe(1);
    expect(result.audienceRequests).toBe(0);
    expect(ops.filter((o) => o.table === "engagement_insights" && o.op === "insert")).toHaveLength(
      1,
    );
  });
});

describe("createIdeaFromInsight", () => {
  const INSIGHT = {
    id: "ins-1",
    kind: "audience_request",
    payload: {
      comment_id: "cm1",
      external_comment_id: "yt_c1",
      author: "Alice",
      body: "Can you please make a video about night trains in India?",
      topic: "night trains in India",
      mined_at: "2026-09-28T00:00:00Z",
    },
  };

  it("creates a video_ideas row under an auto-created Audience requests project", async () => {
    let projectInserted = false;
    const { admin, ops } = createMockAdmin({
      engagement_insights: () => INSIGHT,
      research_projects: (op, payload) => {
        if (op !== "select") return null;
        // The .single() after insert carries the insert payload via lastWrite.
        if (
          payload &&
          typeof payload === "object" &&
          "title" in (payload as Record<string, unknown>)
        ) {
          projectInserted = true;
          return { id: "proj-1" };
        }
        return projectInserted ? [{ id: "proj-1" }] : [];
      },
      video_ideas: () => ({ id: "idea-1" }),
    });

    const result = await createIdeaFromInsight(admin as never, {
      userId: "user-1",
      insightId: "ins-1",
    });

    expect(result.ideaId).toBe("idea-1");
    expect(result.alreadyExisted).toBe(false);
    expect(result.projectId).toBe("proj-1");

    const projectInsert = ops.find((o) => o.table === "research_projects" && o.op === "insert");
    expect((projectInsert!.payload as { title: string }).title).toBe("Audience requests");

    const ideaInsert = ops.find((o) => o.table === "video_ideas" && o.op === "insert");
    const ideaPayload = ideaInsert!.payload as {
      title: string;
      user_id: string;
      project_id: string;
    };
    expect(ideaPayload.user_id).toBe("user-1");
    expect(ideaPayload.project_id).toBe("proj-1");
    expect(ideaPayload.title.toLowerCase()).toContain("night trains");

    // The insight is stamped with the idea id (second click is a no-op).
    const insightUpdate = ops.find((o) => o.table === "engagement_insights" && o.op === "update");
    expect((insightUpdate!.payload as { payload: { idea_id: string } }).payload.idea_id).toBe(
      "idea-1",
    );
  });

  it("second click on the same insight is a no-op returning the same idea", async () => {
    const { admin, ops } = createMockAdmin({
      engagement_insights: () => ({
        ...INSIGHT,
        payload: { ...INSIGHT.payload, idea_id: "idea-1" },
      }),
    });
    const result = await createIdeaFromInsight(admin as never, {
      userId: "user-1",
      insightId: "ins-1",
    });
    expect(result).toMatchObject({ ideaId: "idea-1", alreadyExisted: true });
    expect(ops.filter((o) => o.op === "insert")).toHaveLength(0);
  });

  it("throws for a missing insight", async () => {
    const { admin } = createMockAdmin({ engagement_insights: () => null });
    await expect(
      createIdeaFromInsight(admin as never, { userId: "user-1", insightId: "nope" }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("listEngagementInsights", () => {
  it("returns the user's insights newest-first", async () => {
    const { admin } = createMockAdmin({
      engagement_insights: () => [
        {
          id: "a",
          kind: "question",
          comment_id: "cm2",
          payload: {},
          created_at: "2026-09-28T01:00:00Z",
        },
      ],
    });
    const rows = await listEngagementInsights(admin as never, "user-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("question");
  });
});
