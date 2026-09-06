import { describe, expect, it } from "vitest";
import { canonicalizeUrl, extractYouTubeVideoId } from "./canonicalize";

describe("extractYouTubeVideoId", () => {
  it("parses watch URLs", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("parses youtu.be", () => {
    expect(extractYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("parses shorts", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("returns null for non-youtube", () => {
    expect(extractYouTubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });
});

describe("canonicalizeUrl", () => {
  it("canonicalizes YouTube with tracking params", () => {
    const r = canonicalizeUrl(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&utm_source=x&feature=share#t=10",
    );
    expect(r.invalid).toBe(false);
    expect(r.platform).toBe("youtube");
    expect(r.platformId).toBe("dQw4w9WgXcQ");
    expect(r.canonicalUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("accepts scheme-less input", () => {
    const r = canonicalizeUrl("youtu.be/dQw4w9WgXcQ");
    expect(r.canonicalUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("marks empty as invalid", () => {
    expect(canonicalizeUrl("   ").invalid).toBe(true);
    expect(canonicalizeUrl("   ").canonicalUrl).toBeNull();
  });

  it("normalizes generic https hosts", () => {
    const r = canonicalizeUrl("HTTP://Example.COM/Path/?utm_campaign=a");
    expect(r.invalid).toBe(false);
    expect(r.platform).toBe("other");
    expect(r.canonicalUrl).toBe("https://example.com/Path");
  });
});
