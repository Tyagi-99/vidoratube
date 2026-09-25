/**
 * Sprint 7-8: per-video platform stats snapshots — pure math.
 *
 * Snapshots are stored in `platform_video_stats` (metrics JSONB holding
 * views/likes/comments/watch_time_minutes). The 24h and 7d views are
 * computed as deltas between the latest snapshot and the snapshot closest
 * to 24h / 7d before it. When no suitable baseline exists we return null
 * (the UI shows an honest "not enough snapshot history" state) — never a
 * fabricated delta.
 */

/** One stats snapshot, as stored in platform_video_stats.metrics. */
export interface PlatformStatsSnapshot {
  capturedAt: string; // ISO timestamp
  views: number;
  likes: number;
  comments: number;
  watchTimeMinutes: number;
}

/** A metric delta between two snapshots. Null when not computable. */
export interface StatsDelta {
  /** Absolute change since the baseline snapshot. */
  delta: number;
  /** Baseline snapshot's captured_at (for display). */
  baselineAt: string;
  /** Latest snapshot's captured_at. */
  latestAt: string;
}

export interface ViewsWindows {
  hasData: boolean;
  latest: PlatformStatsSnapshot | null;
  views24h: StatsDelta | null;
  views7d: StatsDelta | null;
}

/** How close a baseline must be to the exact 24h/7d mark to count. */
export const BASELINE_TOLERANCE_MS = 6 * 3600_000; // 6 hours
const DAY_MS = 86_400_000;

function toMs(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
}

/**
 * Pick the snapshot closest to `targetMs` within the tolerance, preferring
 * snapshots at or before the target. Returns null when nothing qualifies.
 */
function findBaseline(
  sorted: { capturedAt: string }[],
  targetMs: number,
): { capturedAt: string } | null {
  let best: { capturedAt: string } | null = null;
  let bestDist = Infinity;
  for (const s of sorted) {
    const t = toMs(s.capturedAt);
    if (!Number.isFinite(t) || t > targetMs) continue;
    const dist = targetMs - t;
    if (dist <= BASELINE_TOLERANCE_MS && dist < bestDist) {
      best = s;
      bestDist = dist;
    }
  }
  return best;
}

function deltaFor(
  sorted: PlatformStatsSnapshot[],
  latest: PlatformStatsSnapshot,
  windowMs: number,
): StatsDelta | null {
  const latestMs = toMs(latest.capturedAt);
  if (!Number.isFinite(latestMs)) return null;
  const baseline = findBaseline(sorted, latestMs - windowMs);
  if (!baseline) return null;
  return {
    delta: latest.views - (baseline as PlatformStatsSnapshot).views,
    baselineAt: baseline.capturedAt,
    latestAt: latest.capturedAt,
  };
}

/**
 * Compute 24h/7d view deltas from a video's snapshots. Snapshots may be in
 * any order; invalid timestamps are ignored. Views never go backwards —
 * a negative delta (snapshot correction) is clamped to 0, never reported
 * as negative growth.
 */
export function computeViewsWindows(snapshots: PlatformStatsSnapshot[]): ViewsWindows {
  const valid = snapshots
    .filter((s) => Number.isFinite(toMs(s.capturedAt)))
    .sort((a, b) => toMs(a.capturedAt) - toMs(b.capturedAt));
  if (valid.length === 0) {
    return { hasData: false, latest: null, views24h: null, views7d: null };
  }
  const latest = valid[valid.length - 1]!;
  const w24 = deltaFor(valid, latest, DAY_MS);
  const w7d = deltaFor(valid, latest, 7 * DAY_MS);
  const clamp = (d: StatsDelta | null): StatsDelta | null =>
    d ? { ...d, delta: Math.max(0, d.delta) } : null;
  return {
    hasData: true,
    latest,
    views24h: clamp(w24),
    views7d: clamp(w7d),
  };
}

/** Validate a raw metrics JSONB payload into a snapshot row. */
export function parseMetricsPayload(
  raw: unknown,
  capturedAt: string,
): PlatformStatsSnapshot {
  const m = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  return {
    capturedAt,
    views: num(m["views"]),
    likes: num(m["likes"]),
    comments: num(m["comments"]),
    watchTimeMinutes: num(m["watch_time_minutes"]),
  };
}
