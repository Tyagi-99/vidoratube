/**
 * F21 render checkpoints — server-side per-scene completion state.
 *
 * The worker persists completed segment indices into `renders.checkpoint`
 * (`{ segments: { "<index>": true } }`) after every scene segment, and reads
 * that checkpoint back before starting so a reclaimed/retried job resumes
 * from the first incomplete scene instead of re-rendering finished ones.
 *
 * These helpers are pure; the Supabase read/write lives in supabase.ts
 * (readRenderCheckpoint / markSegmentDone) and the resume loop in
 * pipeline.ts. Pure logic is unit-tested in segment-checkpoints.test.ts.
 */

/** Segments key inside renders.checkpoint. */
export const SEGMENTS_KEY = "segments";

/** Parse renders.checkpoint into a {index: true} map; garbage degrades to {}. */
export function parseSegmentCheckpoint(checkpoint: unknown): Record<string, boolean> {
  if (typeof checkpoint !== "object" || checkpoint === null) return {};
  const raw = (checkpoint as Record<string, unknown>)[SEGMENTS_KEY];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const done: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === true) done[k] = true;
  }
  return done;
}

/** True when the checkpoint records segment `index` as done. */
export function isSegmentDone(checkpoint: unknown, index: number): boolean {
  return parseSegmentCheckpoint(checkpoint)[String(index)] === true;
}

/**
 * Return a new checkpoint value with segment `index` marked done, preserving
 * every other key (storagePath, billing, …). Never mutates the input.
 */
export function withSegmentDone(checkpoint: unknown, index: number): Record<string, unknown> {
  const base =
    typeof checkpoint === "object" && checkpoint !== null && !Array.isArray(checkpoint)
      ? { ...(checkpoint as Record<string, unknown>) }
      : {};
  const segments = parseSegmentCheckpoint(base);
  segments[String(index)] = true;
  return { ...base, [SEGMENTS_KEY]: segments };
}

/**
 * First segment index (0..total-1) not recorded done, or null when all are
 * done. This is the resume point after a failure.
 */
export function firstIncompleteSegment(
  total: number,
  done: Record<string, boolean>,
): number | null {
  for (let i = 0; i < total; i++) {
    if (done[String(i)] !== true) return i;
  }
  return null;
}
