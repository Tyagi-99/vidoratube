/**
 * P8 server functions: YouTube Analytics snapshots, channel overview,
 * learning loop (own outliers → P3, pattern extraction, safety validation),
 * weekly digest, CSV export.
 *
 * snapshotAnalyticsCron is designed for an external scheduler (pg_cron or
 * any cron hitting the endpoint with ANALYTICS_CRON_SECRET). See docs/P8_CRON.md.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "./server-auth";
import {
  ageInDays,
  buildWeeklyDigest,
  channelAverages,
  detectOwnOutliers,
  isSnapshotDay,
  retentionPercent,
  snapshotDateKey,
  styleCorrelations,
  topPerformers,
  vsAverage,
  type VideoMetrics,
  type VideoPerformance,
} from "./video-performance";

/* ------------------------------------------------------------------ */
/* Shared server-only helpers                                          */
/* ------------------------------------------------------------------ */

interface DueVideo {
  publishJobId: string;
  youtubeVideoId: string;
  publishedAt: string;
  title: string | null;
  projectId: string;
  visualStyle: string | null;
}

/** Published videos on a 24h/7d snapshot day with no snapshot taken today. */
async function findDueVideos(admin: any, userId: string): Promise<DueVideo[]> {
  const today = snapshotDateKey();
  const { data: jobs, error } = await admin
    .from("publish_jobs")
    .select("id, youtube_video_id, published_at, title, project_id, projects(visual_style)")
    .eq("user_id", userId)
    .eq("status", "published")
    .not("youtube_video_id", "is", null)
    .not("published_at", "is", null);
  if (error) throw new Error(error.message);
  const due: DueVideo[] = [];
  for (const job of (jobs ?? []) as any[]) {
    const age = ageInDays(job.published_at as string);
    if (!isSnapshotDay(age)) continue;
    const { data: existing } = await admin
      .from("video_analytics")
      .select("id")
      .eq("youtube_video_id", job.youtube_video_id)
      .eq("snapshot_date", today)
      .maybeSingle();
    if (existing) continue;
    due.push({
      publishJobId: job.id,
      youtubeVideoId: job.youtube_video_id as string,
      publishedAt: job.published_at as string,
      title: job.title,
      projectId: job.project_id,
      visualStyle: (job.projects as { visual_style?: string } | null)?.visual_style ?? null,
    });
  }
  return due;
}

