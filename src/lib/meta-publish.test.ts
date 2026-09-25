import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMetaLoginUrl,
  decryptMetaToken,
  encryptMetaToken,
  getInstagramPublishingLimit,
  META_CONNECT_SCOPES,
  MetaApiError,
  pollInstagramContainer,
  publishFacebookPageVideo,
  publishInstagramReel,
  signMetaState,
  startResumableUpload,
  verifyMetaState,
} from "./meta-publish.server";
import { PublishingDisabledError, TestAccountMismatchError } from "./publishing-gates.server";

const ENC_KEY = randomBytes(32).toString("base64");
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {
    META_TOKEN_ENCRYPTION_KEY: process.env["META_TOKEN_ENCRYPTION_KEY"],
    META_APP_SECRET: process.env["META_APP_SECRET"],
    META_APP_ID: process.env["META_APP_ID"],
    META_TEST_PAGE_ID: process.env["META_TEST_PAGE_ID"],
    META_TEST_IG_USER_ID: process.env["META_TEST_IG_USER_ID"],
  };
  process.env["META_TOKEN_ENCRYPTION_KEY"] = ENC_KEY;
  process.env["META_APP_SECRET"] = "test-meta-app-secret";
  process.env["META_APP_ID"] = "123456";
  delete process.env["META_TEST_PAGE_ID"];
  delete process.env["META_TEST_IG_USER_ID"];
  vi.unstubAllGlobals();
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.unstubAllGlobals();
});

/** Builds a fetch mock that dispatches on method+URL. */
function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const spy = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    return handler(u, init);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

const ok = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("Meta token encryption", () => {
  it("round-trips a page token", async () => {
    const stored = await encryptMetaToken("EAAB-long-lived-page-token");
    expect(stored.startsWith("enc1:")).toBe(true);
    expect(stored).not.toContain("EAAB-long-lived-page-token");
    expect(await decryptMetaToken(stored)).toBe("EAAB-long-lived-page-token");
  });

  it("fails closed without the key", async () => {
    delete process.env["META_TOKEN_ENCRYPTION_KEY"];
    await expect(encryptMetaToken("x")).rejects.toThrow("META_TOKEN_ENCRYPTION_KEY is not set");
    expect(await decryptMetaToken("enc1:bad.bad")).toBeNull();
  });
});

describe("Meta OAuth state", () => {
  it("round-trips and rejects tampering", async () => {
    const state = await signMetaState("user-1");
    expect(await verifyMetaState(state)).toBe("user-1");
    expect(await verifyMetaState(`${state}tampered`)).toBeNull();
    expect(await verifyMetaState("garbage")).toBeNull();
  });

  it("builds a login URL with the publish scopes", () => {
    const url = buildMetaLoginUrl({ appId: "123", origin: "https://app.test", state: "s" });
    expect(url).toContain("facebook.com/v26.0/dialog/oauth");
    expect(url).toContain(encodeURIComponent("https://app.test/api/public/meta-callback"));
    expect(META_CONNECT_SCOPES).toContain("pages_manage_posts");
    expect(META_CONNECT_SCOPES).toContain("instagram_content_publish");
  });
});

