/**
 * Phase 4 · Stream B — F30 Analytics Dashboard (server-side loaders).
 *
 * Reads channel overview from `analytics_snapshots` (metrics keys per the
 * PINNED contracts vocab) and computes deltas vs the prior 28-day period
 * with honest baselines (see deltas.ts / D137).
 *
 * YouTube Analytics ingestion is OAuth-gated: without a connected YouTube
 * account we return `{ connected: false }` and the UI shows an honest
 * "unavailable" state — we NEVER fabricate numbers.
 */

import {
  parseRevenueBasis,
  parseSource,
  type DashboardSnapshot,
  type MetricKey,
} from "./types";
import { computeDeltas, pickDeltaPair, type MetricDelta } from "./deltas";

export interface IngestionStatus {
  connected: boolean;
  /** Present only when connected:false. */
  reason?: "youtube_not_connected";
}

export interface PerVideoRow {
  youtubeVideoId: string;
  title: string;
  publishedAt: string | null;
  views: number;
  impressions: number;
  ctr: number;
  avgViewDurationS: number;
  watchTimeMinutes: number;
  likes: number;
  commentCount: number;
  subscribersGained: number;
  snapshotDate: string | null;
  /** Bucket dimensions from project metadata (F31). */
  category: string | null;
  preset: string | null;
}

export interface DashboardData {
  snapshots: DashboardSnapshot[];
  current: DashboardSnapshot | null;
  prior: DashboardSnapshot | null;
  deltas: MetricDelta[];
  perVideo: PerVideoRow[];
  ingestion: IngestionStatus;
  hasData: boolean;
}

function toSnapshot(row: any): DashboardSnapshot {
  return {
    id: String(row.id),
    snapshot_date: String(row.snapshot_date),
    metrics: (row.metrics ?? {}) as Partial<Record<MetricKey, number>>,
    revenue_usd: row.revenue_usd == null ? null : Number(row.revenue_usd),
    revenue_basis: parseRevenueBasis(row.revenue_basis),
    deltas: (row.deltas ?? {}) as Partial<Record<MetricKey, number>>,
    source: parseSource(row.source),
  };
}

/** Latest video_analytics snapshot per video, joined to job + project metadata. */
async function loadPerVideo(admin: any, userId: string): Promise<PerVideoRow[]> {
  const { data: snaps, error } = await admin
    .from("video_analytics")
    .select("youtube_video_id, metrics, snapshot_date")
    .eq("user_id", userId)
    .order("snapshot_date", { ascending: false });
  if (error) throw new Error(error.message);
  const latest = new Map<string, { metrics: any; snapshot_date: string }>();
  for (const s of (snaps ?? []) as any[]) {
    if (!latest.has(s.youtube_video_id)) {
      latest.set(s.youtube_video_id, { metrics: s.metrics ?? {}, snapshot_date: s.snapshot_date });
    }
  }
  if (latest.size === 0) return [];

  const { data: jobs } = await admin
    .from("publish_jobs")
    .select("youtube_video_id, title, published_at, project_id, projects(category, preset)")
    .eq("user_id", userId)
    .in("youtube_video_id", [...latest.keys()]);
  const jobByVideo = new Map((jobs ?? []).map((j: any) => [j.youtube_video_id, j]));

  const rows: PerVideoRow[] = [];
  for (const [videoId, snap] of latest) {
    const job = jobByVideo.get(videoId) as any;
    const m = snap.metrics as any;
    rows.push({
      youtubeVideoId: videoId,
      title: job?.title ?? "Untitled",
      publishedAt: job?.published_at ?? null,
      views: Number(m.views ?? 0),
      impressions: Number(m.impressions ?? 0),
      ctr: Number(m.ctr ?? 0),
      avgViewDurationS: Number(m.avgViewDurationSec ?? 0),
      watchTimeMinutes: Number(m.watchTimeMinutes ?? 0),
      likes: Number(m.likes ?? 0),
      commentCount: Number(m.comments ?? 0),
      subscribersGained: Number(m.subsGained ?? 0),
      snapshotDate: snap.snapshot_date,
      category: job?.projects?.category ?? null,
      preset: job?.projects?.preset ?? null,
    });
  }
  return rows.sort((a, b) => b.views - a.views);
}

