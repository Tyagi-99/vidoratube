import { afterEach, describe, expect, it, vi } from "vitest";
import { youtubeSearch, youtubeSearchConfigured } from "./search-youtube.server";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("youtubeSearch", () => {
  it("configured() is false until both the OAuth client and the Data API key exist", () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "");
    vi.stubEnv("YOUTUBE_API_KEY", "");
    expect(youtubeSearchConfigured()).toBe(false);
    expect(youtubeSearch.configured()).toBe(false);
  });

  it("unconfigured search() returns the honest envelope and makes no network call", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "");
    vi.stubEnv("YOUTUBE_API_KEY", "");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("must not be called");
    });

    const result = await youtubeSearch.search("lofi beats");

    expect(result.ok).toBe(false);
    expect(result.status).toBe("unconfigured");
    expect(result.output).toBeNull();
    expect(result.error?.code).toBe("unconfigured");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps search.list results to ContentMetadata without inventing metrics", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "cid");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "csecret");
    vi.stubEnv("YOUTUBE_API_KEY", "ykey");
    expect(youtubeSearch.configured()).toBe(true);

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => "",
        json: async () => ({
          items: [
            {
              id: { kind: "youtube#video", videoId: "abc123" },
              snippet: {
                title: "Real video",
                description: "A description",
                channelId: "chan1",
                channelTitle: "Some Channel",
                publishedAt: "2026-01-01T00:00:00Z",
                thumbnails: { high: { url: "https://i.ytimg.com/vi/abc123/hqdefault.jpg" } },
              },
            },
            {
              // non-video results are skipped, not fabricated
              id: { kind: "youtube#channel", channelId: "chan2" },
              snippet: { title: "A channel" },
            },
          ],
        }),
      } as unknown as Response;
    });

    const result = await youtubeSearch.search("test query", { maxResults: 5 });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("ok");
    expect(result.output).toHaveLength(1);
    const item = result.output?.[0];
    expect(item).toMatchObject({
      platform: "youtube",
      platformId: "abc123",
      canonicalUrl: "https://www.youtube.com/watch?v=abc123",
      title: "Real video",
      creatorName: "Some Channel",
    });
    // search.list has no statistics — metrics stay null, never invented
    expect(item?.metrics).toEqual({
      views: null,
      likes: null,
      comments: null,
      shares: null,
      followers: null,
    });
    expect(item?.durationSeconds).toBeNull();
  });
});
