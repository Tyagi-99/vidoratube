/**
 * Stream A — video ingestion server functions (Phase 2 contract).
 *
 * listVideos / getVideoDetail / refreshVideo / compareVideos /
 * draftIdeaFromVideo. Every function uses `requireAppUser` and returns the
 * contract envelope:
 *   { status: "ok", ... } | { status: "unconfigured", reason } |
 *   { status: "insufficient_data", reason }
 * API failures (quota, invalid key, network) propagate as thrown Errors.
 *
 * Outlier scoring is owned by Stream C: outlierScore/outlier are returned as
 * null here — never synthesized.
 *
 * Server-only modules are dynamically imported inside handlers so this file
 * stays client-bundle safe (same pattern as analytics.functions.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "../server-auth";
import type { Freshness } from "./types";
import type {
  ResearchProjectRow,
  VideoIdeaRow,
  VideoRow,
  VideoSnapshotRow,
} from "./snapshots.server";
import type { AdminDb, DbListResult } from "./youtube-api.server";
import type { Json } from "@/integrations/supabase/types";

/* ------------------------------------------------------------------ */
/* Contract shapes                                                     */
/* ------------------------------------------------------------------ */

export interface VideoCard {
  id: string;
  externalVideoId: string;
  title: string;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  durationSeconds: number | null;
  viewCount: number | null;
  /** Stream C owns outlier scoring; Stream A always returns null. */
  outlierScore: number | null;
  channelTitle: string | null;
}

export interface VideoDetail extends VideoCard {
  description: string;
  channelId: string | null;
  likeCount: number | null;
  commentCount: number | null;
  freshness: Freshness;
  /** Raw platform metrics payload (jsonb) — for analysis consumers. */
  metrics: Json;
}

/**
 * Pure card builder shared with channels.functions.ts (getChannelDetail).
 * Takes the already-fetched latest snapshot — no DB access inside.
 */
export function toVideoCard(
  video: VideoRow,
  latestSnapshot: VideoSnapshotRow | null,
  channelTitle: string | null,
): VideoCard {
  return {
    id: video.id,
    externalVideoId: video.external_video_id,
    title: video.title,
    thumbnailUrl: video.thumbnail_url,
    publishedAt: video.published_at,
    durationSeconds: video.duration_seconds,
    viewCount: latestSnapshot?.view_count ?? null,
    outlierScore: null,
    channelTitle,
  };
}

function toVideoDetail(
  video: VideoRow,
  latestSnapshot: VideoSnapshotRow | null,
  channelTitle: string | null,
): VideoDetail {
  const lastSnapshotAt = latestSnapshot?.captured_at ?? null;
  return {
    ...toVideoCard(video, latestSnapshot, channelTitle),
    description: video.description,
    channelId: video.channel_id,
    likeCount: latestSnapshot?.like_count ?? null,
    commentCount: latestSnapshot?.comment_count ?? null,
    freshness: { capturedAt: lastSnapshotAt, staleAfterHours: 6 },
    metrics: video.metrics,
  };
}

type Unconfigured = { status: "unconfigured"; reason: string };
type InsufficientData = { status: "insufficient_data"; reason: string };

/* ------------------------------------------------------------------ */
/* Input schemas                                                       */
/* ------------------------------------------------------------------ */

const uuidSchema = z.string().uuid();

const listVideosSchema = z.object({
  channelId: uuidSchema.optional(),
  sort: z.enum(["views", "outlier", "recent"]).optional(),
  max: z.number().int().min(1).max(200).optional(),
});

const getVideoDetailSchema = z.object({ videoId: uuidSchema });
const refreshVideoSchema = z.object({ videoId: uuidSchema });

/** Exactly 3 video ids — the F5 three-way compare. */
const compareVideosSchema = z.object({
  videoIds: z.tuple([uuidSchema, uuidSchema, uuidSchema]),
});

const draftIdeaFromVideoSchema = z.object({ videoId: uuidSchema });

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

