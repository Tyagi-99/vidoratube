/**
 * Stream C — Video Intelligence (F5).
 *
 * analyzeVideo: descriptive deep-analysis of one tracked video. Everything
 * returned is an observed fact (packaging/publishing/performance) or the
 * snapshot-derived outlier score. Phase 2 wires no LLM, so `aiNotes` is
 * always an empty array — the UI labels the section accordingly instead of
 * inventing commentary.
 *
 * No CTR/virality/revenue predictions anywhere in this module.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "../server-auth";
import {
  computeOutlierScore,
  computeVelocityPerDay,
  intelDb,
  type SnapshotPoint,
  type VideoSnapshotRow,
} from "./outliers.functions";
import type { Json } from "@/integrations/supabase/types";
import type { OutlierScore } from "./types";
import type { VideoDetail } from "./videos.functions";

/* ------------------------------------------------------------------ */
/* Pure fact extractors (deterministic, unit-tested)                    */
/* ------------------------------------------------------------------ */

export interface PackagingFacts {
  title: string;
  thumbnailUrl: string | null;
  /** Unicode-aware character count. Descriptive only. */
  titleLength: number;
  hasNumber: boolean;
  hasQuestion: boolean;
}

export function packagingFacts(title: string, thumbnailUrl: string | null): PackagingFacts {
  return {
    title,
    thumbnailUrl,
    titleLength: [...title].length,
    hasNumber: /\d/.test(title),
    hasQuestion: title.includes("?"),
  };
}

export interface PublishingFacts {
  publishedAt: string | null;
  /** e.g. "Monday" (UTC). Null when published_at is unknown. */
  dayOfWeek: string | null;
  /** 0–23 UTC. Null when published_at is unknown. */
  hourUTC: number | null;
}

export function publishingFacts(publishedAt: string | null): PublishingFacts {
  if (!publishedAt) return { publishedAt: null, dayOfWeek: null, hourUTC: null };
  const d = new Date(publishedAt);
  if (Number.isNaN(d.getTime())) return { publishedAt, dayOfWeek: null, hourUTC: null };
  return {
    publishedAt,
    dayOfWeek: d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }),
    hourUTC: d.getUTCHours(),
  };
}

export interface PerformanceFacts {
  /** Latest observed view count. Null when unknown — never 0. */
  views: number | null;
  /** Views/day first→latest snapshot. Null when <2 snapshots. */
  viewsPerDay: number | null;
  /** Latest like count, falling back to the video metrics jsonb. */
  likeCount: number | null;
}

