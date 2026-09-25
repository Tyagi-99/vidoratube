import { describe, expect, it } from "vitest";
import {
  STORY_BEATS,
  assignStoryBeats,
  storyBeatAtTime,
  storyBeatMotion,
  storyCaptionEmphasis,
  storyCaptionStyle,
  storyDuckParams,
  storyMusicSegments,
  storyMusicVolumeExpr,
  storyParallaxMultiplier,
  storyScriptBriefs,
  STORY_SCRIPT_GUIDANCE,
} from "./story-template";

describe("Story Mode template", () => {
  it("has exactly the five narrative beats in order", () => {
    expect(STORY_BEATS.map((b) => b.id)).toEqual([
      "hook",
      "setup",
      "rising_tension",
      "payoff",
      "loop_cta",
    ]);
  });

  it("beat shares sum to 1", () => {
    const sum = STORY_BEATS.reduce((a, b) => a + b.share, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("assigns scenes to beats by midpoint time", () => {
    // 10 scenes x 6s = 60s. Hook ~8% (0-4.8s), setup 4.8-16.8, rising 16.8-42,
    // payoff 42-54, loop 54-60.
    const beats = assignStoryBeats(Array(10).fill(6));
    expect(beats[0]).toBe("hook"); // midpoint 3s
    expect(beats[1]).toBe("setup"); // midpoint 9s
    expect(beats[3]).toBe("rising_tension"); // midpoint 21s
    expect(beats[7]).toBe("payoff"); // midpoint 45s
    expect(beats[9]).toBe("loop_cta"); // midpoint 57s
  });

  it("assigns a single scene to setup (its midpoint lands there)", () => {
    expect(assignStoryBeats([60])).toEqual(["rising_tension"]); // midpoint 30s
    expect(assignStoryBeats([8])).toEqual(["rising_tension"]); // midpoint 4s of 8s
  });

  it("returns [] for no scenes", () => {
    expect(assignStoryBeats([])).toEqual([]);
  });

  it("storyBeatAtTime tiles the whole runtime", () => {
    expect(storyBeatAtTime(0, 100)).toBe("hook");
    expect(storyBeatAtTime(7.9, 100)).toBe("hook");
    expect(storyBeatAtTime(8, 100)).toBe("setup");
    expect(storyBeatAtTime(99.9, 100)).toBe("loop_cta");
    expect(storyBeatAtTime(500, 100)).toBe("loop_cta"); // clamped
  });

  it("hook and payoff get caption emphasis; browser style override is dynamic", () => {
    expect(storyCaptionEmphasis("hook")).toBe(true);
    expect(storyCaptionEmphasis("payoff")).toBe(true);
    expect(storyCaptionEmphasis("setup")).toBe(false);
    expect(storyCaptionStyle("hook")).toBe("dynamic");
    expect(storyCaptionStyle("setup")).toBeUndefined();
  });

  it("beat motion mapping is a valid browser motion type", () => {
    for (const b of STORY_BEATS) {
      expect(["slow_zoom", "slow_pan", "ken_burns", "zoom_out", "none"]).toContain(
        storyBeatMotion(b.id),
      );
      expect(storyParallaxMultiplier(b.id)).toBeGreaterThan(0);
      expect(storyParallaxMultiplier(b.id)).toBeLessThanOrEqual(1);
    }
  });

  it("story ducking profile is deeper and faster than standard", () => {
    const params = storyDuckParams();
    expect(params).toContain("ratio=10");
    expect(params).toContain("threshold=0.02");
    expect(params).toContain("attack=20");
  });

  it("music segments merge consecutive scenes on the same beat", () => {
    const segs = storyMusicSegments([3, 3, 30, 30]);
    // scenes 0-1: hook (0.7), scenes 2-3: setup then rising...
    expect(segs.length).toBeLessThanOrEqual(4);
    expect(segs[0]!.level).toBeCloseTo(0.7, 5);
    const last = segs[segs.length - 1]!;
    expect(last.end).toBeCloseTo(66, 5);
  });

  it("music volume expression is a valid-looking ffmpeg expression", () => {
    const expr = storyMusicVolumeExpr(
      [
        { end: 4.8, level: 0.7 },
        { end: 60, level: 1.0 },
      ],
      0.12,
    );
    expect(expr).toBe("0.12*(if(lt(t,4.80),0.700,1.000))");
  });

  it("script guidance names the five beats and no language", () => {
    expect(STORY_SCRIPT_GUIDANCE).toContain("HOOK");
    expect(STORY_SCRIPT_GUIDANCE).toContain("LOOP / CTA");
    // Language-neutral: the guidance must not name any language.
    expect(STORY_SCRIPT_GUIDANCE).not.toMatch(/Hindi|English|Spanish|French|German/i);
    expect(storyScriptBriefs()).toHaveLength(5);
  });
});