const VIDEO_COLUMNS =
  "id, user_id, channel_id, platform, external_video_id, title, description, published_at, duration_seconds, thumbnail_url, is_own, metrics, created_at, updated_at";
const VIDEO_SNAPSHOT_COLUMNS =
  "id, user_id, video_id, captured_at, view_count, like_count, comment_count, metrics";

async function latestVideoSnapshot(db: AdminDb, videoId: string): Promise<VideoSnapshotRow | null> {
  const { dbOne } = await import("./youtube-api.server");
  return dbOne<VideoSnapshotRow>(
    db
      .from("video_snapshots")
      .select(VIDEO_SNAPSHOT_COLUMNS)
      .eq("video_id", videoId)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
}

/** Map channel ids → titles for a set of videos (one query). */
async function channelTitles(
  db: AdminDb,
  channelIds: (string | null)[],
): Promise<Map<string, string | null>> {
  const { dbList } = await import("./youtube-api.server");
  const ids = [...new Set(channelIds.filter((id): id is string => id !== null))];
  const map = new Map<string, string | null>();
  if (ids.length === 0) return map;
  const rows = await dbList<{ id: string; title: string | null }>(
    db.from("channels").select("id, title").in("id", ids),
  );
  for (const row of rows) map.set(row.id, row.title);
  return map;
}

/* ------------------------------------------------------------------ */
/* listVideos                                                          */
/* ------------------------------------------------------------------ */

export const listVideos = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => listVideosSchema.parse(i))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ status: "ok"; videos: VideoCard[] } | Unconfigured | InsufficientData> => {
      const { userId } = context;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { adminDb, dbList, dbOne } = await import("./youtube-api.server");

      const db = adminDb(supabaseAdmin);
      if (data.channelId !== undefined) {
        const channel = await dbOne<{ id: string }>(
          db
            .from("channels")
            .select("id")
            .eq("id", data.channelId)
            .eq("user_id", userId)
            .maybeSingle(),
        );
        if (!channel) throw new Error("Channel not found.");
      }

      let query = db
        .from("videos")
        .select(VIDEO_COLUMNS)
        .eq("user_id", userId)
        .eq("platform", "youtube");
      if (data.channelId !== undefined) query = query.eq("channel_id", data.channelId);

      const rows = await dbList<VideoRow>(
        query.order("published_at", { ascending: false, nullsFirst: false }).limit(data.max ?? 50),
      );
      const titles = await channelTitles(
        db,
        rows.map((r) => r.channel_id),
      );

      const videos: VideoCard[] = [];
      for (const row of rows) {
        const latest = await latestVideoSnapshot(db, row.id);
        videos.push(toVideoCard(row, latest, titles.get(row.channel_id ?? "") ?? null));
      }

      const sort = data.sort ?? "recent";
      if (sort === "views") {
        videos.sort((a, b) => {
          if (a.viewCount === null && b.viewCount === null) return 0;
          if (a.viewCount === null) return 1;
          if (b.viewCount === null) return -1;
          return b.viewCount - a.viewCount;
        });
      }
      // "outlier": Stream C owns scoring; all scores are null here, so the
      // published_at order from the query is preserved (stable, honest).
      return { status: "ok", videos };
    },
  );

/* ------------------------------------------------------------------ */
/* getVideoDetail                                                      */
/* ------------------------------------------------------------------ */

