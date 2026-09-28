/**
 * Phase 4 · Stream B (Analytics) — shared types.
 *
 * Canonical metrics vocab (PINNED, docs/PHASE4_CONTRACTS.md):
 *   views, likes, comment_count, watch_time_minutes, avg_view_duration_s,
 *   ctr, impressions, subscribers_gained
 *
 * Provenance rule (D136): every snapshot carries a `source` label.
 * `fixture` rows MUST render with a visible DEMO DATA / FIXTURE label in UI.
 */

/** Required provenance label on every analytics/retention snapshot. */
export type SnapshotSource = "youtube_analytics" | "meta_insights" | "fixture";

export const SNAPSHOT_SOURCES: SnapshotSource[] = [
  "youtube_analytics",
  "meta_insights",
  "fixture",
];

/** Canonical metrics keys for analytics_snapshots.metrics (contracts vocab). */
export type MetricKey =
  | "views"
  | "likes"
  | "comment_count"
  | "watch_time_minutes"
  | "avg_view_duration_s"
  | "ctr"
  | "impressions"
  | "subscribers_gained";

export const METRIC_KEYS: MetricKey[] = [
  "views",
  "likes",
  "comment_count",
  "watch_time_minutes",
  "avg_view_duration_s",
  "ctr",
  "impressions",
  "subscribers_gained",
];

/** revenue_basis on analytics_snapshots (contracts). Default is 'estimate'. */
export type RevenueBasis = "measured" | "estimate";

/** One channel-level dashboard snapshot row. */
export interface DashboardSnapshot {
  id: string;
  snapshot_date: string; // YYYY-MM-DD
  metrics: Partial<Record<MetricKey, number>>;
  revenue_usd: number | null;
  revenue_basis: RevenueBasis;
  deltas: Partial<Record<MetricKey, number>>;
  source: SnapshotSource;
}

/** Read a metric value defensively — missing/non-numeric → 0. */
export function metricValue(
  metrics: Partial<Record<MetricKey, number>> | null | undefined,
  key: MetricKey,
): number {
  const v = metrics?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** UI-facing source label. `isDemo` drives the DEMO DATA badge. */
export function sourceLabel(source: SnapshotSource): { label: string; isDemo: boolean } {
  switch (source) {
    case "youtube_analytics":
      return { label: "YouTube Analytics", isDemo: false };
    case "meta_insights":
      return { label: "Meta Insights", isDemo: false };
    case "fixture":
      return { label: "DEMO DATA", isDemo: true };
  }
}

/** Parse a SnapshotSource defensively; unknown → 'fixture' (honest default). */
export function parseSource(v: unknown): SnapshotSource {
  return v === "youtube_analytics" || v === "meta_insights" ? v : "fixture";
}

/** Parse revenue_basis defensively; unknown → 'estimate' (contracts default). */
export function parseRevenueBasis(v: unknown): RevenueBasis {
  return v === "measured" ? "measured" : "estimate";
}
