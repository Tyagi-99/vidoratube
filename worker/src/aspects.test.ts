/**
 * Aspect dimension table test (run with: npx tsx --test src/*.test.ts).
 *
 * Guards the per-aspect output sizes the worker renders: the enqueue side
 * (src/lib/server-renders.functions.ts ASPECT_RESOLUTIONS) and the worker
 * pipeline must agree on these dimensions, otherwise a "9:16" job would
 * come out at the wrong size for Shorts/Reels.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ASPECTS } from "./pipeline.js";

describe("ASPECTS", () => {
  it("renders 16:9 at 1920x1080", () => {
    assert.deepEqual(ASPECTS["16:9"], { width: 1920, height: 1080 });
  });

  it("renders 9:16 at 1080x1920", () => {
    assert.deepEqual(ASPECTS["9:16"], { width: 1080, height: 1920 });
  });

  it("renders 1:1 at 1080x1080", () => {
    assert.deepEqual(ASPECTS["1:1"], { width: 1080, height: 1080 });
  });

  it("covers exactly the three supported aspects", () => {
    assert.deepEqual(Object.keys(ASPECTS).sort(), ["16:9", "1:1", "9:16"]);
  });
});