async function youtubeConnected(admin: any, userId: string): Promise<boolean> {
  const { data } = await admin
    .from("youtube_connections")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

/** F30 dashboard payload. */
export async function loadDashboardData(admin: any, userId: string): Promise<DashboardData> {
  const { data: rows, error } = await admin
    .from("analytics_snapshots")
    .select("id, snapshot_date, metrics, revenue_usd, revenue_basis, deltas, source")
    .eq("user_id", userId)
    .order("snapshot_date", { ascending: false })
    .limit(90);
  if (error) throw new Error(error.message);

  const snapshots = ((rows ?? []) as any[]).map(toSnapshot);
  const { current, prior } = pickDeltaPair(snapshots);
  const deltas = current ? computeDeltas(current, prior) : [];
  const perVideo = await loadPerVideo(admin, userId);
  const connected = await youtubeConnected(admin, userId);

  return {
    snapshots,
    current,
    prior,
    deltas,
    perVideo,
    ingestion: connected ? { connected: true } : { connected: false, reason: "youtube_not_connected" },
    hasData: snapshots.length > 0 || perVideo.length > 0,
  };
}

export interface IngestResult {
  ok: boolean;
  /** Present when ok:false — the UI must render this honestly, never numbers. */
  reason?: "youtube_not_connected" | "api_error";
  message?: string;
  snapshotDate?: string;
}

/**
 * OAuth-gated YouTube Analytics ingestion → analytics_snapshots.
 * Fetches the channel report for the current and prior 28d windows and
 * stores one snapshot with source='youtube_analytics'. Without a YouTube
 * connection returns ok:false — no fake data, ever.
 */
export async function ingestChannelSnapshot(admin: any, userId: string): Promise<IngestResult> {
  const { data: connection } = await admin
    .from("youtube_connections")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (!connection) {
    return { ok: false, reason: "youtube_not_connected", message: "Connect your YouTube channel to pull live analytics." };
  }

  let accessToken: string;
  try {
    const { getValidAccessToken, encryptToken } = await import("../youtube.server");
    const { accessToken: token, refreshed } = await getValidAccessToken(connection);
    accessToken = token;
    if (refreshed?.access_token) {
      await admin
        .from("youtube_connections")
        .update({
          access_token: await encryptToken(refreshed.access_token),
          expires_at: new Date(Date.now() + (refreshed.expires_in ?? 3500) * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
    }
  } catch (e) {
    return { ok: false, reason: "api_error", message: e instanceof Error ? e.message : "Token refresh failed" };
  }

  try {
    const { fetchChannelReport } = await import("../yt-analytics.server");
    const end = new Date();
    const mid = new Date(end.getTime() - 28 * 86_400_000);
    const start = new Date(end.getTime() - 56 * 86_400_000);
    const [cur, prv] = await Promise.all([
      fetchChannelReport(accessToken, mid, end),
      fetchChannelReport(accessToken, start, mid),
    ]);
    const today = end.toISOString().slice(0, 10);
    const metrics = {
      views: cur.views,
      watch_time_minutes: cur.watchTimeMinutes,
      subscribers_gained: cur.subsGained,
    };
    const deltas = {
      views: cur.views - prv.views,
      watch_time_minutes: cur.watchTimeMinutes - prv.watchTimeMinutes,
      subscribers_gained: cur.subsGained - prv.subsGained,
    };
    const { data: existing } = await admin
      .from("analytics_snapshots")
      .select("id")
      .eq("user_id", userId)
      .eq("snapshot_date", today)
      .is("channel_id", null)
      .maybeSingle();
    const row = {
      user_id: userId,
      snapshot_date: today,
      metrics,
      deltas,
      revenue_usd: null,
      revenue_basis: "estimate",
      source: "youtube_analytics",
    };
    const { error } = existing
      ? await admin.from("analytics_snapshots").update(row).eq("id", existing.id)
      : await admin.from("analytics_snapshots").insert(row);
    if (error) throw new Error(error.message);
    return { ok: true, snapshotDate: today };
  } catch (e) {
    return { ok: false, reason: "api_error", message: e instanceof Error ? e.message : "YouTube Analytics request failed" };
  }
}
