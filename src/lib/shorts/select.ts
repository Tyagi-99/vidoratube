/**
 * Long-form → Shorts: highlight segment selection — Sprint 5-6.
 *
 * From one finished long video, pick 5–8 candidate Shorts. Selection is a
 * documented RULE-BASED heuristic, not learned scoring: the idea engine
 * (src/lib/research.functions.ts) scores whole videos (outlier_score), not
 * scenes, so no per-scene hook/payoff scores exist yet. Until a learned
 * scorer ships, selection uses narrative structure + caption density:
 *
 *   1. Candidate windows are built by merging adjacent scenes into 15–60s
 *      windows (a Short under 15s has no room to breathe; over 60s is not
 *      a Short).
 *   2. Each window scores:
 *      - Story beat: hook +3, payoff +2, rising_tension +1.5, loop_cta +1,
 *        setup +0.5. Rationale: the five-beat template (src/lib/story-template.ts)
 *        marks hook/payoff as the retention-critical beats (they already get
 *        caption emphasis in the full render).
 *      - Caption density: >= 6 chars/sec of narration => +2, >= 3 => +1.
 *        Rationale: dense narration = a self-contained point, which is what
 *        carries a Short without its surrounding context.
 *      - Duration sweet spot: 20–45s => +1. Mid-length Shorts hold retention
 *        better than edge cases at either bound.
 *   3. Greedy non-overlapping top-k: highest-scoring windows win; windows
 *      overlapping an already-picked window are skipped.
 *   4. Clamp to [MIN_SHORTS, MAX_SHORTS] = [5, 8]. If the source is too
 *      short to yield 5 valid windows, we return what exists and say so
 *      honestly (note on the result) instead of inventing segments.
 *
 * Beats are optional input: when scenes carry no beat assignment, scoring
 * falls back to caption density + duration alone.
 */

import type { StoryBeatId } from "../story-template";
import { renderCreditCost } from "../billing/per-minute";

export const MIN_SHORTS = 5;
export const MAX_SHORTS = 8;
/** Bounds for one Short in seconds. */
export const SHORT_MIN_SECONDS = 15;
export const SHORT_MAX_SECONDS = 60;
/** Duration sweet spot bonus range. */
export const SHORT_SWEET_MIN = 20;
export const SHORT_SWEET_MAX = 45;

export interface ShortScene {
  id: string;
  /** Seconds from the start of the source video. */
  start: number;
  /** Scene length in seconds. */
  duration: number;
  /** Narration/caption characters in this scene (for density scoring). */
  captionChars?: number | undefined;
  /** Story beat assignment, when the source used Story Mode. */
  beatId?: StoryBeatId | undefined;
}

const BEAT_BONUS: Record<StoryBeatId, number> = {
  hook: 3,
  payoff: 2,
  rising_tension: 1.5,
  loop_cta: 1,
  setup: 0.5,
};

export interface SegmentScore {
  total: number;
  beat: number;
  captionDensity: number;
  durationSweetSpot: number;
}

/**
 * Score one candidate window. Pure and unit-tested. Windows outside the
 * 15–60s bounds are invalid (score.total = -Infinity) and never selected.
 */
export function scoreSegment(args: {
  duration: number;
  beatId?: StoryBeatId | undefined;
  captionChars?: number | undefined;
}): SegmentScore {
  const { duration } = args;
  if (!Number.isFinite(duration) || duration < SHORT_MIN_SECONDS || duration > SHORT_MAX_SECONDS) {
    return { total: -Infinity, beat: 0, captionDensity: 0, durationSweetSpot: 0 };
  }
  const beat = args.beatId ? (BEAT_BONUS[args.beatId] ?? 0) : 0;
  const chars = Math.max(0, args.captionChars ?? 0);
  const density = chars / duration;
  const captionDensity = density >= 6 ? 2 : density >= 3 ? 1 : 0;
  const durationSweetSpot = duration >= SHORT_SWEET_MIN && duration <= SHORT_SWEET_MAX ? 1 : 0;
  return {
    total: beat + captionDensity + durationSweetSpot,
    beat,
    captionDensity,
    durationSweetSpot,
  };
}

export interface ShortWindow {
  /** Seconds from the start of the source video. */
  start: number;
  /** Seconds from the start of the source video. */
  end: number;
  score: SegmentScore;
  /** Scene ids merged into this window. */
  sceneIds: string[];
  /** Human-readable reason (shown in the suggestion list). */
  reason: string;
}

