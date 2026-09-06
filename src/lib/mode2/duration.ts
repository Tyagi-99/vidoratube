/** Mode 2 target duration presets (seconds). */
export const DURATION_PRESETS = [15, 30, 45, 60, 120, 180] as const;

export type DurationPreset = (typeof DURATION_PRESETS)[number] | "custom";

export const COMMENTARY_STYLES = [
  "documentary",
  "energetic",
  "calm",
  "humorous",
  "educational",
  "storytelling",
] as const;

export type CommentaryStyle = (typeof COMMENTARY_STYLES)[number];

/** ~150 wpm spoken English → words for a target duration. */
export function targetWordCount(durationSeconds: number): number {
  const words = Math.round((durationSeconds / 60) * 150);
  return Math.max(20, Math.min(900, words));
}

/**
 * Clamp a custom duration into a safe Mode 2 range.
 * Presets are returned as-is; custom must be 5–600s.
 */
export function resolveTargetDuration(
  preset: DurationPreset,
  customSeconds?: number | null,
): { ok: true; seconds: number } | { ok: false; reason: string } {
  if (preset === "custom") {
    const n = Number(customSeconds);
    if (!Number.isFinite(n) || n < 5 || n > 600) {
      return { ok: false, reason: "Custom duration must be between 5 and 600 seconds." };
    }
    return { ok: true, seconds: Math.round(n) };
  }
  if (!(DURATION_PRESETS as readonly number[]).includes(preset)) {
    return { ok: false, reason: `Unknown duration preset: ${preset}` };
  }
  return { ok: true, seconds: preset };
}

/** Soft check that script length roughly matches the target (within ~40%). */
export function scriptMatchesDuration(
  script: string,
  targetSeconds: number,
): { ok: boolean; wordCount: number; targetWords: number; ratio: number } {
  const wordCount = script.trim().split(/\s+/).filter(Boolean).length;
  const targetWords = targetWordCount(targetSeconds);
  const ratio = targetWords === 0 ? 0 : wordCount / targetWords;
  return {
    ok: ratio >= 0.6 && ratio <= 1.4,
    wordCount,
    targetWords,
    ratio: Math.round(ratio * 100) / 100,
  };
}