async function getAccessTokenForUser(admin: any, userId: string): Promise<string> {
  const { getValidAccessToken } = await import("./youtube.server");
  const { data: connection } = await admin
    .from("youtube_connections")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (!connection) throw new Error("Connect your YouTube channel first.");
  const { accessToken, refreshed } = await getValidAccessToken(connection);
  if (refreshed?.access_token) {
    const { encryptToken } = await import("./youtube.server");
    await admin
      .from("youtube_connections")
      .update({
        access_token: await encryptToken(refreshed.access_token),
        expires_at: new Date(Date.now() + (refreshed.expires_in ?? 3500) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
  }
  return accessToken;
}

/** Snapshot all due videos for one user. Returns counts. */
export async function snapshotUserVideos(
  admin: any,
  userId: string,
): Promise<{ videos: number; skippedNoConnection: boolean }> {
  const due = await findDueVideos(admin, userId);
  if (due.length === 0) return { videos: 0, skippedNoConnection: false };

  let accessToken: string;
  try {
    accessToken = await getAccessTokenForUser(admin, userId);
  } catch {
    return { videos: 0, skippedNoConnection: true };
  }

  const { fetchVideoReports, fetchVideoDurations, fetchChannelReport } = await import(
    "./yt-analytics.server"
  );
  const ids = due.map((d) => d.youtubeVideoId);
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 86_400_000);
  const [reports, durations] = await Promise.all([
    fetchVideoReports(accessToken, ids, start, end),
    fetchVideoDurations(accessToken, ids),
  ]);
  const byId = new Map(reports.map((r) => [r.videoId, r]));
  const today = snapshotDateKey();

  let saved = 0;
  for (const d of due) {
    const r = byId.get(d.youtubeVideoId);
    if (!r) continue; // no data yet for this video — try again on the next window
    const metrics: VideoMetrics = {
      views: r.views,
      impressions: r.impressions,
      ctr: r.ctr,
      avgViewDurationSec: r.averageViewDurationSec,
      videoDurationSec: durations.get(d.youtubeVideoId) ?? 0,
      watchTimeMinutes: r.estimatedMinutesWatched,
      likes: r.likes,
      comments: r.comments,
      subsGained: r.subsGained,
    };
    const { error } = await admin.from("video_analytics").upsert(
      {
        user_id: userId,
        publish_job_id: d.publishJobId,
        youtube_video_id: d.youtubeVideoId,
        snapshot_date: today,
        age_days: ageInDays(d.publishedAt),
        metrics,
      },
      { onConflict: "youtube_video_id,snapshot_date" },
    );
    if (!error) saved++;
  }

  // Channel-level snapshot (one per user per day).
  try {
    const channel = await fetchChannelReport(accessToken, start, end);
    await admin.from("channel_stats").upsert(
      {
        user_id: userId,
        snapshot_date: today,
        metrics: { ...channel, videoCount: due.length },
      },
      { onConflict: "user_id,snapshot_date" },
    );
  } catch (e) {
    console.warn("[analytics] channel snapshot failed:", e instanceof Error ? e.message : e);
  }

  return { videos: saved, skippedNoConnection: false };
}

/** Latest snapshot per video for a user, joined with job/project metadata. */
async function loadPerformances(admin: any, userId: string): Promise<VideoPerformance[]> {
  const { data: snaps, error } = await admin
    .from("video_analytics")
    .select("youtube_video_id, metrics, snapshot_date")
    .eq("user_id", userId)
    .order("snapshot_date", { ascending: false });
  if (error) throw new Error(error.message);
  const latest = new Map<string, { metrics: VideoMetrics; snapshot_date: string }>();
  for (const s of (snaps ?? []) as any[]) {
    if (!latest.has(s.youtube_video_id)) {
      latest.set(s.youtube_video_id, {
        metrics: s.metrics as unknown as VideoMetrics,
        snapshot_date: s.snapshot_date,
      });
    }
  }
  if (latest.size === 0) return [];

  const { data: jobs } = await admin
    .from("publish_jobs")
    .select("youtube_video_id, title, project_id, published_at, projects(visual_style)")
    .eq("user_id", userId)
    .in("youtube_video_id", [...latest.keys()]);
  const jobByVideo = new Map((jobs ?? []).map((j: any) => [j.youtube_video_id, j]));

  const projectIds = [...new Set((jobs ?? []).map((j: any) => j.project_id))];
  const { data: scores } = await admin
    .from("safety_scores")
    .select("project_id, score")
    .in("project_id", projectIds.length > 0 ? projectIds : ["00000000-0000-0000-0000-000000000000"])
    .order("created_at", { ascending: false });
  const scoreByProject = new Map<string, number>();
  for (const s of scores ?? []) {
    if (!scoreByProject.has(s.project_id)) scoreByProject.set(s.project_id, s.score);
  }

  const out: VideoPerformance[] = [];
  for (const [videoId, snap] of latest) {
    const job = jobByVideo.get(videoId) as any;
    if (!job) continue;
    out.push({
      youtubeVideoId: videoId,
      title: job.title ?? "Untitled",
      style: (job.projects as { visual_style?: string } | null)?.visual_style ?? null,
      publishedAt: job.published_at ?? new Date().toISOString(),
      metrics: snap.metrics,
      safetyScore: scoreByProject.get(job.project_id) ?? null,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* snapshotAnalytics (user-triggered, rate-limited)                    */
/* ------------------------------------------------------------------ */

export const emptySchema = z.object({});

export const snapshotAnalytics = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => emptySchema.parse(i))
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { enforcePostgresRateLimit } = await import("./rate-limit");
    await enforcePostgresRateLimit(
      supabaseAdmin,
      `analytics:snapshot:${userId}`,
      { max: 4, windowSeconds: 3600 },
      "Analytics sync is limited to 4 times per hour.",
    );
    return snapshotUserVideos(supabaseAdmin, userId);
  });

/* ------------------------------------------------------------------ */
/* snapshotAnalyticsCron (service-role, cron secret)                    */
/* ------------------------------------------------------------------ */

export const cronSchema = z.object({ cron_secret: z.string().min(1) });

/**
 * Cron entry point: snapshots due videos for every user with published
 * videos. Call daily from pg_cron / external scheduler with the secret.
 */
export const snapshotAnalyticsCron = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => cronSchema.parse(i))
  .handler(async ({ data }) => {
    const secret = process.env["ANALYTICS_CRON_SECRET"];
    if (!secret || data.cron_secret !== secret) {
      throw new Error("Unauthorized");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Users with published videos on a snapshot day (age 1 or 7).
    const { data: jobs } = await supabaseAdmin
      .from("publish_jobs")
      .select("user_id, published_at")
      .eq("status", "published")
      .not("youtube_video_id", "is", null)
      .not("published_at", "is", null);
    const userIds = new Set<string>();
    for (const j of (jobs ?? []) as any[]) {
      if (isSnapshotDay(ageInDays(j.published_at as string))) userIds.add(j.user_id as string);
    }
    let videos = 0;
    let users = 0;
    const errors: string[] = [];
    for (const userId of userIds) {
      try {
        const r = await snapshotUserVideos(supabaseAdmin, userId);
        videos += r.videos;
        users++;
      } catch (e) {
        errors.push(`${userId}: ${e instanceof Error ? e.message : e}`);
      }
    }
    return { users, videos, errors: errors.slice(0, 10) };
  });

/* ------------------------------------------------------------------ */
/* getChannelOverview                                                  */
/* ------------------------------------------------------------------ */

export const getChannelOverview = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => emptySchema.parse(i))
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: channelStats } = await supabaseAdmin
      .from("channel_stats")
      .select("metrics, snapshot_date")
      .eq("user_id", userId)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const videos = await loadPerformances(supabaseAdmin, userId);
    const averages = channelAverages(videos);
    const enriched = videos.map((v) => ({
      ...v,
      retention: retentionPercent(v.metrics),
      viewsVsAvg: vsAverage(v.metrics.views, averages.avgViews),
      ctrVsAvg: vsAverage(v.metrics.ctr, averages.avgCtr),
    }));
    return {
      channel: channelStats?.metrics ?? null,
      channelSnapshotDate: channelStats?.snapshot_date ?? null,
      averages,
      videos: enriched.sort((a, b) => b.metrics.views - a.metrics.views),
      hasData: videos.length > 0,
    };
  });

