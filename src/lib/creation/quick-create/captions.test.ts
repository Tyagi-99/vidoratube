import { describe, expect, it } from "vitest";
import { buildSceneCaptions, buildTimelineCaptions } from "./captions";

describe("buildSceneCaptions", () => {
  it("groups words into readable phrase cues with ESTIMATE timing", () => {
    const narration = "Ever noticed the tiny hole at the bottom of your airplane window";
    const sc = buildSceneCaptions(1, narration);
    expect(sc.cues.length).toBeGreaterThan(0);
    expect(sc.cues.length).toBeLessThanOrEqual(4);
    // every word appears exactly once, in order
    const joined = sc.cues.map((c) => c.text).join(" ");
    expect(joined).toBe(narration);
    for (const cue of sc.cues) {
      expect(cue.timing).toBe("estimate");
      expect(cue.end).toBeGreaterThan(cue.start);
    }
    // 12 words at 150 WPM → 4.8s
    expect(sc.durationSecEstimate).toBeCloseTo(4.8, 1);
  });
});

describe("buildTimelineCaptions", () => {
  it("chains scenes with accumulating offsets and no overlaps", () => {
    const timeline = buildTimelineCaptions([
      { sceneNumber: 1, narration: "First scene narration here." },
      { sceneNumber: 2, narration: "Second scene narration here too." },
    ]);
    expect(timeline.scenes).toHaveLength(2);
    const [a, b] = timeline.scenes;
    expect(b!.cues[0]!.start).toBeGreaterThanOrEqual(a!.cues[a!.cues.length - 1]!.end);
    expect(timeline.totalSecEstimate).toBeCloseTo(
      a!.durationSecEstimate + b!.durationSecEstimate,
      5,
    );
  });
});
