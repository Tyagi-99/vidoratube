/**
 * YouTube video performance metrics — pure functions for the P8 analytics
 * and learning loop. Named `video-performance` to avoid clashing with the
 * PostHog product-analytics module (`analytics.ts`).
 *
 * All inputs come from real YouTube Analytics / Data API snapshots.
 * Nothing here fabricates metrics.
 */

import { median, outlierScore, outlierTier, type OutlierTier } from "./outliers";

/** One per-video metric snapshot, as stored in `video_analytics.metrics`. */
export interface VideoMetrics {
  views: number;
  impressions: number;
  /** Impression click-through rate, 0–100. */
  ctr: number;
  /** Average view duration in seconds. */
  avgViewDurationSec: number;
  /** Full video duration in seconds (for retention). */
  videoDurationSec: number;
  watchTimeMinutes: number;
  likes: number;
  comments: number;
  subsGained: number;
}

/** A video joined with the metadata we need for pattern extraction. */
export interface VideoPerformance {
  youtubeVideoId: string;
  title: string;
  hook?: string | null;
  style?: string | null;
  publishedAt: string;
  metrics: VideoMetrics;
  /** P6 safety score at publish time (for validation), when known. */
  safetyScore?: number | null;
  /** Actual YouTube monetization status, when known. */
  monetizationStatus?: "monetized" | "limited" | "unknown" | null;
}

export interface ChannelAverages {
  avgViews: number;
  medianViews: number;
  avgCtr: number;
  avgRetention: number;
  avgLikes: number;
  videoCount: number;
}

/** Audience retention as a 0–100 percentage of the video watched on average. */
export function retentionPercent(m: VideoMetrics): number {
  if (m.videoDurationSec <= 0) return 0;
  return Math.min(100, (m.avgViewDurationSec / m.videoDurationSec) * 100);
}

/** Compare a value against the channel average. Positive = above average. */
export function vsAverage(value: number, channelAvg: number): {
  ratio: number;
  pctAbove: number;
} {
  if (channelAvg <= 0) return { ratio: 0, pctAbove: 0 };
  const ratio = value / channelAvg;
  return { ratio, pctAbove: (ratio - 1) * 100 };
}

/** Channel-level averages across a set of videos. Returns zeros when empty. */
export function channelAverages(videos: VideoPerformance[]): ChannelAverages {
  const n = videos.length;
  if (n === 0) {
    return { avgViews: 0, medianViews: 0, avgCtr: 0, avgRetention: 0, avgLikes: 0, videoCount: 0 };
  }
  const views = videos.map((v) => v.metrics.views);
  return {
    avgViews: views.reduce((a, b) => a + b, 0) / n,
    medianViews: median(views),
    avgCtr: videos.reduce((a, v) => a + v.metrics.ctr, 0) / n,
    avgRetention: videos.reduce((a, v) => a + retentionPercent(v.metrics), 0) / n,
    avgLikes: videos.reduce((a, v) => a + v.metrics.likes, 0) / n,
    videoCount: n,
  };
}

export interface OwnOutlier {
  youtubeVideoId: string;
  title: string;
  views: number;
  score: number;
  tier: OutlierTier;
}

/**
 * Detect own-channel outliers: videos whose views beat the channel median.
 * Only "outlier" (5x+) and "breakout" (10x+) tiers qualify — "strong" (2x+)
 * is encouraging but not outlier-worthy for the learning loop.
 */