function metricsNumber(metrics: Json | null | undefined, keys: string[]): number | null {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return null;
  for (const k of keys) {
    const v: Json | undefined = metrics[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

export function performanceFacts(
  snapshots: SnapshotPoint[],
  latestLikeCount: number | null,
  videoMetrics: Json | null,
): PerformanceFacts {
  const last = snapshots[snapshots.length - 1];
  return {
    views: last?.viewCount ?? null,
    viewsPerDay: computeVelocityPerDay(snapshots),
    likeCount: latestLikeCount ?? metricsNumber(videoMetrics, ["likeCount", "like_count", "likes"]),
  };
}

/* ------------------------------------------------------------------ */
/* analyzeVideo                                                        */
/* ------------------------------------------------------------------ */

const analyzeVideoSchema = z.object({ videoId: z.string().uuid() });

export interface VideoAnalysis {
  video: VideoDetail;
  outlier: OutlierScore | null;
  packaging: PackagingFacts;
  publishing: PublishingFacts;
  performance: PerformanceFacts;
  /** Phase 2: always [] — no LLM is wired, so no notes are invented. */
  aiNotes: string[];
  /** Stream-C payload extension (not in the pinned contract): the owning
   * channel id, used by the compare picker. Null for channel-less videos. */
  channelId: string | null;
}

export const analyzeVideo = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => analyzeVideoSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = intelDb(supabaseAdmin);

    const { data: videoRow, error: videoError } = await db
      .from("videos")
      .select(
        "id, channel_id, external_video_id, title, description, published_at, " +
          "duration_seconds, thumbnail_url, metrics, channels(id, title)",
      )
      .eq("user_id", userId)
      .eq("id", data.videoId)
      .maybeSingle();
    if (videoError) throw new Error(videoError.message);
    if (!videoRow) {
      return {
        status: "insufficient_data" as const,
        reason: "Video not found in your tracked library.",
      };
    }
    const video = videoRow as {
      id: string;
      channel_id: string | null;
      external_video_id: string;
      title: string | null;
      description: string | null;
      published_at: string | null;
      duration_seconds: number | string | null;
      thumbnail_url: string | null;
      metrics: Json | null;
      channels: { id: string; title: string | null } | null;
    };

    const { data: snapRows, error: snapError } = await db
      .from("video_snapshots")
      .select("video_id, captured_at, view_count, like_count, comment_count")
      .eq("user_id", userId)
      .eq("video_id", video.id)
      .order("captured_at", { ascending: true });
    if (snapError) throw new Error(snapError.message);
    const snapshots = ((snapRows ?? []) as VideoSnapshotRow[]).map((s) => ({
      capturedAt: s.captured_at,
      viewCount: s.view_count,
    }));
    const lastSnap = (snapRows ?? []) as VideoSnapshotRow[];
    const latest = lastSnap[lastSnap.length - 1] ?? null;

    const title = video.title ?? "";
    const packaging = packagingFacts(title, video.thumbnail_url);
    const publishing = publishingFacts(video.published_at);
    const performance = performanceFacts(
      snapshots,
      latest?.like_count ?? null,
      video.metrics,
    );

    const duration =
      video.duration_seconds == null ? null : Number(video.duration_seconds);
    const durationSeconds =
      duration != null && Number.isFinite(duration) ? duration : null;

    // Outlier score: computed with Stream C's shared math against sibling
    // videos' latest snapshots. Null when not computable (no channel, no
    // siblings, or <1 snapshot with a view count).
    let outlier: OutlierScore | null = null;
    if (video.channel_id && snapshots.length > 0) {
      const { data: siblingRows } = await db
        .from("videos")
        .select("id")
        .eq("user_id", userId)
        .eq("channel_id", video.channel_id)
        .neq("id", video.id);
      const siblingIds = ((siblingRows ?? []) as { id: string }[]).map((r) => r.id);
      let siblingViews: number[] = [];
      if (siblingIds.length > 0) {
        const { data: sibSnaps } = await db
          .from("video_snapshots")
          .select("video_id, captured_at, view_count")
          .eq("user_id", userId)
          .in("video_id", siblingIds)
          .order("captured_at", { ascending: true });
        const latestByVideo = new Map<string, number>();
        for (const s of ((sibSnaps ?? []) as VideoSnapshotRow[])) {
          if (s.view_count != null) latestByVideo.set(s.video_id, s.view_count);
        }
        siblingViews = [...latestByVideo.values()];
      }
      const latestViews = performance.views;
      if (latestViews != null) {
        outlier = computeOutlierScore({
          latestViews,
          siblingLatestViews: siblingViews,
          snapshots,
        });
      }
    }

    const videoDetail: VideoDetail = {
      id: video.id,
      externalVideoId: video.external_video_id,
      title: title === "" ? "(untitled)" : title,
      thumbnailUrl: video.thumbnail_url,
      publishedAt: video.published_at,
      durationSeconds,
      viewCount: performance.views,
      outlierScore: outlier?.score ?? null,
      channelTitle: video.channels?.title ?? null,
      description: video.description ?? "",
      channelId: video.channel_id,
      metrics: video.metrics ?? {},
    };

    const analysis: VideoAnalysis = {
      video: videoDetail,
      outlier,
      packaging,
      publishing,
      performance,
      aiNotes: [],
      channelId: video.channel_id,
    };

    if (snapshots.length === 0) {
      return {
        status: "insufficient_data" as const,
        reason:
          "No metric snapshots have been captured for this video yet, so performance and outlier figures can't be computed.",
        analysis,
      };
    }
    return { status: "ok" as const, analysis };
  });
