/**
 * Phase 4 · Stream B — F30 dashboard delta math (pure functions).
 *
 * D137: dashboard deltas compare the latest snapshot against the snapshot
 * closest to (latest − 28 days) — labeled "vs prior 28d". When no such prior
 * snapshot exists we say "insufficient history" and show NO delta, rather
 * than inventing a baseline.
 */

import { METRIC_KEYS, metricValue, type DashboardSnapshot, type MetricKey } from "./types";

export const DELTA_WINDOW_DAYS = 28;

export interface MetricDelta {
  key: MetricKey;
  current: number;
  /** Null when there is no honest baseline. */
  prior: number | null;
  /** Absolute change; null without a baseline. */
  absolute: number | null;
  /** Percent change; null without a baseline or when prior is 0. */
  pct: number | null;
  /** "vs prior 28d" or "insufficient history". */
  baselineLabel: string;
  hasBaseline: boolean;
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86_400_000);
}

/**
 * Pick the current snapshot (latest) and the prior-period snapshot: the
 * latest snapshot dated at least DELTA_WINDOW_DAYS before the current one.
 * Snapshots must be pre-sorted newest-first; we sort defensively anyway.
 */
export function pickDeltaPair(
  snapshots: DashboardSnapshot[],
  windowDays = DELTA_WINDOW_DAYS,
): { current: DashboardSnapshot | null; prior: DashboardSnapshot | null } {
  const sorted = [...snapshots].sort((a, b) => (a.snapshot_date < b.snapshot_date ? 1 : -1));
  const current = sorted[0] ?? null;
  if (!current) return { current: null, prior: null };
  const prior =
    sorted.find((s) => daysBetween(current.snapshot_date, s.snapshot_date) >= windowDays) ?? null;
  return { current, prior };
}

/** Deltas for every canonical metric key. No baseline → no delta numbers. */
export function computeDeltas(
  current: DashboardSnapshot,
  prior: DashboardSnapshot | null,
  windowDays = DELTA_WINDOW_DAYS,
): MetricDelta[] {
  return METRIC_KEYS.map((key) => {
    const cur = metricValue(current.metrics, key);
    if (!prior) {
      return {
        key,
        current: cur,
        prior: null,
        absolute: null,
        pct: null,
        baselineLabel: "insufficient history",
        hasBaseline: false,
      };
    }
    const prv = metricValue(prior.metrics, key);
    const absolute = cur - prv;
    const pct = prv !== 0 ? (absolute / prv) * 100 : null;
    return {
      key,
      current: cur,
      prior: prv,
      absolute,
      pct,
      baselineLabel: `vs prior ${windowDays}d`,
      hasBaseline: true,
    };
  });
}

/** Sum metric values across snapshots (e.g. rolling totals for a period). */
export function sumMetrics(snapshots: DashboardSnapshot[]): Record<MetricKey, number> {
  const out = Object.fromEntries(METRIC_KEYS.map((k) => [k, 0])) as Record<MetricKey, number>;
  for (const s of snapshots) {
    for (const k of METRIC_KEYS) out[k] += metricValue(s.metrics, k);
  }
  return out;
}

/** Format a delta for display: "+12.3%" / "−45" / "—" when no baseline. */
export function formatDelta(d: MetricDelta, decimals = 1): string {
  if (!d.hasBaseline || d.pct == null) return "—";
  const sign = d.pct > 0 ? "+" : d.pct < 0 ? "−" : "";
  return `${sign}${Math.abs(d.pct).toFixed(decimals)}%`;
}

/** Compact number formatting: 1.2M / 45.6K / 123. */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}