export const getVideoDetail = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => getVideoDetailSchema.parse(i))
  .handler(
    async ({
      data,
      context,
    }): Promise<
      | {
          status: "ok";
          video: VideoDetail;
          snapshots: VideoSnapshotRow[];
          outlier: null;
        }
      | Unconfigured
      | InsufficientData
    > => {
      const { userId } = context;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { adminDb, dbList, dbOne } = await import("./youtube-api.server");

      const db = adminDb(supabaseAdmin);
      const video = await dbOne<VideoRow>(
        db
          .from("videos")
          .select(VIDEO_COLUMNS)
          .eq("id", data.videoId)
          .eq("user_id", userId)
          .maybeSingle(),
      );
      if (!video) throw new Error("Video not found.");

      const snapshots = await dbList<VideoSnapshotRow>(
        db
          .from("video_snapshots")
          .select(VIDEO_SNAPSHOT_COLUMNS)
          .eq("video_id", video.id)
          .order("captured_at", { ascending: false })
          .limit(90),
      );
      const titles = await channelTitles(db, [video.channel_id]);
      return {
        status: "ok",
        video: toVideoDetail(
          video,
          snapshots[0] ?? null,
          titles.get(video.channel_id ?? "") ?? null,
        ),
        snapshots,
        // Outlier scoring is Stream C's; null is the honest value here.
        outlier: null,
      };
    },
  );

/* ------------------------------------------------------------------ */
/* refreshVideo — no-op when the API cache is still fresh               */
/* ------------------------------------------------------------------ */

export const refreshVideo = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => refreshVideoSchema.parse(i))
  .handler(
    async ({
      data,
      context,
    }): Promise<
      | { status: "ok"; video: VideoDetail; snapshot: VideoSnapshotRow | null }
      | Unconfigured
      | InsufficientData
    > => {
      const { userId } = context;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { adminDb, dbOne, fetchVideos } = await import("./youtube-api.server");
      const { writeVideoSnapshot } = await import("./snapshots.server");

      const db = adminDb(supabaseAdmin);
      const video = await dbOne<VideoRow>(
        db
          .from("videos")
          .select(VIDEO_COLUMNS)
          .eq("id", data.videoId)
          .eq("user_id", userId)
          .maybeSingle(),
      );
      if (!video) throw new Error("Video not found.");

      // Cache-first: when the 6h videos cache is fresh this makes no live
      // call and writes no duplicate snapshot (no-op).
      const res = await fetchVideos(supabaseAdmin, userId, [video.external_video_id]);
      if (res.status === "unconfigured") {
        return { status: "unconfigured", reason: res.reason };
      }
      const info = res.data.find((v) => v.externalId === video.external_video_id);
      if (!info) {
        throw new Error(`YouTube video "${video.external_video_id}" was not found.`);
      }

      const titles = await channelTitles(db, [video.channel_id]);
      const channelTitle = titles.get(video.channel_id ?? "") ?? null;

      if (res.cached) {
        const latest = await latestVideoSnapshot(db, video.id);
        return {
          status: "ok",
          video: toVideoDetail(video, latest, channelTitle),
          snapshot: latest,
        };
      }

      const updateResult = (await db
        .from("videos")
        .update({
          title: info.title,
          description: info.description,
          published_at: info.publishedAt,
          duration_seconds: info.durationSeconds,
          thumbnail_url: info.thumbnailUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", video.id)
        .eq("user_id", userId)) as DbListResult<unknown>;
      if (updateResult.error) throw new Error(updateResult.error.message);
      const snapshot = await writeVideoSnapshot(supabaseAdmin, userId, video.id, {
        viewCount: info.viewCount,
        likeCount: info.likeCount,
        commentCount: info.commentCount,
        metrics: { source: "youtube-data-api", fetchedAt: info.fetchedAt },
      });
      const refreshed =
        (await dbOne<VideoRow>(
          db.from("videos").select(VIDEO_COLUMNS).eq("id", video.id).maybeSingle(),
        )) ?? video;
      return {
        status: "ok",
        video: toVideoDetail(refreshed, snapshot, channelTitle),
        snapshot,
      };
    },
  );

/* ------------------------------------------------------------------ */
/* compareVideos — exactly 3                                           */
/* ------------------------------------------------------------------ */

export const compareVideos = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => compareVideosSchema.parse(i))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ status: "ok"; videos: VideoDetail[] } | Unconfigured | InsufficientData> => {
      const { userId } = context;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { adminDb, dbList } = await import("./youtube-api.server");

      const db = adminDb(supabaseAdmin);
      const rows = await dbList<VideoRow>(
        db
          .from("videos")
          .select(VIDEO_COLUMNS)
          .eq("user_id", userId)
          .in("id", [...data.videoIds]),
      );
      const byId = new Map(rows.map((r) => [r.id, r]));
      const ordered: VideoRow[] = [];
      for (const id of data.videoIds) {
        const row = byId.get(id);
        if (!row) throw new Error("One or more videos were not found.");
        ordered.push(row);
      }
      const titles = await channelTitles(
        db,
        ordered.map((r) => r.channel_id),
      );

      const videos: VideoDetail[] = [];
      for (const row of ordered) {
        const latest = await latestVideoSnapshot(db, row.id);
        videos.push(toVideoDetail(row, latest, titles.get(row.channel_id ?? "") ?? null));
      }
      return { status: "ok", videos };
    },
  );

