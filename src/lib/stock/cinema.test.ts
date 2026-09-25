import { describe, expect, it } from "vitest";
import {
  CINEMA_MODE_BLURB,
  CINEMA_PARALLAX_INTENSITY,
  CINEMA_TRANSITION,
  cinemaSceneMotion,
  cinemaTreatmentForScene,
} from "./cinema";
import { renderCreditCost } from "../billing/per-minute";

describe("cinema treatment", () => {
  it("cycles slow, deliberate motion per scene (deterministic)", () => {
    expect(cinemaSceneMotion(0)).toBe("slow_zoom");
    expect(cinemaSceneMotion(1)).toBe("slow_pan");
    expect(cinemaSceneMotion(2)).toBe("zoom_out");
    expect(cinemaSceneMotion(3)).toBe("slow_zoom"); // wraps
    expect(cinemaSceneMotion(99)).toBe(cinemaSceneMotion(99 % 3));
  });

  it("uses dip-to-black pacing and a stronger parallax treatment", () => {
    const t = cinemaTreatmentForScene(0);
    expect(t.transition).toBe("dip_to_black");
    expect(CINEMA_TRANSITION).toBe("dip_to_black");
    expect(t.parallaxIntensity).toBe(CINEMA_PARALLAX_INTENSITY);
    // Richer than the standard browser default (0.5).
    expect(CINEMA_PARALLAX_INTENSITY).toBeGreaterThan(0.5);
    expect(t.motion).toBe("slow_zoom");
  });

  it("stays consistent with the single pricing source of truth", () => {
    // per-minute.ts renderCreditCost owns the ×1.5; the treatment spec
    // must never drift from it.
    const c = renderCreditCost({ durationSeconds: 240, mode: "cinema", stockFootage: true });
    expect(c.modeMultiplier).toBe(1.5);
    expect(c.totalCredits).toBe(6); // 4 finished minutes × 1.5
    const story = renderCreditCost({ durationSeconds: 240, mode: "story" });
    expect(story.totalCredits).toBe(4);
  });

  it("labels unfinished automation as Shipping next, with a date", () => {
    expect(CINEMA_MODE_BLURB).toMatch(/Shipping next \(.+\)/);
    expect(CINEMA_MODE_BLURB).toMatch(/×1\.5/);
    expect(CINEMA_MODE_BLURB).toMatch(/10%/);
  });
});
