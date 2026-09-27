import { describe, expect, it } from "vitest";
import { planShortRecut, tightenNarration } from "./shorts";
import type { ShortSourceScene } from "./shorts";

function scene(overrides: Partial<ShortSourceScene> & { sceneId: string }): ShortSourceScene {
  return {
    sceneNumber: 1,
    narration: "A calm establishing shot of the valley at dawn.",
    assetUrl: "https://example.com/a.png",
    durationSecEstimate: 5,
    selected: true,
    ...overrides,
  };
}

describe("tightenNarration", () => {
  it("keeps the first sentence and caps at 28 words", () => {
    const long = Array(40).fill("word").join(" ") + ". Second sentence here.";
    const tight = tightenNarration(long);
    expect(tight.split(/\s+/).length).toBeLessThanOrEqual(28);
    expect(tight).toContain("…");
  });

  it("leaves short narrations untouched", () => {
    expect(tightenNarration("A quiet lake.")).toBe("A quiet lake.");
  });
});

describe("planShortRecut", () => {
  it("is deterministic: same input → same output", () => {
    const input = {
      projectId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      projectTitle: "Valley at Dawn",
      scenes: [
        scene({ sceneId: "a", sceneNumber: 1 }),
        scene({ sceneId: "b", sceneNumber: 2, narration: "Did you know valleys sing?" }),
      ],
    };
    expect(planShortRecut(input)).toEqual(planShortRecut(input));
  });

  it("moves the hook scene first and labels the analysis as rule-based", () => {
    const plan = planShortRecut({
      projectId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      projectTitle: "Valley at Dawn",
      scenes: [
        scene({ sceneId: "a", sceneNumber: 1 }),
        scene({ sceneId: "b", sceneNumber: 2, narration: "Did you know valleys sing at dawn?" }),
      ],
    });
    expect(plan.orderedSceneIds[0]).toBe("b");
    expect(plan.hookSceneId).toBe("b");
    expect(plan.hookAnalysisNote).toContain("Rule-based");
    expect(plan.hookAnalysisNote).toContain("not AI");
    expect(plan.aspect).toBe("9:16");
  });

  it("keeps selected order when no hook is detected", () => {
    const plan = planShortRecut({
      projectId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      projectTitle: "Valley at Dawn",
      scenes: [scene({ sceneId: "a", sceneNumber: 1 }), scene({ sceneId: "b", sceneNumber: 2 })],
    });
    expect(plan.orderedSceneIds).toEqual(["a", "b"]);
    expect(plan.hookSceneId).toBeNull();
  });

  it("truncates to fit the duration cap but keeps the hook scene", () => {
    const scenes = Array.from({ length: 10 }, (_, i) =>
      scene({
        sceneId: `s${i}`,
        sceneNumber: i + 1,
        narration:
          i === 5 ? "What if rivers could remember?" : Array(60).fill("word").join(" ") + ".",
      }),
    );
    const plan = planShortRecut({
      projectId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      projectTitle: "Valley at Dawn",
      scenes,
      maxDurationSec: 30,
    });
    expect(plan.estimatedDurationSec).toBeLessThanOrEqual(30);
    expect(plan.orderedSceneIds[0]).toBe("s5");
  });

  it("rejects an empty selection", () => {
    expect(() =>
      planShortRecut({
        projectId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        projectTitle: "x",
        scenes: [scene({ sceneId: "a", selected: false })],
      }),
    ).toThrow(/at least one scene/i);
  });

  it("counts missing visuals", () => {
    const plan = planShortRecut({
      projectId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      projectTitle: "Valley at Dawn",
      scenes: [scene({ sceneId: "a", assetUrl: null })],
    });
    expect(plan.missingVisuals).toBe(1);
  });
});
