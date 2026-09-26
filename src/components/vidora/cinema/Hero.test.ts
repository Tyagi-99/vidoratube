import { describe, expect, it } from "vitest";
import { loopElapsed, sceneIndexForTime } from "./Hero";

// Regression coverage for the 2026-09-26 homepage crash:
// "TypeError: Cannot read properties of undefined (reading 'grade')"
// Root cause: on the first animation frame, the rAF timestamp can predate the
// performance.now() captured when the effect ran (observed in Firefox). The raw
// elapsed went a tiny negative, Math.floor(negative / 3) % 4 produced -1,
// SCENES[-1] was undefined, and `scene.grade` threw during render — unmounting
// the entire homepage. The stack pointed at the minified routes chunk,
// RenderMonitor's `o.grade` read (1:2843).

describe("loopElapsed", () => {
  it("never goes negative when the rAF timestamp predates the effect start", () => {
    // First-frame race: frame timestamp 0.2ms before performance.now().
    expect(loopElapsed(1000, 1000.2)).toBe(0);
  });

  it("advances normally", () => {
    expect(loopElapsed(3000, 1000)).toBeCloseTo(2);
  });

  it("wraps at TOTAL (12s loop)", () => {
    expect(loopElapsed(13000, 1000)).toBeCloseTo(0);
  });
});

describe("sceneIndexForTime", () => {
  it("maps the first-frame negative tick to scene 0, not -1", () => {
    // Pre-fix, the inline formula returned -1 here: the crash.
    expect(sceneIndexForTime(-0.0002)).toBe(0);
  });

  it("survives NaN and Infinity", () => {
    expect(sceneIndexForTime(NaN)).toBe(0);
    expect(sceneIndexForTime(Infinity)).toBe(0);
    expect(sceneIndexForTime(-Infinity)).toBe(0);
  });

  it("covers every scene across the 12s loop (3 scenes, 4s each)", () => {
    expect(sceneIndexForTime(0)).toBe(0);
    expect(sceneIndexForTime(3.999)).toBe(0);
    expect(sceneIndexForTime(4)).toBe(1);
    expect(sceneIndexForTime(8)).toBe(2);
    expect(sceneIndexForTime(11.999)).toBe(2);
  });

  it("wraps cleanly at the loop boundary", () => {
    expect(sceneIndexForTime(12)).toBe(0);
  });

  it("always returns a valid SCENES index", () => {
    for (let t = -5; t < 30; t += 0.25) {
      const i = sceneIndexForTime(t);
      expect(Number.isInteger(i)).toBe(true);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(3);
    }
  });
});
