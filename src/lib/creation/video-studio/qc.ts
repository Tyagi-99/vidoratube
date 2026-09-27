/**
 * F20 Video Studio — QC gate producing the pinned `QCResult` contract.
 *
 * Runs before assemble: blocks on missing visuals and empty narration;
 * warns (non-blocking) on long scenes and missing audio. Pure function —
 * the UI shows it as a pre-assemble checklist, and `prepareStudioAssemble`
 * consumers can gate the enqueue button on `passed`.
 */
import type { QCResult } from "../contracts";
import type { AssembleSceneInput } from "./types";

const LONG_SCENE_SEC = 30;

export function qcStudioTimeline(scenes: AssembleSceneInput[]): QCResult {
  const checks: QCResult["checks"] = [];
  const blocking: string[] = [];

  if (scenes.length === 0) {
    checks.push({
      name: "scenes_present",
      passed: false,
      detail: "This project has no scenes yet.",
    });
    blocking.push("scenes_present");
    return { passed: false, checks, blocking };
  }

  checks.push({
    name: "scenes_present",
    passed: true,
    detail: `${scenes.length} scene(s) in the timeline.`,
  });

  const missingVisuals = scenes.filter((s) => !s.image);
  checks.push({
    name: "visuals_ready",
    passed: missingVisuals.length === 0,
    detail:
      missingVisuals.length === 0
        ? "Every scene has a visual."
        : `${missingVisuals.length} scene(s) missing visuals: #${missingVisuals
            .map((s) => s.number)
            .join(", #")}.`,
  });
  if (missingVisuals.length > 0) blocking.push("visuals_ready");

  const emptyNarration = scenes.filter((s) => !s.narration.trim());
  checks.push({
    name: "narration_present",
    passed: emptyNarration.length === 0,
    detail:
      emptyNarration.length === 0
        ? "Every scene has narration."
        : `${emptyNarration.length} scene(s) with empty narration: #${emptyNarration
            .map((s) => s.number)
            .join(", #")}.`,
  });
  if (emptyNarration.length > 0) blocking.push("narration_present");

  const longScenes = scenes.filter((s) => s.duration > LONG_SCENE_SEC);
  checks.push({
    name: "scene_pacing",
    passed: longScenes.length === 0,
    detail:
      longScenes.length === 0
        ? "No scene exceeds the 30s pacing guideline."
        : `Scene(s) #${longScenes
            .map((s) => s.number)
            .join(", #")} exceed 30s — consider splitting for pacing.`,
  });

  const missingAudio = scenes.filter((s) => !s.audio);
  checks.push({
    name: "audio_ready",
    passed: missingAudio.length === 0,
    detail:
      missingAudio.length === 0
        ? "Every scene has narration audio."
        : `${missingAudio.length} scene(s) without narration audio — server TTS will synthesize at render time.`,
  });

  return { passed: blocking.length === 0, checks, blocking };
}
