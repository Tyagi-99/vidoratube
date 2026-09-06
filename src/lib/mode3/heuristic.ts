import type {
  AutoEditCue,
  AutoEditPlan,
  AutoEditPlanInput,
  AutomaticEditingProvider,
} from "./provider";

/**
 * Keep a contiguous window of `target` seconds from the source.
 * Prefer the middle of the clip when source is longer; clamp when shorter.
 * Silence/scene detection is intentionally stubbed (hooks documented in plan.stubs).
 */
export function computeKeepWindow(
  sourceDurationSeconds: number,
  targetDurationSeconds: number,
): { trimStart: number; trimEnd: number } {
  const source = Math.max(0.1, Number(sourceDurationSeconds) || 0.1);
  const target = Math.max(1, Math.min(600, Number(targetDurationSeconds) || 60));

  if (source <= target + 0.05) {
    return { trimStart: 0, trimEnd: +source.toFixed(3) };
  }

  // Drop quiet-looking heads/tails heuristically by taking the center window.
  // (Real silence detection would replace this bias.)
  const trimStart = +((source - target) / 2).toFixed(3);
  const trimEnd = +(trimStart + target).toFixed(3);
  return { trimStart, trimEnd };
}

function seedCues(
  input: AutoEditPlanInput,
  windowSeconds: number,
): AutoEditCue[] {
  if (!input.burnCaptions) return [];
  const raw =
    (input.notes && input.notes.trim()) ||
    (input.title && input.title.trim()) ||
    "Automatic edit";
  const chunks = raw
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);
  const parts = chunks.length ? chunks : [raw.slice(0, 80)];
  const slot = windowSeconds / parts.length;
  return parts.map((text, i) => {
    const start = +(i * slot).toFixed(2);
    const end = +Math.min(windowSeconds, (i + 1) * slot).toFixed(2);
    return { start, end: Math.max(start + 0.5, end), text: text.slice(0, 120) };
  });
}

export function planHeuristicEdit(input: AutoEditPlanInput): AutoEditPlan {
  const { trimStart, trimEnd } = computeKeepWindow(
    input.sourceDurationSeconds,
    input.targetDurationSeconds,
  );
  const windowSeconds = +(trimEnd - trimStart).toFixed(3);
  const cues = seedCues(input, windowSeconds);

  return {
    providerId: "vidora-heuristic-v1",
    trimStart,
    trimEnd,
    targetDurationSeconds: windowSeconds,
    segments: [
      {
        start: trimStart,
        end: trimEnd,
        reason: "center-keep-window",
      },
    ],
    cues,
    summary:
      input.sourceDurationSeconds > input.targetDurationSeconds
        ? `Keeping a ${windowSeconds}s center window from ${input.sourceDurationSeconds.toFixed(1)}s source (silence/scene detection stubbed).`
        : `Source is ${input.sourceDurationSeconds.toFixed(1)}s — exporting full clip (target was ${input.targetDurationSeconds}s).`,
    stubs: {
      silenceDetection: true,
      sceneDetection: true,
      autoEditorBackend: true,
    },
  };
}

export const heuristicAutomaticEditingProvider: AutomaticEditingProvider = {
  id: "vidora-heuristic-v1",
  label: "Vidora heuristic auto-edit",
  plan(input) {
    return planHeuristicEdit(input);
  },
};

export function getAutomaticEditingProvider(
  id?: string | null,
): AutomaticEditingProvider {
  // Only one implementation today; reserved for future AutoEditor-backed provider.
  void id;
  return heuristicAutomaticEditingProvider;
}
