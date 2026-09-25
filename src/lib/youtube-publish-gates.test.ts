import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  publishVideoJob,
  setVideoThumbnail,
} from "./youtube-publish.server";
import {
  PublishingDisabledError,
  PublishNotApprovedError,
  TestAccountMismatchError,
} from "./publishing-gates.server";

const UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
const FORCE_SSL_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = { YOUTUBE_TEST_CHANNEL_ID: process.env["YOUTUBE_TEST_CHANNEL_ID"] };
  delete process.env["YOUTUBE_TEST_CHANNEL_ID"];
  vi.unstubAllGlobals();
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.unstubAllGlobals();
});

const connectionFor = (channelId: string) => ({
  user_id: "u1",
  access_token: "ya29.plaintext-test-token",
  refresh_token: "refresh",
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
  scope: `${UPLOAD_SCOPE} ${FORCE_SSL_SCOPE}`,
  channel_id: channelId,
});

const approvedJob = () => ({
  status: "approved",
  approved_by: "u1",
  approved_at: new Date().toISOString(),
});

/** Minimal thenable Supabase admin double for publishVideoJob/setVideoThumbnail. */
function makeAdmin(opts: {
  connection: unknown;
  publishJob?: unknown;
  videoJob?: unknown;
  thumbnail?: unknown;
}) {
  const inserted: { table: string; row: unknown }[] = [];
  const chain = (table: string): unknown => {
    const self: Record<string, unknown> = {
      select: () => self,
      eq: () => self,
      is: () => self,
      in: () => self,
      update: () => self,
      insert: (row: unknown) => {
        inserted.push({ table, row });
        return Promise.resolve({ error: null });
      },
      maybeSingle: () => {
        if (table === "youtube_connections") return Promise.resolve({ data: opts.connection });
        if (table === "publish_jobs") return Promise.resolve({ data: opts.publishJob ?? null });
        if (table === "video_jobs") return Promise.resolve({ data: opts.videoJob });
        if (table === "thumbnails") return Promise.resolve({ data: opts.thumbnail });
        return Promise.resolve({ data: null });
      },
      single: () => (self["maybeSingle"] as () => Promise<unknown>)(),
    };
    return self;
  };
  return {
    admin: {
      from: chain,
      storage: {
        from: () => ({
          createSignedUrl: async () => ({
            data: { signedUrl: "https://cdn.test/f.mp4" },
            error: null,
          }),
        }),
      },
    } as unknown as SupabaseClient,
    inserted,
  };
}

function mockYouTubeApi() {
  const calls: string[] = [];
  const spy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push(`${method} ${u.split("?")[0]}`);
    if (u === "https://cdn.test/f.mp4" && method === "HEAD") {
      return new Response(null, { status: 200, headers: { "content-length": "16" } });
    }
    if (u === "https://cdn.test/f.mp4") {
      return new Response(new Uint8Array(16), { status: 200 });
    }
    if (u.includes("uploadType=resumable")) {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { location: "https://upl.test/sess" },
      });
    }
    if (u === "https://upl.test/sess") {
      return new Response(JSON.stringify({ id: "yt_123" }), { status: 200 });
    }
    if (u.includes("/thumbnails/set")) {
      return new Response(JSON.stringify({}), { status: 200 });
    }
    throw new Error(`unexpected network call (must stay local): ${method} ${u}`);
  });
  vi.stubGlobal("fetch", spy);
  return { spy, calls };
}

const baseOpts = {
  userId: "u1",
  videoJobId: "vj1",
  title: "T",
  description: "D",
  tags: ["test"],
  privacy: "private" as const,
  madeForKids: false,
  projectId: "p1",
};

