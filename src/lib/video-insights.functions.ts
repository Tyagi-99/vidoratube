/**
 * Sprint 7-8: video-insights server functions.
 *
 * User-scoped insights computed from REAL stored data only:
 * - platform 24h/7d view deltas from platform_video_stats snapshots
 * - audience-retention curves synced from YouTube Analytics, aligned to
 *   real chapter (paragraph) boundaries
 * - "Next 5 videos" deterministic recommendations over existing video_ideas
 * - NPS capture with rate-limited prompting
 *
 * Every function uses requireAppUser (rejects anonymous sessions) and the
 * service client with an explicit user_id filter — never an ambient session.
 */

import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { requireAppUser } from "./server-auth";
import {
  computeViewsWindows,
  parseMetricsPayload,
  type ViewsWindows,
} from "@/lib/platform-stats";
import {
  buildRetentionModel,
  type RetentionPoint,
  type RetentionSegment,
} from "@/lib/retention-curve";
import { npsCategory, validateNpsScore, type NpsCategory } from "@/lib/nps";
import {
  recommendNextVideos,
  type CandidateIdea,
} from "@/lib/next-videos";

const jobIdSchema = z.object({ youtubeVideoId: z.string().min(1).max(64) });

type OwnedJob = { id: string; project_id: string; title: string | null };

async function requireOwnedJob(admin: any, userId: string, youtubeVideoId: string): Promise<OwnedJob> {
  const { data: job, error } = await admin
    .from("publish_jobs")
    .select("id, project_id, title")
    .eq("user_id", userId)
    .eq("youtube_video_id", youtubeVideoId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!job) throw new Error("Video not found");
  return job as OwnedJob;
}

/** 24h / 7d view deltas for one published video, from real snapshots. */
export const getPlatformStats = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator(jobIdSchema)
  .handler(async ({ data, context }): Promise<ViewsWindows> => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const job = await requireOwnedJob(supabaseAdmin, userId, data.youtubeVideoId);
    const { data: rows, error } = await supabaseAdmin
      .from("platform_video_stats")
      .select("captured_at, metrics")
      .eq("user_id", userId)
      .eq("publish_job_id", job.id)
      .order("captured_at", { ascending: true });
    if (error) throw new Error(error.message);
    return computeViewsWindows(
      (rows ?? []).map((r) => parseMetricsPayload(r.metrics, r.captured_at as string)),
    );
  });

/** Pull the latest audience-retention curve from YouTube Analytics and store it. */
export const snapshotRetentionCurve = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator(jobIdSchema)
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const job = await requireOwnedJob(supabaseAdmin, userId, data.youtubeVideoId);

    // Rate limit: at most one sync per video per hour.
    const { data: last } = await supabaseAdmin
      .from("retention_curves")
      .select("captured_at")
      .eq("user_id", userId)
      .eq("publish_job_id", job.id)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last?.captured_at && Date.now() - new Date(last.captured_at as string).getTime() < 60 * 60 * 1000) {
      return { ok: true, skipped: true as const };
    }

    const { fetchRetentionCurve } = await import("./yt-analytics.server");
    const { getValidAccessToken } = await import("./youtube.server");
    const { data: connection } = await supabaseAdmin
      .from("youtube_connections")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (!connection) return { ok: false as const, reason: "no_connection" as const };
    const { accessToken } = await getValidAccessToken(connection);

    const points = await fetchRetentionCurve(accessToken, data.youtubeVideoId);
    if (!points || points.length < 3) {
      return { ok: false as const, reason: "no_data" as const };
    }

    // Chapter boundaries from real paragraph audio durations: chapters belong
    // to renders, renders belong to this video job.
    const segments: RetentionSegment[] = [];
    const { data: pubJob } = await supabaseAdmin
      .from("publish_jobs")
      .select("video_job_id")
      .eq("id", job.id)
      .maybeSingle();
    if (pubJob?.video_job_id) {
      const { data: userRenders } = await supabaseAdmin
        .from("renders")
        .select("id")
        .eq("user_id", userId)
        .eq("job_id", pubJob.video_job_id as string)
        .order("created_at", { ascending: false })
        .limit(5);
      const renderIds = ((userRenders ?? []) as Array<{ id: string }>).map((r) => r.id);
      if (renderIds.length > 0) {
        const { data: chapters } = await supabaseAdmin
          .from("render_chapters")
          .select("paragraphs")
          .in("render_id", renderIds)
          .order("created_at", { ascending: false })
          .limit(20);
        let offset = 0;
        let idx = 0;
        for (const row of (chapters ?? []) as Array<{ paragraphs?: Array<{ title?: string; duration_seconds?: number }> }>) {
          for (const p of row.paragraphs ?? []) {
            const dur = Number(p.duration_seconds);
            if (!Number.isFinite(dur) || dur <= 0) continue;
            segments.push({
              index: idx++,
              title: p.title ?? `Part ${idx}`,
              startSec: offset,
              endSec: offset + dur,
            });
            offset += dur;
          }
        }
      }
    }

    const model = buildRetentionModel(segments, points);
    const { error } = await supabaseAdmin.from("retention_curves").insert({
      user_id: userId,
      publish_job_id: job.id,
      youtube_video_id: data.youtubeVideoId,
      platform: "youtube",
      segments: JSON.parse(JSON.stringify(segments)),
      points: JSON.parse(JSON.stringify(points)),
      overall_avg: model.overallAvg,
      strongest_segment: model.strongest?.segment?.title ?? null,
      weakest_segment: model.weakest?.segment?.title ?? null,
      captured_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true as const, skipped: false as const };
  });

