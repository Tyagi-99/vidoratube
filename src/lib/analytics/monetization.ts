/**
 * Phase 4 · Stream B — F37 Monetization Studio.
 *
 * Honesty rules (non-negotiable):
 *  - RPM/CPM-derived revenue is ALWAYS labeled ESTIMATE.
 *  - revenue_usd is shown as "measured" ONLY when the snapshot's
 *    revenue_basis === 'measured' AND its source is a real platform source
 *    (never 'fixture'). Otherwise it is an estimate.
 *  - No earnings guarantees anywhere: estimates are projections from an
 *    assumed RPM, not promises.
 */

import { parseRevenueBasis, parseSource, type MetricKey, type RevenueBasis, type SnapshotSource } from "./types";

export interface MonetizationSettings {
  rpmEstimateUsd: number | null;
  cpmEstimateUsd: number | null;
  currency: "usd" | "inr";
}

export interface RevenueRow {
  snapshotDate: string;
  views: number;
  revenueUsd: number | null;
  /** How the UI must label this number. */
  label: "measured" | "estimate" | "unavailable";
  source: SnapshotSource;
}

export interface VideoRevenueEstimate {
  youtubeVideoId: string;
  title: string;
  views: number;
  estimatedRevenueUsd: number | null;
}

export interface MonetizationSummary {
  settings: MonetizationSettings;
  totalViews: number;
  measuredRevenueUsd: number;
  /** Null when no RPM is set — the UI must say so instead of showing $0. */
  estimatedRevenueUsd: number | null;
  rows: RevenueRow[];
  videoEstimates: VideoRevenueEstimate[];
  hasData: boolean;
}

/** Revenue = views / 1000 × RPM. Pure. */
export function estimateRevenueUsd(views: number, rpmUsd: number): number {
  if (!Number.isFinite(views) || !Number.isFinite(rpmUsd) || rpmUsd < 0) return 0;
  return (Math.max(0, views) / 1000) * rpmUsd;
}

/**
 * Decide how a revenue number must be labeled. A 'measured' basis on a
 * fixture row is demoted to 'estimate' — fixture data can never be measured.
 */
export function revenueLabel(
  revenueBasis: RevenueBasis,
  source: SnapshotSource,
  revenueUsd: number | null,
): RevenueRow["label"] {
  if (revenueUsd == null) return "unavailable";
  if (revenueBasis === "measured" && source !== "fixture") return "measured";
  return "estimate";
}

