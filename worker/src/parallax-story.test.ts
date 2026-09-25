/**
 * Parallax + story mirror tests (run with: npx tsx --test worker/src/*.test.ts).
 *
 * Guards that the worker's dependency-free mirrors stay in sync with the
 * canonical src/ modules: same filter output for the same inputs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildParallaxFilter } from "./parallax.js";
import {
  assignStoryBeats,
  storyCaptionEmphasis,
  storyDuckParams,
  storyMusicSegments,
  storyMusicVolumeExpr,
  storyParallaxMultiplier,
} from "./story.js";

describe("worker parallax mirror", () => {
  it("emits the same chain as the canonical builder", async () => {
    const { buildParallaxFilter: canonical } = await import(
      "../../src/lib/render/parallax.js"
    );
    // tsx resolves the TS source directly; compare on identical inputs.
    const opts = { width: 1920, height: 1080, frames: 150, intensity: 0.7, direction: "out" as const };
    assert.equal(buildParallaxFilter(opts), (canonical as (o: typeof opts) => string)(opts));
  });

  it("zoom amplitude stays inside the overscan headroom", () => {
    const f = buildParallaxFilter({ width: 1080, height: 1920, frames: 90, intensity: 1 });
    assert.match(f, /s=1080x1920/);
    assert.match(f, /z='1\+0\.100000\*\(on\/90\)'/);
    assert.match(f, /scale=iw\*1\.120:ih\*1\.120/);
  });
});

describe("worker story mirror", () => {
  it("assigns the same beats as the canonical module", async () => {
    const canonical = await import("../../src/lib/story-template.js");
    const durations = [6, 6, 6, 6, 6, 6, 6, 6, 6, 6];
    assert.deepEqual(
      assignStoryBeats(durations),
      (canonical.assignStoryBeats as (d: number[]) => string[])(durations),
    );
  });

  it("music envelope matches the canonical expression", async () => {
    const canonical = await import("../../src/lib/story-template.js");
    const durations = [4, 12, 25, 12, 7];
    const segs = storyMusicSegments(durations);
    assert.deepEqual(
      segs,
      (canonical.storyMusicSegments as (d: number[]) => unknown)(durations),
    );
    assert.equal(
      storyMusicVolumeExpr(segs, 0.15),
      (canonical.storyMusicVolumeExpr as (s: unknown, v: number) => string)(segs, 0.15),
    );
  });

  it("hook/payoff keep caption emphasis; duck profile is the story one", () => {
    assert.equal(storyCaptionEmphasis("hook"), true);
    assert.equal(storyCaptionEmphasis("payoff"), true);
    assert.equal(storyCaptionEmphasis("setup"), false);
    assert.match(storyDuckParams(), /ratio=10/);
    assert.ok(storyParallaxMultiplier("rising_tension") === 1);
  });
});
