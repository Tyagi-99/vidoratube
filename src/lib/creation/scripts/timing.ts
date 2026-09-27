/**
 * F12 — narration timing ESTIMATES.
 *
 * Deterministic: words ÷ words-per-minute. Every number this module produces
 * is an ESTIMATE of spoken duration — real timing comes from measured TTS
 * audio (which this module never claims to know). D94.
 */
import type { ScriptSection } from "./types";

/** Default narration pace. Exposed so the UI can label the estimate. */
export const DEFAULT_WPM = 150;

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * ESTIMATE seconds for one section body at `wpm`.
 * Empty bodies → 0 (not a fake minimum); result rounded to 0.1s.
 */
export function estimateSectionSeconds(body: string, wpm: number = DEFAULT_WPM): number {
  if (wpm <= 0) throw new Error("wpm must be positive");
  const words = countWords(body);
  if (words === 0) return 0;
  return Math.round((words / wpm) * 60 * 10) / 10;
}

export type SectionTiming = {
  id: string;
  heading: string;
  words: number;
  /** ESTIMATE seconds (words ÷ wpm). */
  estSeconds: number;
};

export type ScriptTimingEstimate = {
  sections: SectionTiming[];
  totalWords: number;
  /** ESTIMATE total seconds (sum of section ESTIMATES). */
  totalSeconds: number;
  wpm: number;
};

export function estimateScriptTiming(
  sections: Pick<ScriptSection, "id" | "heading" | "body">[],
  wpm: number = DEFAULT_WPM,
): ScriptTimingEstimate {
  const timed = sections.map((s) => ({
    id: s.id,
    heading: s.heading,
    words: countWords(s.body),
    estSeconds: estimateSectionSeconds(s.body, wpm),
  }));
  return {
    sections: timed,
    totalWords: timed.reduce((a, s) => a + s.words, 0),
    totalSeconds: Math.round(timed.reduce((a, s) => a + s.estSeconds, 0) * 10) / 10,
    wpm,
  };
}

/** m:ss clock label for a (possibly fractional) second count. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