/* ------------------------------------------------------------------ */
/* getVideoAnalytics                                                   */
/* ------------------------------------------------------------------ */

export const videoSchema = z.object({ youtube_video_id: z.string().min(5).max(20) });

export const getVideoAnalytics = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => videoSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Ownership check via publish_jobs.
    const { data: job } = await supabaseAdmin
      .from("publish_jobs")
      .select("id")
      .eq("user_id", userId)
      .eq("youtube_video_id", data.youtube_video_id)
      .maybeSingle();
    if (!job) throw new Error("Video not found");
    const { data: snaps, error } = await supabaseAdmin
      .from("video_analytics")
      .select("snapshot_date, age_days, metrics")
      .eq("user_id", userId)
      .eq("youtube_video_id", data.youtube_video_id)
      .order("snapshot_date", { ascending: true });
    if (error) throw new Error(error.message);
    return { snapshots: snaps ?? [] };
  });

/* ------------------------------------------------------------------ */
/* runLearningLoop                                                     */
/* ------------------------------------------------------------------ */

/**
 * Learning loop:
 * 1. Own-channel outliers → outlier_videos (source='own') under the user's
 *    "My Channel" research project (created on first run).
 * 2. Style↔CTR correlations → learning_insights (kind='pattern').
 * 3. Safety score vs actual status → learning_insights (kind='safety_validation').
 *
 * The P3 idea generator automatically picks up source='own' outliers because
 * they live in the same outlier_videos table it already queries.
 */