export function detectOwnOutliers(videos: VideoPerformance[]): OwnOutlier[] {
  const medianViews = median(videos.map((v) => v.metrics.views));
  if (medianViews <= 0) return [];
  const out: OwnOutlier[] = [];
  for (const v of videos) {
    const score = outlierScore(v.metrics.views, medianViews);
    const tier = outlierTier(score);
    if (tier === "outlier" || tier === "breakout") {
      out.push({ youtubeVideoId: v.youtubeVideoId, title: v.title, views: v.metrics.views, score, tier });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Which style tag appears most among high-CTR videos? Returns null when there
 * is not enough data to say anything honest.
 */
export interface StyleCorrelation {
  style: string;
  videoCount: number;
  avgCtr: number;
  channelAvgCtr: number;
  /** How many points above channel average (absolute CTR points). */
  ctrLiftPoints: number;
}

export function styleCorrelations(
  videos: VideoPerformance[],
  minVideos = 3,
): StyleCorrelation[] {
  const byStyle = new Map<string, VideoPerformance[]>();
  for (const v of videos) {
    const style = (v.style ?? "").trim();
    if (!style) continue;
    const list = byStyle.get(style) ?? [];
    list.push(v);
    byStyle.set(style, list);
  }
  const channelAvgCtr =
    videos.length > 0
      ? videos.reduce((a, v) => a + v.metrics.ctr, 0) / videos.length
      : 0;
  const out: StyleCorrelation[] = [];
  for (const [style, list] of byStyle) {
    if (list.length < minVideos) continue;
    const avgCtr = list.reduce((a, v) => a + v.metrics.ctr, 0) / list.length;
    out.push({
      style,
      videoCount: list.length,
      avgCtr,
      channelAvgCtr,
      ctrLiftPoints: avgCtr - channelAvgCtr,
    });
  }
  return out.sort((a, b) => b.ctrLiftPoints - a.ctrLiftPoints);
}

/** Top N videos by views. */
export function topPerformers(videos: VideoPerformance[], n = 5): VideoPerformance[] {
  return [...videos].sort((a, b) => b.metrics.views - a.metrics.views).slice(0, n);
}

export interface WeeklyDigest {
  topVideo: VideoPerformance | null;
  totalViews: number;
  avgCtr: number;
  outlierCount: number;
  /** Exactly 3 suggestions, or fewer when data is too thin. */
  suggestions: string[];
  hasEnoughData: boolean;
}

/**
 * Build the weekly digest. Returns `hasEnoughData: false` with an honest
 * empty digest when there are fewer than 3 videos — no fabricated insight.
 */
export function buildWeeklyDigest(videos: VideoPerformance[]): WeeklyDigest {
  const hasEnoughData = videos.length >= 3;
  if (!hasEnoughData) {
    return {
      topVideo: null,
      totalViews: 0,
      avgCtr: 0,
      outlierCount: 0,
      suggestions: [],
      hasEnoughData: false,
    };
  }
  const top = topPerformers(videos, 1)[0]!;
  const avg = channelAverages(videos);
  const outliers = detectOwnOutliers(videos);
  const styleCorr = styleCorrelations(videos).filter((s) => s.ctrLiftPoints > 0.5);

  const suggestions: string[] = [];
  if (outliers.length > 0) {
    suggestions.push(
      `“${outliers[0]!.title}” outperformed your median ${outliers[0]!.score.toFixed(1)}x — consider a follow-up on the same angle.`,
    );
  }
  if (styleCorr.length > 0) {
    suggestions.push(
      `The “${styleCorr[0]!.style}” style averages ${styleCorr[0]!.avgCtr.toFixed(1)}% CTR vs ${styleCorr[0]!.channelAvgCtr.toFixed(1)}% channel-wide (correlation, not proof).`,
    );
  }
  const lowRetention = videos
    .filter((v) => retentionPercent(v.metrics) < avg.avgRetention * 0.7)
    .sort((a, b) => b.metrics.views - a.metrics.views)[0];
  if (lowRetention) {
    suggestions.push(
      `“${lowRetention.title}” has low retention (${retentionPercent(lowRetention.metrics).toFixed(0)}% vs ${avg.avgRetention.toFixed(0)}% avg) — tighten the first 30 seconds.`,
    );
  }
  return {
    topVideo: top,
    totalViews: videos.reduce((a, v) => a + v.metrics.views, 0),
    avgCtr: avg.avgCtr,
    outlierCount: outliers.length,
    suggestions: suggestions.slice(0, 3),
    hasEnoughData: true,
  };
}

/**
 * Snapshot dedupe key. Snapshots are one-per-video-per-day; the server
 * enforces it with the UNIQUE(youtube_video_id, snapshot_date) constraint,
 * and this helper lets callers build the same key for idempotent retries.
 */
export function snapshotDateKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Age of a video in whole days since publish. */
export function ageInDays(publishedAt: string, now: Date = new Date()): number {
  const diff = now.getTime() - new Date(publishedAt).getTime();
  return Math.max(0, Math.floor(diff / 86_400_000));
}

/** Should this video get a snapshot today? True on ~day 1 and ~day 7. */
export function isSnapshotDay(ageDays: number): boolean {
  return ageDays === 1 || ageDays === 7;
}