/** Format revenue with its honesty label baked in. */
export function formatRevenue(revenueUsd: number | null, label: RevenueRow["label"]): string {
  if (revenueUsd == null || label === "unavailable") return "—";
  const money = `$${revenueUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return label === "measured" ? `${money} (measured)` : `${money} (ESTIMATE)`;
}

interface SnapshotInput {
  snapshot_date: string;
  metrics: Partial<Record<MetricKey, number>>;
  revenue_usd: number | null;
  revenue_basis: unknown;
  source: unknown;
}

interface VideoInput {
  youtubeVideoId: string;
  title: string;
  views: number;
}

/** Build the monetization summary. Pure. */
export function summarizeMonetization(
  snapshots: SnapshotInput[],
  videos: VideoInput[],
  settings: MonetizationSettings,
): MonetizationSummary {
  const rows: RevenueRow[] = snapshots.map((s) => {
    const basis = parseRevenueBasis(s.revenue_basis);
    const source = parseSource(s.source);
    const revenueUsd = s.revenue_usd == null ? null : Number(s.revenue_usd);
    return {
      snapshotDate: s.snapshot_date,
      views: Number(s.metrics?.views ?? 0),
      revenueUsd,
      label: revenueLabel(basis, source, revenueUsd),
      source,
    };
  });
  const totalViews = rows.reduce((a, r) => a + r.views, 0);
  const measuredRevenueUsd = rows
    .filter((r) => r.label === "measured" && r.revenueUsd != null)
    .reduce((a, r) => a + (r.revenueUsd ?? 0), 0);
  const estimatedRevenueUsd =
    settings.rpmEstimateUsd != null ? estimateRevenueUsd(totalViews, settings.rpmEstimateUsd) : null;
  const videoEstimates: VideoRevenueEstimate[] = videos.map((v) => ({
    youtubeVideoId: v.youtubeVideoId,
    title: v.title,
    views: v.views,
    estimatedRevenueUsd: settings.rpmEstimateUsd != null ? estimateRevenueUsd(v.views, settings.rpmEstimateUsd) : null,
  }));
  return {
    settings,
    totalViews,
    measuredRevenueUsd,
    estimatedRevenueUsd,
    rows: rows.sort((a, b) => (a.snapshotDate < b.snapshotDate ? 1 : -1)),
    videoEstimates: videoEstimates.sort((a, b) => b.views - a.views),
    hasData: rows.length > 0 || videos.length > 0,
  };
}

/** Server loader: snapshots + per-video views + user RPM settings. */
export async function loadMonetization(admin: any, userId: string): Promise<MonetizationSummary> {
  const [{ data: snapRows }, { data: settingsRow }] = await Promise.all([
    admin
      .from("analytics_snapshots")
      .select("snapshot_date, metrics, revenue_usd, revenue_basis, source")
      .eq("user_id", userId)
      .order("snapshot_date", { ascending: false })
      .limit(90),
    admin.from("monetization_settings").select("*").eq("user_id", userId).maybeSingle(),
  ]);
  const settings: MonetizationSettings = {
    rpmEstimateUsd: settingsRow?.rpm_estimate_usd != null ? Number(settingsRow.rpm_estimate_usd) : null,
    cpmEstimateUsd: settingsRow?.cpm_estimate_usd != null ? Number(settingsRow.cpm_estimate_usd) : null,
    currency: settingsRow?.currency === "inr" ? "inr" : "usd",
  };

  const { data: videoSnaps } = await admin
    .from("video_analytics")
    .select("youtube_video_id, metrics")
    .eq("user_id", userId)
    .order("snapshot_date", { ascending: false });
  const latestViews = new Map<string, number>();
  for (const s of (videoSnaps ?? []) as any[]) {
    if (!latestViews.has(s.youtube_video_id)) latestViews.set(s.youtube_video_id, Number(s.metrics?.views ?? 0));
  }
  let videos: VideoInput[] = [];
  if (latestViews.size > 0) {
    const { data: jobs } = await admin
      .from("publish_jobs")
      .select("youtube_video_id, title")
      .eq("user_id", userId)
      .in("youtube_video_id", [...latestViews.keys()]);
    videos = ((jobs ?? []) as any[]).map((j) => ({
      youtubeVideoId: j.youtube_video_id,
      title: j.title ?? "Untitled",
      views: latestViews.get(j.youtube_video_id) ?? 0,
    }));
  }

  return summarizeMonetization((snapRows ?? []) as SnapshotInput[], videos, settings);
}

/** Server writer: upsert the user's assumed RPM/CPM (estimates only). */
export async function saveMonetizationSettings(
  admin: any,
  userId: string,
  input: { rpmEstimateUsd: number | null; cpmEstimateUsd: number | null },
): Promise<MonetizationSettings> {
  const rpm = input.rpmEstimateUsd;
  const cpm = input.cpmEstimateUsd;
  if (rpm != null && (!Number.isFinite(rpm) || rpm < 0 || rpm > 1000)) {
    throw new Error("RPM must be between 0 and 1000 USD.");
  }
  if (cpm != null && (!Number.isFinite(cpm) || cpm < 0 || cpm > 1000)) {
    throw new Error("CPM must be between 0 and 1000 USD.");
  }
  const { error } = await admin.from("monetization_settings").upsert(
    { user_id: userId, rpm_estimate_usd: rpm, cpm_estimate_usd: cpm, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(error.message);
  return { rpmEstimateUsd: rpm, cpmEstimateUsd: cpm, currency: "usd" };
}