/* ------------------------------------------------------------------ */
/* draftIdeaFromVideo — the F4 one-click handoff                        */
/* ------------------------------------------------------------------ */

const OUTLIER_DRAFTS_TOPIC = "Outlier drafts";

function ideaFormatFor(durationSeconds: number | null): "short" | "long" {
  // YouTube Shorts are ≤ 3 minutes; anything longer is long-form.
  return durationSeconds !== null && durationSeconds <= 180 ? "short" : "long";
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Find-or-create the "Outlier drafts" research project, then insert a
 * video_ideas row derived from the video (title/hook/angle are factual —
 * taken from the video itself, never invented performance claims).
 */
export const draftIdeaFromVideo = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => draftIdeaFromVideoSchema.parse(i))
  .handler(
    async ({
      data,
      context,
    }): Promise<
      { status: "ok"; ideaId: string; researchProjectId: string } | Unconfigured | InsufficientData
    > => {
      const { userId } = context;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { adminDb, dbOne } = await import("./youtube-api.server");

      const db = adminDb(supabaseAdmin);
      const video = await dbOne<VideoRow>(
        db
          .from("videos")
          .select(VIDEO_COLUMNS)
          .eq("id", data.videoId)
          .eq("user_id", userId)
          .maybeSingle(),
      );
      if (!video) throw new Error("Video not found.");
      const titles = await channelTitles(db, [video.channel_id]);
      const channelTitle = titles.get(video.channel_id ?? "") ?? null;

      let project = await dbOne<ResearchProjectRow>(
        db
          .from("research_projects")
          .select("id, user_id, topic, language, status, created_at, updated_at")
          .eq("user_id", userId)
          .eq("topic", OUTLIER_DRAFTS_TOPIC)
          .maybeSingle(),
      );
      if (!project) {
        project = await dbOne<ResearchProjectRow>(
          db
            .from("research_projects")
            .insert({
              user_id: userId,
              topic: OUTLIER_DRAFTS_TOPIC,
              language: "English",
              status: "active",
            })
            .select("id, user_id, topic, language, status, created_at, updated_at")
            .single(),
        );
        if (!project) throw new Error("Failed to create the Outlier drafts project.");
      }

      const viewCount = (await latestVideoSnapshot(db, video.id))?.view_count ?? null;
      const viewsLabel =
        viewCount === null
          ? "an untracked view count"
          : `${viewCount.toLocaleString("en-US")} views`;
      const idea = await dbOne<VideoIdeaRow>(
        db
          .from("video_ideas")
          .insert({
            user_id: userId,
            project_id: project.id,
            title: video.title,
            hook: video.description ? truncate(video.description, 140) : video.title,
            angle: truncate(
              `Repackage the angle of "${video.title}"${channelTitle ? ` by ${channelTitle}` : ""} (${viewsLabel}) for our audience.`,
              500,
            ),
            format: ideaFormatFor(video.duration_seconds),
          })
          .select(
            "id, user_id, project_id, title, hook, angle, format, difficulty, safety_flag, status, created_at, updated_at",
          )
          .single(),
      );
      if (!idea) throw new Error("Failed to draft the video idea.");

      return { status: "ok", ideaId: idea.id, researchProjectId: project.id };
    },
  );
