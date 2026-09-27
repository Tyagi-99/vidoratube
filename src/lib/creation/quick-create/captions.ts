/**
 * F23 — caption timing (pure, deterministic).
 *
 * Derives word/phrase-synced caption cues from narration text at the
 * standard 150 WPM estimate. Timing is an ESTIMATE until measured from
 * real narration audio — callers must label it as such and never present
 * it as ASR-measured. Phrase cues group 3–5 words so on-screen text stays
 * readable on a 9:16 short.
 */
import { STUDIO_WORDS_PER_MINUTE } from "../video-studio/manifest";

export type CaptionCue = {
  /** Display text for this cue (a word or short phrase). */
  text: string;
  /** Seconds from scene start — ESTIMATE until measured from real audio. */
  start: number;
  end: number;
  /** Always "estimate" here; ASR-measured cues would carry "measured". */
  timing: "estimate";
};

export type SceneCaptions = {
  sceneNumber: number;
  cues: CaptionCue[];
  durationSecEstimate: number;
};

const WORDS_PER_CUE = 4;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Build word/phrase caption cues for one scene's narration.
 * `offsetSec` shifts all cues when chaining scenes into a timeline.
 */
export function buildSceneCaptions(
  sceneNumber: number,
  narration: string,
  offsetSec = 0,
): SceneCaptions {
  const words = narration.split(/\s+/).filter(Boolean);
  const secPerWord = 60 / STUDIO_WORDS_PER_MINUTE;
  const cues: CaptionCue[] = [];
  for (let i = 0; i < words.length; i += WORDS_PER_CUE) {
    const chunk = words.slice(i, i + WORDS_PER_CUE);
    cues.push({
      text: chunk.join(" "),
      start: round2(offsetSec + i * secPerWord),
      end: round2(offsetSec + (i + chunk.length) * secPerWord),
      timing: "estimate",
    });
  }
  return {
    sceneNumber,
    cues,
    durationSecEstimate: round2(words.length * secPerWord),
  };
}

/** Chain scene captions into one timeline (offsets accumulate). */
export function buildTimelineCaptions(
  narrations: Array<{ sceneNumber: number; narration: string }>,
): { scenes: SceneCaptions[]; totalSecEstimate: number } {
  const scenes: SceneCaptions[] = [];
  let offset = 0;
  for (const n of narrations) {
    const sc = buildSceneCaptions(n.sceneNumber, n.narration, offset);
    scenes.push(sc);
    offset = round2(offset + sc.durationSecEstimate);
  }
  return { scenes, totalSecEstimate: round2(offset) };
}
