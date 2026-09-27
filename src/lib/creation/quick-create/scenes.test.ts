import { describe, expect, it } from "vitest";
import { buildQuickScript } from "./script";
import { planQuickScenes, scenePlansToManifest } from "./scenes";
import { SceneManifestSchema } from "../contracts";

const script = buildQuickScript({
  topic: "Why do airplane windows have a tiny hole?",
  hook: "Ever noticed the tiny hole at the bottom of your airplane window?",
  facts: [
    {
      text: "That hole is called a breather or bleed hole, and it sits in the middle pane of the window.",
      sourceIds: [],
    },
    {
      text: "It lets cabin air flow between the panes so the outer pane takes the full pressure load.",
      sourceIds: [],
    },
    {
      text: "The middle pane stays unloaded as a failsafe in case the outer pane is ever damaged.",
      sourceIds: [],
    },
  ],
  payoff: "Follow for one surprising explanation every day.",
});

describe("planQuickScenes", () => {
  it("splits into 5–7 scenes (hook / beats / payoff)", () => {
    const plans = planQuickScenes(script, "Why do airplane windows have a tiny hole?");
    expect(plans.length).toBeGreaterThanOrEqual(5);
    expect(plans.length).toBeLessThanOrEqual(7);
    expect(plans[0]!.narration).toBe(script.hook);
    expect(plans[plans.length - 1]!.narration).toBe(script.payoff);
    for (const p of plans) {
      expect(p.visualPrompt.length).toBeGreaterThan(0);
      expect(p.durationSecEstimate).toBeGreaterThan(0);
    }
    // scene numbers are 1-based and sequential
    expect(plans.map((p) => p.sceneNumber)).toEqual(plans.map((_, i) => i + 1));
  });
});

describe("scenePlansToManifest", () => {
  it("produces a valid pinned SceneManifest via Stream E's builder", () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const plans = planQuickScenes(script, "Why do airplane windows have a tiny hole?");
    const manifest = scenePlansToManifest(projectId, plans);
    const parsed = SceneManifestSchema.safeParse(manifest);
    expect(parsed.success).toBe(true);
    expect(manifest.projectId).toBe(projectId);
    expect(manifest.scenes).toHaveLength(plans.length);
    for (const s of manifest.scenes) {
      expect(s.narration.length).toBeGreaterThan(0);
      expect(s.visualPrompt).not.toBeNull();
      expect(s.status).toBe("draft");
    }
  });

  it("supports scene-level regeneration: one scene re-narrated, manifest stays valid", () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const plans = planQuickScenes(script, "Why do airplane windows have a tiny hole?");
    // Regenerate scene 2's narration (the Stream E regen path would persist this).
    const regen = plans.map((p) =>
      p.sceneNumber === 2
        ? {
            ...p,
            narration:
              "That tiny opening is called a breather hole, drilled through the middle acrylic pane.",
          }
        : p,
    );
    const manifest = scenePlansToManifest(projectId, regen);
    expect(SceneManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest.scenes).toHaveLength(plans.length);
    expect(manifest.scenes[1]!.narration).not.toBe(plans[1]!.narration);
    expect(manifest.scenes[0]!.narration).toBe(plans[0]!.narration);
  });
});
