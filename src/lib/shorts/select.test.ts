import { describe, expect, it } from "vitest";
import {
  selectShorts,
  scoreSegment,
  buildShortRenderPayload,
  quoteShorts,
  MIN_SHORTS,
  MAX_SHORTS,
  type ShortScene,
} from "./select";

/** A 6-minute long video: 12 scenes x 30s each, hook → setup → tension → payoff. */
function longVideoScenes(): ShortScene[] {
  const beats = [
    "hook",
    "setup",
    "rising_tension",
    "rising_tension",
    "rising_tension",
    "rising_tension",
    "rising_tension",
    "rising_tension",
    "payoff",
    "payoff",
    "loop_cta",
    "loop_cta",
  ] as const;
  return beats.map((beatId, i) => ({
    id: `scene-${i + 1}`,
    start: i * 30,
    duration: 30,
    // Dense narration: 240 chars in 30s = 8 chars/sec.
    captionChars: 240,
    beatId,
  }));
}

describe("scoreSegment", () => {
  it("rejects windows outside the 15–60s Short bounds", () => {
    expect(scoreSegment({ duration: 10 }).total).toBe(-Infinity);
    expect(scoreSegment({ duration: 75 }).total).toBe(-Infinity);
  });

  it("prefers hook and payoff beats", () => {
    const hook = scoreSegment({ duration: 30, beatId: "hook", captionChars: 240 });
    const setup = scoreSegment({ duration: 30, beatId: "setup", captionChars: 240 });
    const payoff = scoreSegment({ duration: 30, beatId: "payoff", captionChars: 240 });
    expect(hook.total).toBeGreaterThan(payoff.total);
    expect(payoff.total).toBeGreaterThan(setup.total);
  });

  it("rewards dense narration and the 20–45s sweet spot", () => {
    const dense = scoreSegment({ duration: 30, captionChars: 240 });
    const sparse = scoreSegment({ duration: 30, captionChars: 30 });
    expect(dense.total).toBeGreaterThan(sparse.total);
    const sweet = scoreSegment({ duration: 30 });
    const edge = scoreSegment({ duration: 16 });
    expect(sweet.total).toBeGreaterThan(edge.total);
  });
});

describe("selectShorts", () => {
  it("returns 5–8 non-overlapping segments from a 6-minute video", () => {
    const result = selectShorts(longVideoScenes());
    expect(result.windows.length).toBeGreaterThanOrEqual(MIN_SHORTS);
    expect(result.windows.length).toBeLessThanOrEqual(MAX_SHORTS);
    expect(result.note).toBeNull();
    // No overlaps.
    for (let i = 1; i < result.windows.length; i++) {
      expect(result.windows[i]!.start).toBeGreaterThanOrEqual(result.windows[i - 1]!.end);
    }
  });

  it("is honest when the source is too short for a full set", () => {
    const short = longVideoScenes().slice(0, 2); // 60s total
    const result = selectShorts(short);
    expect(result.windows.length).toBeLessThan(MIN_SHORTS);
    expect(result.note).toMatch(/only \d+ valid/);
  });

  it("picks hook/payoff content over plain setup", () => {
    const result = selectShorts(longVideoScenes());
    const reasons = result.windows.map((w) => w.reason).join(" | ");
    expect(reasons).toMatch(/hook|payoff/);
  });

  it("respects a custom maxCount", () => {
    const result = selectShorts(longVideoScenes(), { maxCount: 5 });
    expect(result.windows.length).toBeLessThanOrEqual(5);
  });
});

describe("buildShortRenderPayload", () => {
  const SOURCE = {
    id: "33333333-3333-4333-8333-333333333333",
    projectId: "44444444-4444-4444-8444-444444444444",
    durationSeconds: 360,
    aspectRatio: "16:9",
  };

  it("records the parent linkage on the new renders row", () => {
    const { windows } = selectShorts(longVideoScenes());
    const payload = buildShortRenderPayload(SOURCE, windows[0]!, 1);
    expect(payload.parent_id).toBe(SOURCE.id);
    expect(payload.meta.kind).toBe("short");
    expect(payload.meta.short_of).toBe(SOURCE.id);
    expect(payload.meta.short_index).toBe(1);
  });

  it("cuts 9:16 with burned-in captions", () => {
    const { windows } = selectShorts(longVideoScenes());
    const payload = buildShortRenderPayload(SOURCE, windows[0]!, 1);
    expect(payload.aspect_ratio).toBe("9:16");
    expect(payload.resolution).toBe("1080x1920");
    expect(payload.meta.crop).toBe("9:16");
    expect(payload.meta.burn_captions).toBe(true);
  });
});

describe("quoteShorts", () => {
  it("charges 0.5 credits per short: 6 shorts = 3 credits", () => {
    const q = quoteShorts(6);
    expect(q.count).toBe(6);
    expect(q.credits).toBe(3);
  });

  it("quotes zero as zero", () => {
    expect(quoteShorts(0)).toEqual({ count: 0, credits: 0 });
  });
});
