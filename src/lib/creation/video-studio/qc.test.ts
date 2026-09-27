import { describe, expect, it } from "vitest";
import { qcStudioTimeline } from "./qc";
import type { AssembleSceneInput } from "./types";

function timeline(overrides: Partial<AssembleSceneInput>[]): AssembleSceneInput[] {
  return overrides.map((o, i) => ({
    id: `scene-${i}`,
    number: i + 1,
    narration: "Some narration here.",
    image: "https://example.com/img.png",
    audio: "https://example.com/audio.mp3",
    duration: 5,
    cues: [],
    ...o,
  }));
}

describe("qcStudioTimeline", () => {
  it("passes a complete timeline", () => {
    const result = qcStudioTimeline(timeline([{}, {}]));
    expect(result.passed).toBe(true);
    expect(result.blocking).toEqual([]);
    expect(result.checks.map((c) => c.name)).toEqual([
      "scenes_present",
      "visuals_ready",
      "narration_present",
      "scene_pacing",
      "audio_ready",
    ]);
  });

  it("blocks on missing visuals and empty narration", () => {
    const result = qcStudioTimeline(timeline([{ image: null }, { narration: "  " }]));
    expect(result.passed).toBe(false);
    expect(result.blocking).toContain("visuals_ready");
    expect(result.blocking).toContain("narration_present");
    expect(result.checks.find((c) => c.name === "visuals_ready")!.detail).toContain("#1");
  });

  it("blocks on an empty timeline", () => {
    const result = qcStudioTimeline([]);
    expect(result.passed).toBe(false);
    expect(result.blocking).toContain("scenes_present");
  });

  it("warns (non-blocking) on long scenes and missing audio", () => {
    const result = qcStudioTimeline(timeline([{ duration: 45, audio: null }]));
    expect(result.passed).toBe(true);
    expect(result.blocking).toEqual([]);
    expect(result.checks.find((c) => c.name === "scene_pacing")!.passed).toBe(false);
    expect(result.checks.find((c) => c.name === "audio_ready")!.passed).toBe(false);
  });
});
