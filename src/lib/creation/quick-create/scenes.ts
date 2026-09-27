/**
 * F23 — script → scenes splitter (pure, deterministic).
 *
 * Splits a quick script into 5–7 scenes (hook / beats / payoff map 1:1 to
 * scenes), then produces the pinned `SceneManifest` via Stream E's
 * `buildSceneManifest` — Stream F consumes, never reimplements.
 *
 * Visual prompts are honest placeholders ("STOCK: …" keyword briefs) —
 * they describe what a licensed-stock search should fetch; no generated
 * imagery is claimed until the visuals stage actually runs.
 */
import { randomUUID } from "node:crypto";
import { buildSceneManifest, estimateSceneDurationSec } from "../video-studio/manifest";
import type { SceneManifest } from "../contracts";
import type { QuickScript } from "./script";

export type QuickScenePlan = {
  sceneNumber: number;
  narration: string;
  visualPrompt: string;
  durationSecEstimate: number;
};

export function planQuickScenes(script: QuickScript, topic: string): QuickScenePlan[] {
  const clean = topic.trim().replace(/\?+\s*$/, "");
  const parts: Array<{ narration: string; visual: string }> = [
    {
      narration: script.hook,
      visual: `STOCK: close-up macro of airplane window, shallow depth of field (${clean})`,
    },
  ];
  script.beats.forEach((beat, i) => {
    parts.push({
      narration: beat,
      visual: `STOCK: aircraft cabin window detail, diagram-style overlay space, beat ${i + 1} (${clean})`,
    });
  });
  parts.push({
    narration: script.payoff,
    visual: `STOCK: airplane window view at cruising altitude, clouds below (${clean})`,
  });

  return parts.map((p, i) => ({
    sceneNumber: i + 1,
    narration: p.narration,
    visualPrompt: p.visual,
    durationSecEstimate: estimateSceneDurationSec(p.narration, null),
  }));
}

export function scenePlansToManifest(projectId: string, plans: QuickScenePlan[]): SceneManifest {
  return buildSceneManifest(
    projectId,
    null,
    plans.map((p) => ({
      sceneId: randomUUID(),
      sceneNumber: p.sceneNumber,
      narration: p.narration,
      visualPrompt: p.visualPrompt,
      assetUrl: null,
      assetSource: { kind: "brief", provider: null, rights: "unlicensed-brief" },
      durationSec: p.durationSecEstimate,
      status: "draft",
      checkpoint: null,
    })),
  );
}
