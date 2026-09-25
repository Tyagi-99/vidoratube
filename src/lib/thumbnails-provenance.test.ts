import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildThumbnailPrompt,
  THUMBNAIL_VARIANTS,
} from "./thumbnails";
import { hashThumbnailPrompt, requestThumbnailImage } from "./thumbnails.server";

describe("THUMBNAIL_VARIANTS", () => {
  it("generates 4 AI variants per video", () => {
    expect(THUMBNAIL_VARIANTS).toBe(4);
  });

  it("gives variant 4 a distinct composition from variants 1-3", () => {
    const prompts = [1, 2, 3, 4].map((variant) =>
      buildThumbnailPrompt({ videoTitle: "T", videoTopic: "x", variant, aspect: "16:9" }),
    );
    expect(new Set(prompts).size).toBe(4);
  });
});

describe("hashThumbnailPrompt (provenance)", () => {
  it("is a stable 64-char hex SHA-256", () => {
    const h = hashThumbnailPrompt("YouTube thumbnail, 1280x720 landscape: ...");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashThumbnailPrompt("YouTube thumbnail, 1280x720 landscape: ...")).toBe(h);
  });

  it("differs for different prompts", () => {
    expect(hashThumbnailPrompt("prompt one")).not.toBe(hashThumbnailPrompt("prompt two"));
  });

  it("differs per variant, so each variant's provenance is distinct", () => {
    const hashes = [1, 2, 3, 4].map((variant) =>
      hashThumbnailPrompt(
        buildThumbnailPrompt({ videoTitle: "T", videoTopic: "x", variant, aspect: "16:9" }),
      ),
    );
    expect(new Set(hashes).size).toBe(4);
  });
});

describe("requestThumbnailImage (mocked image gen)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const pngBytes = Uint8Array.from([137, 80, 78, 71]);

  function mockFetchOk() {
    vi.stubEnv("LOVABLE_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ b64_json: Buffer.from(pngBytes).toString("base64") }],
        }),
      }),
    );
  }

  it("returns decoded image bytes on success", async () => {
    mockFetchOk();
    const bytes = await requestThumbnailImage("a thumbnail prompt");
    expect(bytes).toEqual(pngBytes);
  });

  it("sends the prompt to the gateway image model", async () => {
    mockFetchOk();
    await requestThumbnailImage("my prompt");
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as { model: string; messages: { content: string }[] };
    expect(body.model).toBe("google/gemini-2.5-flash-image");
    expect(body.messages[0]?.content).toBe("my prompt");
  });

  it("throws when the gateway rejects the request", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429 }),
    );
    await expect(requestThumbnailImage("p")).rejects.toThrow(/429/);
  });

  it("throws when the gateway returns no image", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) }),
    );
    await expect(requestThumbnailImage("p")).rejects.toThrow(/no image/i);
  });
});
