import { describe, expect, it } from "vitest";
import { cronSchema, emptySchema, insightsSchema, videoSchema } from "./analytics.functions";

describe("analytics input schemas", () => {
  it("emptySchema accepts an empty object", () => {
    expect(() => emptySchema.parse({})).not.toThrow();
  });

  it("cronSchema requires a non-empty secret", () => {
    expect(() => cronSchema.parse({ cron_secret: "abc" })).not.toThrow();
    expect(() => cronSchema.parse({ cron_secret: "" })).toThrow();
    expect(() => cronSchema.parse({})).toThrow();
  });

  it("videoSchema validates YouTube video id shape", () => {
    expect(() => videoSchema.parse({ youtube_video_id: "dQw4w9WgXcQ" })).not.toThrow();
    expect(() => videoSchema.parse({ youtube_video_id: "ab" })).toThrow();
    expect(() => videoSchema.parse({ youtube_video_id: "x".repeat(21) })).toThrow();
  });

  it("insightsSchema accepts optional kind and defaults limit", () => {
    const parsed = insightsSchema.parse({});
    expect(parsed.limit).toBe(20);
    expect(() => insightsSchema.parse({ kind: "pattern" })).not.toThrow();
    expect(() => insightsSchema.parse({ kind: "bogus" })).toThrow();
    expect(() => insightsSchema.parse({ limit: 500 })).toThrow();
  });
});
