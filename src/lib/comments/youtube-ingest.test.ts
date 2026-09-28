/**
 * Phase 4 Stream D: YouTube comment ingestion tests.
 *
 * - Without credentials → honest "unavailable", zero network calls, zero
 *   fabricated comments.
 * - Idempotent upserts on UNIQUE(user_id, platform, external_comment_id):
 *   re-ingesting the same video refreshes rows, never duplicates them.
 * - Sentiment + question classification runs at ingest time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ingestYouTubeComments, listIngestibleVideos } from "./youtube-ingest.server";
import { createMockAdmin } from "./mock-admin";

vi.mock("../youtube.server", () => ({
  getValidAccessToken: vi.fn(async () => ({ accessToken: "tok", refreshed: null })),
  encryptToken: vi.fn(async (s: string) => `enc:${s}`),
}));

const THREADS_PAGE = {
  items: [
    {
      id: "thread1",
      snippet: {
        topLevelComment: {
          id: "c1",
          snippet: {
            authorDisplayName: "Alice",
            textDisplay: "Can you please make a video about night trains?",
            likeCount: 5,
            publishedAt: "2026-09-27T10:00:00Z",
          },
        },
        replies: {
          comments: [
            {
              id: "c1r1",
              snippet: {
                authorDisplayName: "Bob",
                textDisplay: "yes please, this channel is amazing",
                likeCount: 1,
                publishedAt: "2026-09-27T11:00:00Z",
              },
            },
          ],
        },
      },
    },
    {
      id: "thread2",
      snippet: {
        topLevelComment: {
          id: "c2",
          snippet: {
            authorDisplayName: "Cara",
            textDisplay: "What camera do you use?",
            likeCount: 2,
            publishedAt: "2026-09-27T12:00:00Z",
          },
        },
      },
    },
  ],
};

function mockThreadsFetch(pages: unknown[] = [THREADS_PAGE]) {
  let calls = 0;
  const fetch = vi.fn(async () => {
    const page = pages[Math.min(calls, pages.length - 1)];
    calls++;
    return { ok: true, status: 200, json: async () => page } as Response;
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, calls: () => calls };
}

const CONNECTION = {
  access_token: "enc:tok",
  refresh_token: "enc:ref",
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ingestYouTubeComments", () => {
  it("returns unavailable (never fake) when no YouTube connection exists", async () => {
    const { fetch } = mockThreadsFetch();
    const { admin, ops } = createMockAdmin({
      youtube_connections: () => null, // no grant
    });

    const result = await ingestYouTubeComments(admin as never, {
      userId: "user-1",
      videoId: "vid123",
    });

    expect(result.status).toBe("unavailable");
    expect(result.reason).toBe("no_youtube_connection");
    expect(result.fetched).toBe(0);
    // Zero network calls: no fabricated comments, no silent fixture fallback.
    expect(fetch).not.toHaveBeenCalled();
    // Nothing written anywhere.
    expect(ops.filter((o) => o.op !== "select")).toHaveLength(0);
  });

  it("ingests top-level comments + replies with classification, idempotently", async () => {
    mockThreadsFetch();
    // First run: all rows look freshly inserted; second run: all refreshed.
    let run = 0;
    const { admin, ops } = createMockAdmin({
      youtube_connections: () => CONNECTION,
      comments: (_op, payload) => {
        run++;
        const rows = (payload as { external_comment_id: string }[]) ?? [];
        const created = "2026-09-28T00:00:00Z";
        return rows.map((r) => ({
          external_comment_id: r.external_comment_id,
          created_at: created,
          updated_at: run === 1 ? created : "2026-09-28T01:00:00Z",
        }));
      },
    });

    const first = await ingestYouTubeComments(admin as never, {
      userId: "user-1",
      videoId: "vid123",
    });
    expect(first.status).toBe("ok");
    expect(first.fetched).toBe(3); // 2 top-level + 1 reply
    expect(first.inserted).toBe(3);
    expect(first.updated).toBe(0);
    expect(first.questions).toBe(2); // "Can you..." + "What camera..."

    const upserts = ops.filter((o) => o.table === "comments" && o.op === "upsert");
    expect(upserts).toHaveLength(1);
    const rows = upserts[0]!.payload as {
      external_comment_id: string;
      sentiment: string;
      is_question: boolean;
      metadata: Record<string, unknown>;
    }[];
    expect(rows.map((r) => r.external_comment_id).sort()).toEqual(["c1", "c1r1", "c2"]);
    // Sentiment ran at ingest: the "amazing" reply is positive.
    expect(rows.find((r) => r.external_comment_id === "c1r1")!.sentiment).toBe("positive");
    expect(rows.find((r) => r.external_comment_id === "c2")!.is_question).toBe(true);
    // Provenance recorded, never invented.
    expect(rows[0]!.metadata["source"]).toBe("youtube_data_api");

    // Second run over the same video: same rows, refreshed not duplicated.
    const second = await ingestYouTubeComments(admin as never, {
      userId: "user-1",
      videoId: "vid123",
    });
    expect(second.status).toBe("ok");
    expect(second.fetched).toBe(3);
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(3);
  });

  it("upserts on the pinned unique key (user_id, platform, external_comment_id)", async () => {
    mockThreadsFetch();
    const { admin, ops } = createMockAdmin({
      youtube_connections: () => CONNECTION,
      comments: (_op, payload) => (payload as unknown[]).map(() => ({})),
    });
    await ingestYouTubeComments(admin as never, { userId: "user-1", videoId: "vid123" });
    const upsert = ops.find((o) => o.table === "comments" && o.op === "upsert");
    expect(upsert).toBeDefined();
    expect((upsert!.options as { onConflict?: string }).onConflict).toBe(
      "user_id,platform,external_comment_id",
    );
    // Every row carries the user + platform so the unique key is meaningful.
    const rows = upsert!.payload as { user_id: string; platform: string }[];
    for (const r of rows) {
      expect(r.user_id).toBe("user-1");
      expect(r.platform).toBe("youtube");
    }
  });

  it("returns unavailable when the grant is dead (401 from YouTube)", async () => {
    const fetch = vi.fn(
      async () => ({ ok: false, status: 401, json: async () => ({}) }) as Response,
    );
    vi.stubGlobal("fetch", fetch);
    const { admin } = createMockAdmin({ youtube_connections: () => CONNECTION });
    const result = await ingestYouTubeComments(admin as never, {
      userId: "user-1",
      videoId: "vid123",
    });
    expect(result.status).toBe("unavailable");
    expect(result.reason).toBe("token_revoked");
  });
});

describe("listIngestibleVideos", () => {
  it("maps publish jobs to ingestible video descriptors", async () => {
    const { admin, ops } = createMockAdmin({
      publish_jobs: () => [{ id: "j1", title: "My video", youtube_video_id: "yt1" }],
    });
    const videos = await listIngestibleVideos(admin as never, "user-1");
    expect(videos).toEqual([{ publishJobId: "j1", youtubeVideoId: "yt1", title: "My video" }]);
    expect(ops.some((o) => o.table === "publish_jobs" && o.op === "select")).toBe(true);
  });
});