/** Build candidate windows by merging adjacent scenes to 15–60s. */
function candidateWindows(scenes: ShortScene[]): ShortWindow[] {
  const sorted = [...scenes]
    .filter((s) => Number.isFinite(s.duration) && s.duration > 0)
    .sort((a, b) => a.start - b.start);
  const windows: ShortWindow[] = [];
  let acc: ShortScene[] = [];
  let accDuration = 0;
  const flush = () => {
    if (acc.length === 0) return;
    const start = acc[0]!.start;
    const end = start + accDuration;
    const chars = acc.reduce((sum, s) => sum + (s.captionChars ?? 0), 0);
    // The window's beat is the highest-priority beat it covers.
    const beats = acc.map((s) => s.beatId).filter(Boolean) as StoryBeatId[];
    const beatId = beats.sort((a, b) => (BEAT_BONUS[b] ?? 0) - (BEAT_BONUS[a] ?? 0))[0];
    const score = scoreSegment({ duration: accDuration, beatId, captionChars: chars });
    if (score.total > -Infinity) {
      windows.push({
        start,
        end,
        score,
        sceneIds: acc.map((s) => s.id),
        reason: describeWindow(accDuration, beatId, score),
      });
    }
    acc = [];
    accDuration = 0;
  };
  for (const scene of sorted) {
    acc.push(scene);
    accDuration += scene.duration;
    if (accDuration >= SHORT_SWEET_MIN) flush();
  }
  // Trailing remainder: only keep it if it clears the minimum length.
  flush();
  return windows;
}

function describeWindow(
  duration: number,
  beatId: StoryBeatId | undefined,
  score: SegmentScore,
): string {
  const parts: string[] = [`${Math.round(duration)}s`];
  if (beatId) parts.push(beatId.replace(/_/g, " "));
  if (score.captionDensity > 0) parts.push("dense narration");
  return parts.join(" · ");
}

export interface SelectShortsResult {
  windows: ShortWindow[];
  /** Set when the source could not yield a full set of 5. */
  note: string | null;
}

function overlaps(a: ShortWindow, b: ShortWindow): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Select 5–8 highlight Shorts from a finished long video's scenes.
 * Greedy: highest-scoring candidate windows, skipping overlaps, clamped to
 * [MIN_SHORTS, MAX_SHORTS].
 */
export function selectShorts(
  scenes: ShortScene[],
  opts: { minCount?: number; maxCount?: number } = {},
): SelectShortsResult {
  const minCount = Math.max(1, opts.minCount ?? MIN_SHORTS);
  const maxCount = Math.min(12, Math.max(minCount, opts.maxCount ?? MAX_SHORTS));
  const candidates = candidateWindows(scenes).sort((a, b) => b.score.total - a.score.total);
  const picked: ShortWindow[] = [];
  for (const c of candidates) {
    if (picked.length >= maxCount) break;
    if (picked.some((p) => overlaps(p, c))) continue;
    picked.push(c);
  }
  // Present in timeline order.
  picked.sort((a, b) => a.start - b.start);
  return {
    windows: picked,
    note:
      picked.length < minCount
        ? `Source yielded only ${picked.length} valid 15–60s window${picked.length === 1 ? "" : "s"}; fewer than the usual ${minCount}.`
        : null,
  };
}

export interface ShortRenderSource {
  id: string;
  projectId: string;
  durationSeconds: number;
  /** Source aspect/resolution the 9:16 crop is cut from. */
  aspectRatio: string;
}

/**
 * The renders-row insert for one Short: parent_id links it to the source
 * video, meta records the cut window and the kind. The worker renders the
 * window as a 9:16 cut with burned-in captions (see ffmpeg.ts).
 */
export function buildShortRenderPayload(
  source: ShortRenderSource,
  window: ShortWindow,
  index: number,
) {
  return {
    type: "full",
    engine: "server_ffmpeg",
    format: "mp4",
    status: "queued",
    stage: "queued",
    progress: 0,
    aspect_ratio: "9:16",
    resolution: "1080x1920",
    duration: Math.round((window.end - window.start) * 10) / 10,
    parent_id: source.id,
    meta: {
      kind: "short",
      short_of: source.id,
      project_id: source.projectId,
      short_index: index,
      source_start: window.start,
      source_end: window.end,
      reason: window.reason,
      // The 9:16 crop of the source frame; captions burned in (ass filter).
      crop: "9:16",
      burn_captions: true,
    },
  };
}

/** Quote N shorts: 0.5 credits each (flat — not per minute). */
export function quoteShorts(count: number): { count: number; credits: number } {
  const n = Math.max(0, Math.floor(count));
  const { shortsCredits } = renderCreditCost({
    durationSeconds: 1,
    mode: "story",
    shortsCount: n,
  });
  return { count: n, credits: shortsCredits };
}

export { BEAT_BONUS };