export const runLearningLoop = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => emptySchema.parse(i))
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { enforcePostgresRateLimit } = await import("./rate-limit");
    await enforcePostgresRateLimit(
      supabaseAdmin,
      `analytics:learning:${userId}`,
      { max: 4, windowSeconds: 3600 },
      "The learning loop is limited to 4 runs per hour.",
    );

    const videos = await loadPerformances(supabaseAdmin, userId);
    if (videos.length < 3) {
      return { ran: false, reason: "not_enough_data", videoCount: videos.length };
    }

    const summary = { outliersAdded: 0, patterns: 0, safetyChecks: 0 };

    // 1. Own outliers → P3 table.
    const outliers = detectOwnOutliers(videos);
    if (outliers.length > 0) {
      // Find-or-create the "My Channel" research project.
      let { data: project } = await supabaseAdmin
        .from("research_projects")
        .select("id")
        .eq("user_id", userId)
        .eq("topic", "My Channel Performance")
        .maybeSingle();
      if (!project) {
        const { data: created, error } = await supabaseAdmin
          .from("research_projects")
          .insert({ user_id: userId, topic: "My Channel Performance", language: "English", niches: [] })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        project = created;
      }
      for (const o of outliers) {
        const v = videos.find((x) => x.youtubeVideoId === o.youtubeVideoId);
        const { error } = await supabaseAdmin.from("outlier_videos").upsert(
          {
            user_id: userId,
            project_id: project.id,
            youtube_id: o.youtubeVideoId,
            title: o.title,
            channel_title: "My channel",
            view_count: o.views,
            published_at: v?.publishedAt ?? null,
            outlier_score: o.score,
            source: "own",
            patterns: {
              tier: o.tier,
              ctr: v?.metrics.ctr ?? 0,
              retention: v ? retentionPercent(v.metrics) : 0,
              style: v?.style ?? null,
              note: "Own-channel outlier detected by the learning loop.",
            },
          },
          { onConflict: "project_id,youtube_id" },
        );
        if (!error) summary.outliersAdded++;
      }
    }

    // 2. Style correlations → insights (labeled correlation, never causation).
    const correlations = styleCorrelations(videos).filter((c) => c.ctrLiftPoints > 0.5);
    for (const c of correlations.slice(0, 5)) {
      await supabaseAdmin.from("learning_insights").insert({
        user_id: userId,
        kind: "pattern",
        payload: {
          ...c,
          note: "Correlation only — this pattern appeared alongside higher CTR; it does not prove causation.",
        },
      });
      summary.patterns++;
    }

    // 3. Safety validation: score vs actual monetization status.
    for (const v of videos) {
      if (v.safetyScore == null) continue;
      await supabaseAdmin.from("learning_insights").insert({
        user_id: userId,
        kind: "safety_validation",
        payload: {
          youtube_video_id: v.youtubeVideoId,
          title: v.title,
          safety_score: v.safetyScore,
          monetization_status: v.monetizationStatus ?? "unknown",
          note: "Tracks whether P6 safety scores predict actual monetization status over time.",
        },
      });
      summary.safetyChecks++;
    }

    return { ran: true, videoCount: videos.length, ...summary };
  });

/* ------------------------------------------------------------------ */
/* getLearningInsights                                                 */
/* ------------------------------------------------------------------ */

export const insightsSchema = z.object({
  kind: z.enum(["own_outlier", "pattern", "idea_boost", "safety_validation"]).optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export const getLearningInsights = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => insightsSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("learning_insights")
      .select("id, kind, payload, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.kind) q = q.eq("kind", data.kind);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { insights: rows ?? [] };
  });

/* ------------------------------------------------------------------ */
/* getWeeklyDigest                                                     */
/* ------------------------------------------------------------------ */

export const getWeeklyDigest = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => emptySchema.parse(i))
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const videos = await loadPerformances(supabaseAdmin, userId);
    const digest = buildWeeklyDigest(videos);
    const top = digest.topVideo ? topPerformers(videos, 5).map((v) => ({
      youtubeVideoId: v.youtubeVideoId,
      title: v.title,
      views: v.metrics.views,
      ctr: v.metrics.ctr,
      retention: retentionPercent(v.metrics),
    })) : [];
    return { ...digest, topVideos: top };
  });

/* ------------------------------------------------------------------ */
/* exportAnalyticsCsv                                                  */
/* ------------------------------------------------------------------ */

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const exportAnalyticsCsv = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => emptySchema.parse(i))
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: snaps, error } = await supabaseAdmin
      .from("video_analytics")
      .select("youtube_video_id, snapshot_date, age_days, metrics")
      .eq("user_id", userId)
      .order("snapshot_date", { ascending: true })
      .limit(2000);
    if (error) throw new Error(error.message);
    const header = "youtube_video_id,snapshot_date,age_days,views,impressions,ctr,avg_view_duration_sec,video_duration_sec,watch_time_minutes,likes,comments,subs_gained";
    const lines = (snaps ?? []).map((s) => {
      const m = s.metrics as unknown as VideoMetrics;
      return [
        s.youtube_video_id, s.snapshot_date, s.age_days, m.views, m.impressions, m.ctr,
        m.avgViewDurationSec, m.videoDurationSec, m.watchTimeMinutes, m.likes, m.comments, m.subsGained,
      ].map(csvEscape).join(",");
    });
    return { csv: [header, ...lines].join("\n"), rowCount: lines.length };
  });