/** Latest stored retention curve for one video. Honest no-data when empty. */
export const getRetentionCurve = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator(jobIdSchema)
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const job = await requireOwnedJob(supabaseAdmin, userId, data.youtubeVideoId);
    const { data: row, error } = await supabaseAdmin
      .from("retention_curves")
      .select("segments, points, captured_at")
      .eq("user_id", userId)
      .eq("publish_job_id", job.id)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return { hasData: false as const, model: null, points: [] as RetentionPoint[], capturedAt: null as string | null };
    const segments = (row.segments ?? []) as unknown as RetentionSegment[];
    const points = (row.points ?? []) as unknown as RetentionPoint[];
    return {
      hasData: true as const,
      model: buildRetentionModel(segments, points),
      points,
      capturedAt: row.captured_at as string,
    };
  });

const nextSchema = z.object({
  youtubeVideoId: z.string().min(1).max(64),
  count: z.number().int().min(1).max(10).default(5),
});

/** Deterministic "what to make next" recommendations from existing video_ideas. */
export const getNextVideoRecommendations = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator(nextSchema)
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const job = await requireOwnedJob(supabaseAdmin, userId, data.youtubeVideoId);

    const { data: ideaRows, error } = await supabaseAdmin
      .from("video_ideas")
      .select("id, title, hook, angle, format, difficulty, safety_flag, status")
      .eq("user_id", userId)
      .eq("project_id", job.project_id);
    if (error) throw new Error(error.message);

    const candidates: CandidateIdea[] = (ideaRows ?? []).map((r) => ({
      id: r.id,
      title: r.title ?? "",
      hook: r.hook ?? "",
      angle: r.angle ?? "",
      format: (r.format === "short" ? "short" : "long") as CandidateIdea["format"],
      difficulty: (["easy", "medium", "hard"] as const).includes(r.difficulty as "easy")
        ? (r.difficulty as CandidateIdea["difficulty"])
        : "medium",
      safetyFlag: (["safe", "caution", "risky"] as const).includes(r.safety_flag as "safe")
        ? (r.safety_flag as CandidateIdea["safetyFlag"])
        : "caution",
      status: (["new", "saved", "dismissed", "used"] as const).includes(r.status as "new")
        ? (r.status as CandidateIdea["status"])
        : "new",
    }));

    return recommendNextVideos(
      { title: job.title ?? "", topic: "", views: 0 },
      candidates,
      data.count,
    );
  });

export const npsSchema = z.object({
  score: z.number().int().min(0).max(10),
  comment: z.string().max(2000).optional(),
});

/** Store one NPS response. A user may answer again, but prompts are throttled. */
export const submitNps = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator(npsSchema)
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const score = validateNpsScore(data.score);
    const category: NpsCategory = npsCategory(score);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("nps_responses").insert({
      user_id: userId,
      score,
      category,
      comment: data.comment?.trim() ? data.comment.trim() : null,
      context: "in_app",
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** True only when the user has a completed render and no NPS response in 90 days. */
export const shouldPromptNps = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator(z.object({}))
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: render } = await supabaseAdmin
      .from("renders")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "completed")
      .limit(1)
      .maybeSingle();
    if (!render) return { prompt: false as const };

    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await supabaseAdmin
      .from("nps_responses")
      .select("id")
      .eq("user_id", userId)
      .gte("created_at", cutoff)
      .limit(1)
      .maybeSingle();
    return { prompt: !recent };
  });