describe("publishVideoJob test-channel + approval gates", () => {
  it("BLOCKS the upload when YOUTUBE_TEST_CHANNEL_ID is unset — zero network I/O", async () => {
    const { admin } = makeAdmin({ connection: connectionFor("UC_test") });
    const { spy } = mockYouTubeApi();
    await expect(publishVideoJob(admin, { ...baseOpts })).rejects.toThrow(
      PublishingDisabledError,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("BLOCKS when the connected channel is not the test channel — zero network I/O", async () => {
    process.env["YOUTUBE_TEST_CHANNEL_ID"] = "UC_test";
    const { admin } = makeAdmin({ connection: connectionFor("UC_someone_else") });
    const { spy } = mockYouTubeApi();
    await expect(publishVideoJob(admin, { ...baseOpts })).rejects.toThrow(
      TestAccountMismatchError,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("BLOCKS a publish job without the approval record", async () => {
    process.env["YOUTUBE_TEST_CHANNEL_ID"] = "UC_test";
    const { admin } = makeAdmin({
      connection: connectionFor("UC_test"),
      publishJob: { status: "draft", approved_by: null, approved_at: null },
      videoJob: { project_id: "p1", storage_path: "generated-videos/abc/vid.mp4" },
    });
    const { spy } = mockYouTubeApi();
    await expect(
      publishVideoJob(admin, { ...baseOpts, publishJobId: "pj1" }),
    ).rejects.toThrow(PublishNotApprovedError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("uploads to the test channel and records quota when channel matches + job approved", async () => {
    process.env["YOUTUBE_TEST_CHANNEL_ID"] = "UC_test";
    const { admin, inserted } = makeAdmin({
      connection: connectionFor("UC_test"),
      publishJob: approvedJob(),
      videoJob: { project_id: "p1", storage_path: "generated-videos/abc/vid.mp4" },
    });
    const { calls } = mockYouTubeApi();
    const result = await publishVideoJob(admin, { ...baseOpts, publishJobId: "pj1" });
    expect(result.videoId).toBe("yt_123");
    expect(calls).toContain("POST https://www.googleapis.com/upload/youtube/v3/videos");
    // videos.insert is recorded in its dedicated daily bucket (1 call), not
    // the old 1,600-unit flat cost.
    const quota = inserted.find((i) => i.table === "api_usage");
    expect(quota).toBeDefined();
    const row = quota!.row as Record<string, unknown>;
    expect(row["provider"]).toBe("youtube");
    expect(row["operation"]).toBe("videos.insert");
    expect(row["units"]).toBe(1);
    expect(row["estimated_cost"]).toBe(0);
    const meta = row["meta"] as Record<string, unknown>;
    expect(meta["quota_bucket"]).toBe("videos.insert");
    expect(meta["cost_basis"]).toBe("youtube-quota-units-not-usd");
  });

  it("works without publishJobId (direct caller retains its own approval responsibility)", async () => {
    process.env["YOUTUBE_TEST_CHANNEL_ID"] = "UC_test";
    const { admin } = makeAdmin({
      connection: connectionFor("UC_test"),
      videoJob: { project_id: "p1", storage_path: "generated-videos/abc/vid.mp4" },
    });
    mockYouTubeApi();
    const result = await publishVideoJob(admin, { ...baseOpts });
    expect(result.videoId).toBe("yt_123");
  });
});

describe("setVideoThumbnail test-channel gate + quota", () => {
  const opts = {
    userId: "u1",
    videoJobId: "vj1",
    videoId: "yt_123",
    thumbnailId: "t1",
  };

  it("BLOCKS when YOUTUBE_TEST_CHANNEL_ID is unset — zero network I/O", async () => {
    const { admin } = makeAdmin({ connection: connectionFor("UC_test") });
    const { spy } = mockYouTubeApi();
    await expect(setVideoThumbnail(admin, opts)).rejects.toThrow(PublishingDisabledError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("sets the thumbnail and records 50 shared-pool units", async () => {
    process.env["YOUTUBE_TEST_CHANNEL_ID"] = "UC_test";
    const { admin, inserted } = makeAdmin({
      connection: connectionFor("UC_test"),
      thumbnail: { final_url: "generated-videos/abc/thumb.jpg", url: null },
    });
    mockYouTubeApi();
    await setVideoThumbnail(admin, opts);
    const quota = inserted.find((i) => i.table === "api_usage");
    const row = (quota!.row as Record<string, unknown>);
    expect(row["operation"]).toBe("thumbnails.set");
    expect(row["units"]).toBe(50);
    expect((row["meta"] as Record<string, unknown>)["quota_bucket"]).toBe("shared-pool");
  });
});
