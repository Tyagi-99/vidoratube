/**
 * Phase 4 · Stream B — F31 Content Buckets (bucket-level performance).
 *
 * D138: buckets are derived from PROJECT metadata, not invented labels:
 *   bucket = "<category> · <preset>"
 * where `category` is the content pillar and `preset` is the format preset
 * (e.g. "documentary", "shorts"). Videos without metadata fall into
 * "Uncategorized · standard". The UI must explain this grouping.
 *
 * Aggregation is honest: buckets with < 2 videos are still shown but marked
 * `thinData: true` so a single-video bucket is never presented as a trend.
 */

export interface BucketVideo {
  youtubeVideoId: string;
  title: string;
  category: string | null;
  preset: string | null;
  views: number;
  impressions: number;
  ctr: number;
  avgViewDurationS: number;
  watchTimeMinutes: number;
}

export interface BucketStats {
  bucket: string;
  category: string;
  preset: string;
  videoCount: number;
  totalViews: number;
  avgCtr: number;
  avgRetentionProxy: number;
  totalWatchTimeMinutes: number;
  /** True when the bucket has a single video — shown as an anecdote, not a trend. */
  thinData: boolean;
  topVideoTitle: string | null;
}

export function bucketKey(category: string | null, preset: string | null): string {
  const c = (category ?? "").trim() || "Uncategorized";
  const p = (preset ?? "").trim() || "standard";
  return `${c} · ${p}`;
}

/** Ranked bucket aggregation (descending by total views). Pure. */
export function aggregateBuckets(videos: BucketVideo[]): BucketStats[] {
  const groups = new Map<string, BucketVideo[]>();
  for (const v of videos) {
    const key = bucketKey(v.category, v.preset);
    const arr = groups.get(key) ?? [];
    arr.push(v);
    groups.set(key, arr);
  }
  const out: BucketStats[] = [];
  for (const [bucket, vs] of groups) {
    const [category, preset] = bucket.split(" · ");
    const totalViews = vs.reduce((a, v) => a + v.views, 0);
    const totalWatchTimeMinutes = vs.reduce((a, v) => a + v.watchTimeMinutes, 0);
    const avgCtr = vs.reduce((a, v) => a + v.ctr, 0) / vs.length;
    const avgRetentionProxy = vs.reduce((a, v) => a + v.avgViewDurationS, 0) / vs.length;
    const top = vs.reduce((a, b) => (b.views > a.views ? b : a), vs[0]!);
    out.push({
      bucket,
      category: category ?? "Uncategorized",
      preset: preset ?? "standard",
      videoCount: vs.length,
      totalViews,
      avgCtr,
      avgRetentionProxy,
      totalWatchTimeMinutes,
      thinData: vs.length < 2,
      topVideoTitle: top?.title ?? null,
    });
  }
  return out.sort((a, b) => b.totalViews - a.totalViews);
}

/** Rank buckets by a chosen metric (default: total views). Pure. */
export function rankBuckets(
  buckets: BucketStats[],
  by: "totalViews" | "avgCtr" | "avgRetentionProxy" | "totalWatchTimeMinutes" = "totalViews",
): BucketStats[] {
  return [...buckets].sort((a, b) => b[by] - a[by]);
}

/** Server loader: bucket stats for a user's published videos. */
export async function loadBucketVideos(admin: any, userId: string): Promise<BucketVideo[]> {
  const { data: snaps, error } = await admin
    .from("video_analytics")
    .select("youtube_video_id, metrics")
    .eq("user_id", userId)
    .order("snapshot_date", { ascending: false });
  if (error) throw new Error(error.message);
  const latest = new Map<string, any>();
  for (const s of (snaps ?? []) as any[]) {
    if (!latest.has(s.youtube_video_id)) latest.set(s.youtube_video_id, s.metrics ?? {});
  }
  if (latest.size === 0) return [];
  const { data: jobs } = await admin
    .from("publish_jobs")
    .select("youtube_video_id, title, project_id, projects(category, preset)")
    .eq("user_id", userId)
    .in("youtube_video_id", [...latest.keys()]);
  const out: BucketVideo[] = [];
  for (const j of (jobs ?? []) as any[]) {
    const m = latest.get(j.youtube_video_id);
    if (!m) continue;
    out.push({
      youtubeVideoId: j.youtube_video_id,
      title: j.title ?? "Untitled",
      category: j.projects?.category ?? null,
      preset: j.projects?.preset ?? null,
      views: Number(m.views ?? 0),
      impressions: Number(m.impressions ?? 0),
      ctr: Number(m.ctr ?? 0),
      avgViewDurationS: Number(m.avgViewDurationSec ?? 0),
      watchTimeMinutes: Number(m.watchTimeMinutes ?? 0),
    });
  }
  return out;
}