describe("publishFacebookPageVideo", () => {
  const input = {
    pageAccessToken: "PAGE_TOKEN",
    pageId: "111",
    videoUrl: "https://cdn.test/video.mp4",
    title: "Test video",
    description: "desc",
  };

  it("is DISABLED when META_TEST_PAGE_ID is unset — no network call", async () => {
    const spy = mockFetch(() => ok({ id: "x" }));
    await expect(publishFacebookPageVideo(input)).rejects.toThrow(PublishingDisabledError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses a page that is not the test page — no network call", async () => {
    process.env["META_TEST_PAGE_ID"] = "111";
    const spy = mockFetch(() => ok({ id: "x" }));
    await expect(
      publishFacebookPageVideo({ ...input, pageId: "999" }),
    ).rejects.toThrow(TestAccountMismatchError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("publishes via file_url to the test page", async () => {
    process.env["META_TEST_PAGE_ID"] = "111";
    const spy = mockFetch((url, init) => {
      expect(url).toBe("https://graph.facebook.com/v26.0/111/videos");
      expect(init?.method).toBe("POST");
      const body = init?.body as URLSearchParams;
      expect(body.get("file_url")).toBe("https://cdn.test/video.mp4");
      expect(body.get("title")).toBe("Test video");
      return ok({ id: "222_333" });
    });
    const { videoId } = await publishFacebookPageVideo(input);
    expect(videoId).toBe("222_333");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("schedules with published=false + scheduled_publish_time", async () => {
    process.env["META_TEST_PAGE_ID"] = "111";
    const future = new Date(Date.now() + 3600_000).toISOString();
    const spy = mockFetch((_url, init) => {
      const body = init?.body as URLSearchParams;
      expect(body.get("published")).toBe("false");
      expect(Number(body.get("scheduled_publish_time"))).toBeGreaterThan(
        Math.floor(Date.now() / 1000),
      );
      return ok({ id: "222_334" });
    });
    await publishFacebookPageVideo({ ...input, scheduledFor: future });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-future schedule without network I/O", async () => {
    process.env["META_TEST_PAGE_ID"] = "111";
    const spy = mockFetch(() => ok({ id: "x" }));
    await expect(
      publishFacebookPageVideo({ ...input, scheduledFor: new Date(Date.now() - 1000).toISOString() }),
    ).rejects.toThrow(MetaApiError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("surfaces Meta API errors", async () => {
    process.env["META_TEST_PAGE_ID"] = "111";
    mockFetch(() =>
      ok({ error: { message: "(#200) Permissions error", code: 200 } }, 400),
    );
    await expect(publishFacebookPageVideo(input)).rejects.toThrow(
      /\(#200\) Permissions error/,
    );
  });

  it("publishes large files from a resumable-upload handle via graph-video", async () => {
    process.env["META_TEST_PAGE_ID"] = "111";
    const spy = mockFetch((url, init) => {
      expect(url).toBe("https://graph-video.facebook.com/v26.0/111/videos");
      const body = init?.body as URLSearchParams;
      expect(body.get("fbuploader_video_file_chunk")).toBe("handle_abc");
      expect(body.get("title")).toBe("Test video");
      return ok({ id: "222_999" });
    });
    const { publishFacebookVideoFromHandle } = await import("./meta-publish.server");
    const { videoId } = await publishFacebookVideoFromHandle({
      pageAccessToken: "PAGE_TOKEN",
      pageId: "111",
      fileHandle: "handle_abc",
      title: "Test video",
    });
    expect(videoId).toBe("222_999");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("refuses the handle path for a non-test page — no network call", async () => {
    process.env["META_TEST_PAGE_ID"] = "111";
    const spy = mockFetch(() => ok({ id: "x" }));
    const { publishFacebookVideoFromHandle } = await import("./meta-publish.server");
    await expect(
      publishFacebookVideoFromHandle({
        pageAccessToken: "PAGE_TOKEN",
        pageId: "999",
        fileHandle: "handle_abc",
        title: "Test video",
      }),
    ).rejects.toThrow(TestAccountMismatchError);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("publishInstagramReel (container flow)", () => {
  const input = {
    accessToken: "PAGE_TOKEN",
    igUserId: "222",
    videoUrl: "https://cdn.test/reel.mp4",
    caption: "hello",
  };

  it("is DISABLED when META_TEST_IG_USER_ID is unset — no network call", async () => {
    const spy = mockFetch(() => ok({ id: "x" }));
    await expect(publishInstagramReel(input)).rejects.toThrow(PublishingDisabledError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses a non-test IG account — no network call", async () => {
    process.env["META_TEST_IG_USER_ID"] = "222";
    const spy = mockFetch(() => ok({ id: "x" }));
    await expect(publishInstagramReel({ ...input, igUserId: "999" })).rejects.toThrow(
      TestAccountMismatchError,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("runs create -> poll FINISHED -> publish", async () => {
    process.env["META_TEST_IG_USER_ID"] = "222";
    let polls = 0;
    const calls: string[] = [];
    const spy = mockFetch((url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url.split("?")[0]}`);
      // NOTE: /media_publish must be checked before /media — the latter is a
      // substring of the former.
      if (url.includes("/media_publish")) {
        const body = init?.body as URLSearchParams;
        expect(body.get("creation_id")).toBe("container_1");
        return ok({ id: "media_9" });
      }
      if (url.includes("/222/media") && (init?.method ?? "GET") === "POST") {
        const body = init?.body as URLSearchParams;
        expect(body.get("media_type")).toBe("REELS");
        expect(body.get("video_url")).toBe("https://cdn.test/reel.mp4");
        return ok({ id: "container_1" });
      }
      if (url.includes("/container_1?")) {
        polls++;
        return ok({ status_code: polls >= 2 ? "FINISHED" : "IN_PROGRESS" });
      }
      throw new Error(`unexpected call: ${url}`);
    });
    const { mediaId, containerId } = await publishInstagramReel(input, {
      maxAttempts: 5,
      intervalMs: 1,
    });
    expect(mediaId).toBe("media_9");
    expect(containerId).toBe("container_1");
    expect(polls).toBe(2);
    expect(calls).toEqual([
      "POST https://graph.facebook.com/v26.0/222/media",
      "GET https://graph.facebook.com/v26.0/container_1",
      "GET https://graph.facebook.com/v26.0/container_1",
      "POST https://graph.facebook.com/v26.0/222/media_publish",
    ]);
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it("never publishes an ERROR container", async () => {
    process.env["META_TEST_IG_USER_ID"] = "222";
    const calls: string[] = [];
    const spy = mockFetch((url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url.split("?")[0]}`);
      if (url.includes("/222/media") && init?.method === "POST") return ok({ id: "c_err" });
      if (url.includes("/c_err?")) return ok({ status_code: "ERROR" });
      throw new Error(`unexpected call (must not publish): ${url}`);
    });
    await expect(
      publishInstagramReel(input, { maxAttempts: 3, intervalMs: 1 }),
    ).rejects.toThrow(/error/i);
    // The media_publish step must never run for a failed container.
    expect(calls.every((c) => !c.includes("media_publish"))).toBe(true);
    // Only container-create + one status poll happened.
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("times out when the container never finishes", async () => {
    process.env["META_TEST_IG_USER_ID"] = "222";
    mockFetch((url, init) => {
      if (url.includes("/222/media") && init?.method === "POST") return ok({ id: "c_slow" });
      if (url.includes("/c_slow?")) return ok({ status_code: "IN_PROGRESS" });
      throw new Error(`unexpected call: ${url}`);
    });
    await expect(
      publishInstagramReel(input, { maxAttempts: 2, intervalMs: 1 }),
    ).rejects.toThrow(/did not finish/);
  });

  it("rejects captions over 2200 chars without network I/O", async () => {
    process.env["META_TEST_IG_USER_ID"] = "222";
    const spy = mockFetch(() => ok({ id: "x" }));
    await expect(
      publishInstagramReel({ ...input, caption: "x".repeat(2201) }),
    ).rejects.toThrow(/2200/);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("pollInstagramContainer", () => {
  it("returns immediately when already FINISHED", async () => {
    const spy = mockFetch(() => ok({ status_code: "FINISHED" }));
    await pollInstagramContainer("tok", "c1", { maxAttempts: 3, intervalMs: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("getInstagramPublishingLimit", () => {
  it("reads the live quota (never hardcoded)", async () => {
    mockFetch(() => ok({ quota_usage: 3, config: { quota_total: 50 } }));
    const limit = await getInstagramPublishingLimit("tok", "222");
    expect(limit).toEqual({ quotaUsage: 3, quotaTotal: 50 });
  });
});

describe("startResumableUpload", () => {
  it("starts a session against the app id", async () => {
    const spy = mockFetch((url, init) => {
      expect(url).toBe("https://graph.facebook.com/v26.0/123456/uploads");
      const body = init?.body as URLSearchParams;
      expect(body.get("file_length")).toBe("999");
      return ok({ id: "upload_session_7" });
    });
    const { uploadSessionId } = await startResumableUpload({
      accessToken: "tok",
      fileName: "video.mp4",
      fileLength: 999,
      fileType: "video/mp4",
    });
    expect(uploadSessionId).toBe("upload_session_7");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
