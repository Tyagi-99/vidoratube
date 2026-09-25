/**
 * YouTube Analytics API v2 client (server-only).
 *
 * Fetches per-video performance metrics via reports.query. Quota cost is
 * ~1-2 units per call, so callers should batch videos into one request and
 * snapshot at most once per video per day.
 *
 * Docs: https://developers.google.com/youtube/analytics/reference/parameters
 */

const ANALYTICS_BASE = "https://youtubeanalytics.googleapis.com/v2/reports";
const DATA_BASE = "https://www.googleapis.com/youtube/v3/videos";

export interface RawVideoReport {
  videoId: string;
  views: number;
  estimatedMinutesWatched: number;
  averageViewDurationSec: number;
  likes: number;
  comments: number;
  subsGained: number;
  impressions: number;
  /** Impression CTR, 0–100. May be absent for old date ranges. */
  ctr: number;
}

interface ReportsResponse {
  columnHeaders?: { name: string }[];
  rows?: unknown[][];
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Fetch per-video metrics for up to 50 videos in a single API call.
 * start/end bound the window (e.g. last 30 days for a fresh video).
 */
export async function fetchVideoReports(
  accessToken: string,
  videoIds: string[],
  start: Date,
  end: Date,
): Promise<RawVideoReport[]> {
  if (videoIds.length === 0) return [];
  const params = new URLSearchParams({
    ids: "channel==MINE",
    startDate: toDate(start),
    endDate: toDate(end),
    metrics:
      "views,estimatedMinutesWatched,averageViewDuration,likes,comments,subscribersGained,impressions,impressionClickThroughRate",
    dimensions: "video",
    filters: `video==${videoIds.slice(0, 50).join(",")}`,
    sort: "-views",
    maxResults: "50",
  });
  const res = await fetch(`${ANALYTICS_BASE}?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`YouTube Analytics API error ${res.status}: ${body.slice(0, 200)}`);
  }
  const payload = (await res.json()) as ReportsResponse;
  const headers = (payload.columnHeaders ?? []).map((h) => h.name);
  const idx = (name: string) => headers.indexOf(name);
  return (payload.rows ?? []).map((row) => ({
    videoId: String(row[idx("video")] ?? ""),
    views: num(row[idx("views")]),
    estimatedMinutesWatched: num(row[idx("estimatedMinutesWatched")]),
    averageViewDurationSec: num(row[idx("averageViewDuration")]),
    likes: num(row[idx("likes")]),
    comments: num(row[idx("comments")]),
    subsGained: num(row[idx("subscribersGained")]),
    impressions: num(row[idx("impressions")]),
    ctr: num(row[idx("impressionClickThroughRate")]),
  }));
}

/** Channel-wide totals over a window. Used for channel_stats snapshots. */
export async function fetchChannelReport(
  accessToken: string,
  start: Date,
  end: Date,
): Promise<{ views: number; watchTimeMinutes: number; subsGained: number }> {
  const params = new URLSearchParams({
    ids: "channel==MINE",
    startDate: toDate(start),
    endDate: toDate(end),
    metrics: "views,estimatedMinutesWatched,subscribersGained",
  });
  const res = await fetch(`${ANALYTICS_BASE}?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`YouTube Analytics API error ${res.status}: ${body.slice(0, 200)}`);
  }
  const payload = (await res.json()) as ReportsResponse;
  const headers = (payload.columnHeaders ?? []).map((h) => h.name);
  const row = payload.rows?.[0] ?? [];
  const idx = (name: string) => headers.indexOf(name);
  return {
    views: num(row[idx("views")]),
    watchTimeMinutes: num(row[idx("estimatedMinutesWatched")]),
    subsGained: num(row[idx("subscribersGained")]),
  };
}

/** Parse ISO 8601 duration (PT#H#M#S) to seconds. */
export function parseIsoDuration(iso: string): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(iso);
  if (!m) return 0;
  return (
    Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
  );
}

/** Fetch video durations (contentDetails) for retention computation. */
export async function fetchVideoDurations(
  accessToken: string,
  videoIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (videoIds.length === 0) return out;
  const params = new URLSearchParams({
    part: "contentDetails",
    id: videoIds.slice(0, 50).join(","),
  });
  const res = await fetch(`${DATA_BASE}?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return out; // durations are nice-to-have; don't fail the snapshot
  const payload = (await res.json()) as {
    items?: { id: string; contentDetails?: { duration?: string } }[];
  };
  for (const item of payload.items ?? []) {
    out.set(item.id, parseIsoDuration(item.contentDetails?.duration ?? ""));
  }
  return out;
}
