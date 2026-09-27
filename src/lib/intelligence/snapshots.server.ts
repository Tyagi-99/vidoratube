/**
 * Stream A — snapshot writers + growth math (server-only).
 *
 * writeChannelSnapshot / writeVideoSnapshot append one row to the
 * channel_snapshots / video_snapshots time series. Growth/delta math always
 * reads snapshots, never live API values.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { adminDb, dbOne } from "./youtube-api.server";

/* ------------------------------------------------------------------ */
/* Row shapes (Phase 1 tables predate the generated Database types)    */
/* ------------------------------------------------------------------ */

export interface ChannelRow {
  id: string;
  user_id: string;
  workspace_id: string | null;
  platform: string;
  external_channel_id: string;
  handle: string | null;
  title: string | null;
  is_own: boolean;
  tracked: boolean;
  niche_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChannelSnapshotRow {
  id: string;
  user_id: string;
  channel_id: string;
  captured_at: string;
  subscriber_count: number | null;
  video_count: number | null;
  view_count: number | null;
  metrics: Json;
}

export interface VideoRow {
  id: string;
  user_id: string;
  channel_id: string | null;
  platform: string;
  external_video_id: string;
  title: string;
  description: string;
  published_at: string | null;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  is_own: boolean;
  metrics: Json;
  created_at: string;
  updated_at: string;
}

export interface VideoSnapshotRow {
  id: string;
  user_id: string;
  video_id: string;
  captured_at: string;
  view_count: number | null;
  like_count: number | null;
  comment_count: number | null;
  metrics: Json;
}

export interface ResearchProjectRow {
  id: string;
  user_id: string;
  topic: string;
  language: string | null;
  status: string | null;
  created_at: string;
  updated_at: string;
}

export interface VideoIdeaRow {
  id: string;
  user_id: string;
  project_id: string;
  title: string;
  hook: string;
  angle: string;
  format: string;
  difficulty: string | null;
  safety_flag: string;
  status: string | null;
  created_at: string;
  updated_at: string;
}

/* ------------------------------------------------------------------ */
/* Snapshot writers                                                    */
/* ------------------------------------------------------------------ */

export interface ChannelStatsInput {
  subscriberCount?: number | null | undefined;
  videoCount?: number | null | undefined;
  viewCount?: number | null | undefined;
  metrics?: Json | undefined;
}

export interface VideoStatsInput {
  viewCount?: number | null | undefined;
  likeCount?: number | null | undefined;
  commentCount?: number | null | undefined;
  metrics?: Json | undefined;
}

/**
 * Append one channel_snapshots row. Verifies the channel belongs to the user
 * first (the service-role client bypasses RLS, so ownership is checked here).
 */
export async function writeChannelSnapshot(
  admin: SupabaseClient<Database>,
  userId: string,
  channelId: string,
  stats: ChannelStatsInput,
): Promise<ChannelSnapshotRow> {
  const db = adminDb(admin);
  const channel = await dbOne<ChannelRow>(
    db
      .from("channels")
      .select("id, user_id")
      .eq("id", channelId)
      .eq("user_id", userId)
      .maybeSingle(),
  );
  if (!channel) throw new Error("Channel not found.");
  const row = await dbOne<ChannelSnapshotRow>(
    db
      .from("channel_snapshots")
      .insert({
        user_id: userId,
        channel_id: channelId,
        subscriber_count: stats.subscriberCount ?? null,
        video_count: stats.videoCount ?? null,
        view_count: stats.viewCount ?? null,
        metrics: stats.metrics ?? {},
      })
      .select(
        "id, user_id, channel_id, captured_at, subscriber_count, video_count, view_count, metrics",
      )
      .single(),
  );
  if (!row) throw new Error("Failed to write channel snapshot.");
  return row;
}

/**
 * Append one video_snapshots row. Verifies the video belongs to the user
 * first (the service-role client bypasses RLS, so ownership is checked here).
 */
export async function writeVideoSnapshot(
  admin: SupabaseClient<Database>,
  userId: string,
  videoId: string,
  stats: VideoStatsInput,
): Promise<VideoSnapshotRow> {
  const db = adminDb(admin);
  const video = await dbOne<VideoRow>(
    db.from("videos").select("id, user_id").eq("id", videoId).eq("user_id", userId).maybeSingle(),
  );
  if (!video) throw new Error("Video not found.");
  const row = await dbOne<VideoSnapshotRow>(
    db
      .from("video_snapshots")
      .insert({
        user_id: userId,
        video_id: videoId,
        view_count: stats.viewCount ?? null,
        like_count: stats.likeCount ?? null,
        comment_count: stats.commentCount ?? null,
        metrics: stats.metrics ?? {},
      })
      .select("id, user_id, video_id, captured_at, view_count, like_count, comment_count, metrics")
      .single(),
  );
  if (!row) throw new Error("Failed to write video snapshot.");
  return row;
}

/* ------------------------------------------------------------------ */
/* Growth math (pure; snapshot-derived only)                           */
/* ------------------------------------------------------------------ */

export interface GrowthSnapshot {
  captured_at: string;
  subscriber_count: number | null;
}

const GROWTH_WINDOW_DAYS = 7;
/** The reference snapshot must be at least this old for growth to be meaningful. */
const MIN_REFERENCE_AGE_HOURS = 24;

/**
 * 7-day subscriber growth percent for a channel, derived from snapshots.
 *
 * Compares the latest snapshot against the snapshot nearest to 7 days before
 * it (which must be a different snapshot at least 24h older). Returns null
 * when there are fewer than 2 usable snapshots, when no qualifying reference
 * exists, when either count is missing, or when the reference count is 0.
 * Null means "unknown" — never 0.
 */
export function computeSubscriberGrowthPct(snapshots: GrowthSnapshot[]): number | null {
  const valid = snapshots
    .filter(
      (s) =>
        s.subscriber_count !== null &&
        s.subscriber_count !== undefined &&
        !Number.isNaN(Date.parse(s.captured_at)),
    )
    .sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at));
  if (valid.length < 2) return null;

  const latest = valid[valid.length - 1];
  if (!latest || latest.subscriber_count === null || latest.subscriber_count === undefined) {
    return null;
  }
  const latestTs = Date.parse(latest.captured_at);
  const targetTs = latestTs - GROWTH_WINDOW_DAYS * 86_400_000;

  let reference: GrowthSnapshot | undefined;
  let bestDelta = Infinity;
  for (const s of valid) {
    if (s === latest) continue;
    const ts = Date.parse(s.captured_at);
    if (latestTs - ts < MIN_REFERENCE_AGE_HOURS * 3_600_000) continue;
    const delta = Math.abs(ts - targetTs);
    if (delta < bestDelta) {
      bestDelta = delta;
      reference = s;
    }
  }
  if (!reference) return null;
  const oldSubs = reference.subscriber_count;
  const newSubs = latest.subscriber_count;
  if (oldSubs === null || oldSubs === undefined || oldSubs <= 0) return null;
  if (newSubs === null || newSubs === undefined) return null;
  return ((newSubs - oldSubs) / oldSubs) * 100;
}
