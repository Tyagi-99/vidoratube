/**
 * Sprint 7-8: audience-retention curve modeled against the video's
 * chapters — pure functions.
 *
 * Retention points come from the YouTube Analytics API
 * (`audienceWatchRatio` bucketed by `elapsedVideoTimeRatio`) and are stored
 * in `retention_curves.points` as [{ t: elapsed seconds, r: 0-100 }].
 * Segments come from the render's chapters
 * ([{ index, title, start_sec, end_sec }]) — built only from chapters with
 * real paragraph durations, never from estimates.
 *
 * With fewer than 3 points, or with no segments to align against, the
 * model reports hasData: false and the UI shows the honest empty state.
 */

export interface RetentionSegment {
  index: number;
  title: string;
  /** Elapsed seconds where the segment starts (inclusive). */
  startSec: number;
  /** Elapsed seconds where the segment ends (exclusive). */
  endSec: number;
}

export interface RetentionPoint {
  /** Elapsed seconds. */
  t: number;
  /** Audience watch ratio, 0-100. */
  r: number;
}

export interface SegmentRetention {
  segment: RetentionSegment;
  /** Mean retention across the points inside the segment, null if none. */
  avgRetention: number | null;
  pointCount: number;
  /** avgRetention minus the previous segment's avg (null for the first). */
  dropVsPrevious: number | null;
}

export interface RetentionModel {
  hasData: boolean;
  segments: SegmentRetention[];
  /** Overall mean retention across all points. */
  overallAvg: number | null;
  strongest: SegmentRetention | null;
  weakest: SegmentRetention | null;
}

export const MIN_RETENTION_POINTS = 3;

/**
 * Build a chapter's segments from cumulative paragraph durations.
 * Chapters without a positive total duration are skipped — they carry no
 * real timing information, so we refuse to invent boundaries for them.
 */
export function chaptersToSegments(
  chapters: { title: string; durationSeconds: number }[],
): RetentionSegment[] {
  const out: RetentionSegment[] = [];
  let cursor = 0;
  chapters.forEach((c, i) => {
    const dur = Number(c.durationSeconds);
    if (!Number.isFinite(dur) || dur <= 0) return;
    out.push({ index: i, title: c.title, startSec: cursor, endSec: cursor + dur });
    cursor += dur;
  });
  return out;
}

/** Clamp a raw retention value into 0-100. */
function clampR(r: number): number {
  if (!Number.isFinite(r)) return 0;
  return Math.min(100, Math.max(0, r));
}

/**
 * Align retention points to segments. A point belongs to the segment whose
 * [startSec, endSec) range contains its t. Points outside every segment are
 * counted in the overall average but not attributed to a chapter.
 */
export function buildRetentionModel(
  segments: RetentionSegment[],
  points: RetentionPoint[],
): RetentionModel {
  const valid = points.filter(
    (p) => Number.isFinite(p.t) && p.t >= 0 && Number.isFinite(p.r),
  );
  if (valid.length < MIN_RETENTION_POINTS) {
    return {
      hasData: false,
      segments: [],
      overallAvg: null,
      strongest: null,
      weakest: null,
    };
  }

  const bySegment = new Map<number, RetentionPoint[]>();
  for (const p of valid) {
    const seg = segments.find((s) => p.t >= s.startSec && p.t < s.endSec);
    if (!seg) continue;
    const list = bySegment.get(seg.index) ?? [];
    list.push(p);
    bySegment.set(seg.index, list);
  }

  const modeled: SegmentRetention[] = segments.map((segment) => {
    const pts = bySegment.get(segment.index) ?? [];
    const avgRetention =
      pts.length > 0
        ? pts.reduce((a, p) => a + clampR(p.r), 0) / pts.length
        : null;
    return { segment, avgRetention, pointCount: pts.length, dropVsPrevious: null };
  });

  // Drop vs previous (only where both segments have points).
  for (let i = 1; i < modeled.length; i++) {
    const prev = modeled[i - 1]!;
    const cur = modeled[i]!;
    if (prev.avgRetention != null && cur.avgRetention != null) {
      cur.dropVsPrevious = cur.avgRetention - prev.avgRetention;
    }
  }

  const withData = modeled.filter((m) => m.avgRetention != null);
  const strongest =
    withData.length > 0
      ? withData.reduce((a, b) => (b.avgRetention! > a.avgRetention! ? b : a))
      : null;
  const weakest =
    withData.length > 0
      ? withData.reduce((a, b) => (b.avgRetention! < a.avgRetention! ? b : a))
      : null;

  const overallAvg =
    valid.reduce((a, p) => a + clampR(p.r), 0) / valid.length;

  return {
    hasData: true,
    segments: modeled,
    overallAvg,
    strongest,
    weakest,
  };
}
