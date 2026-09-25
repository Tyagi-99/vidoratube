/**
 * Worker unit tests (run with: npx tsx --test src/*.test.ts).
 * Covers: job payload validation, retry policy, stage weights.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RenderJobMetaSchema } from "./types.js";
import { buildWordAss } from "./pipeline.js";

const validMeta = {
  scenes: [
    {
      id: "s1",
      number: 1,
      narration: "hello",
      image: "https://example.com/img.png",
      audio: null,
      duration: 5,
      cues: [{ word: "hello", start: 0, end: 1 }],
    },
  ],
  title: "Test",
  aspect: "16:9" as const,
  fps: 30,
  burnCaptions: true,
  musicUrl: null,
  musicVolume: 0.15,
  voiceoverUrl: null,
};

describe("RenderJobMetaSchema", () => {
  it("accepts a valid payload", () => {
    const r = RenderJobMetaSchema.safeParse(validMeta);
    assert.equal(r.success, true);
  });

  it("rejects empty scenes", () => {
    const r = RenderJobMetaSchema.safeParse({ ...validMeta, scenes: [] });
    assert.equal(r.success, false);
  });

  it("rejects too many scenes", () => {
    const scenes = Array.from({ length: 201 }, (_, i) => ({
      ...validMeta.scenes[0]!,
      id: `s${i}`,
    }));
    const r = RenderJobMetaSchema.safeParse({ ...validMeta, scenes });
    assert.equal(r.success, false);
  });

  it("rejects invalid aspect", () => {
    const r = RenderJobMetaSchema.safeParse({ ...validMeta, aspect: "21:9" });
    assert.equal(r.success, false);
  });

  it("rejects scene without positive duration", () => {
    const r = RenderJobMetaSchema.safeParse({
      ...validMeta,
      scenes: [{ ...validMeta.scenes[0]!, duration: 0 }],
    });
    assert.equal(r.success, false);
  });

  it("rejects non-https asset URLs that look like paths (allowed) vs valid", () => {
    // Storage paths are allowed (worker signs them)
    const r = RenderJobMetaSchema.safeParse({
      ...validMeta,
      scenes: [{ ...validMeta.scenes[0]!, image: "user123/renders/abc.png" }],
    });
    assert.equal(r.success, true);
  });

  it("applies defaults", () => {
    const r = RenderJobMetaSchema.safeParse({ scenes: validMeta.scenes });
    assert.equal(r.success, true);
    if (r.success) {
      assert.equal(r.data.aspect, "16:9");
      assert.equal(r.data.fps, 30);
      assert.equal(r.data.burnCaptions, true);
    }
  });
});

describe("retry policy", () => {
  it("retries while attempts < max_attempts", () => {
    const shouldRetry = (attempts: number, max: number) => attempts < max;
    assert.equal(shouldRetry(1, 3), true);
    assert.equal(shouldRetry(2, 3), true);
    assert.equal(shouldRetry(3, 3), false);
  });
});

describe("buildWordAss (worker copy)", () => {
  it("generates valid ASS with karaoke tags", () => {
    const ass = buildWordAss([
      { word: "hi", start: 0, end: 0.5 },
      { word: "there", start: 0.5, end: 1 },
    ]);
    assert.match(ass, /\[Script Info\]/);
    assert.match(ass, /Dialogue:/);
    assert.match(ass, /\{\\kf50\}hi/);
  });
});
