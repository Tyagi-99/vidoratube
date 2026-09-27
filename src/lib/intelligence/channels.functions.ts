/**
 * Stream A — channel ingestion server functions (Phase 2 contract).
 *
 * trackChannel / untrackChannel / listChannels / getChannelDetail /
 * refreshChannel / searchChannels. Every function uses `requireAppUser` and
 * returns the contract envelope:
 *   { status: "ok", ... } | { status: "unconfigured", reason } |
 *   { status: "insufficient_data", reason }
 * API failures (quota, invalid key, network) propagate as thrown Errors.
 *
 * Server-only modules are dynamically imported inside handlers so this file
 * stays client-bundle safe (same pattern as analytics.functions.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "../server-auth";
import type { Freshness } from "./types";
import type {
  ChannelRow,
  ChannelSnapshotRow,
  VideoRow,
  VideoSnapshotRow,
} from "./snapshots.server";
import type { AdminDb, DbQuery } from "./youtube-api.server";
import { toVideoCard, type VideoCard } from "./videos.functions";

/* ------------------------------------------------------------------ */
/* Contract shapes                                                     */
/* ------------------------------------------------------------------ */

export interface ChannelCard {
  id: string;
  externalChannelId: string;
  handle: string | null;
  title: string | null;
  subscriberCount: number | null;
  viewCount: number | null;
  videoCount: number | null;
  growth7dPct: number | null;
  lastSnapshotAt: string | null;
  freshness: Freshness;
}

export interface ChannelDetail {
  channel: ChannelRow;
  snapshots: ChannelSnapshotRow[];
  videos: VideoCard[];
  freshness: Freshness;
}

type Unconfigured = { status: "unconfigured"; reason: string };
type InsufficientData = { status: "insufficient_data"; reason: string };

/** Alias re-exported for route components (row type lives in snapshots.server). */
export type ChannelSnapshot = ChannelSnapshotRow;

/* ------------------------------------------------------------------ */
/* Input schemas                                                       */
/* ------------------------------------------------------------------ */

const uuidSchema = z.string().uuid();

const trackChannelSchema = z.object({
  externalChannelId: z.string().min(1).max(64),
  nicheId: uuidSchema.optional(),
});

const untrackChannelSchema = z.object({ channelId: uuidSchema });

const listChannelsSchema = z.object({
  nicheId: uuidSchema.optional(),
  sort: z.enum(["subscribers", "growth", "recent"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

const getChannelDetailSchema = z.object({ channelId: uuidSchema });
const refreshChannelSchema = z.object({ channelId: uuidSchema });

const searchChannelsSchema = z.object({
  query: z.string().min(1).max(200),
  maxResults: z.number().int().min(1).max(25).optional(),
});

/* ------------------------------------------------------------------ */
/* Internal helpers (pure w.r.t. server modules)                       */
/* ------------------------------------------------------------------ */

const CHANNEL_COLUMNS =
  "id, user_id, workspace_id, platform, external_channel_id, handle, title, is_own, tracked, niche_id, created_at, updated_at";
const CHANNEL_SNAPSHOT_COLUMNS =
  "id, user_id, channel_id, captured_at, subscriber_count, video_count, view_count, metrics";

async function loadLatestSnapshots(
  db: AdminDb,
  dbList: <T>(q: DbQuery) => Promise<T[]>,
  channelId: string,
  limit = 60,
): Promise<ChannelSnapshotRow[]> {
  return dbList<ChannelSnapshotRow>(
    db
      .from("channel_snapshots")
      .select(CHANNEL_SNAPSHOT_COLUMNS)
      .eq("channel_id", channelId)
      .order("captured_at", { ascending: false })
      .limit(limit),
  );
}

async function toChannelCard(
  db: AdminDb,
  dbList: <T>(q: DbQuery) => Promise<T[]>,
  computeGrowth: (s: { captured_at: string; subscriber_count: number | null }[]) => number | null,
  channel: ChannelRow,
): Promise<ChannelCard> {
  const snaps = await loadLatestSnapshots(db, dbList, channel.id);
  const latest = snaps[0] ?? null;
  const lastSnapshotAt = latest?.captured_at ?? null;
  return {
    id: channel.id,
    externalChannelId: channel.external_channel_id,
    handle: channel.handle,
    title: channel.title,
    subscriberCount: latest?.subscriber_count ?? null,
    videoCount: latest?.video_count ?? null,
    viewCount: latest?.view_count ?? null,
    growth7dPct: computeGrowth(snaps),
    lastSnapshotAt,
    freshness: { capturedAt: lastSnapshotAt, staleAfterHours: 24 },
  };
}

function sortCards(
  cards: ChannelCard[],
  sort: "subscribers" | "growth" | "recent",
  order: "asc" | "desc",
): ChannelCard[] {
  const dir = order === "asc" ? 1 : -1;
  return [...cards].sort((a, b) => {
    let ka: number | string | null;
    let kb: number | string | null;
    if (sort === "subscribers") {
      ka = a.subscriberCount;
      kb = b.subscriberCount;
    } else if (sort === "growth") {
      ka = a.growth7dPct;
      kb = b.growth7dPct;
    } else {
      ka = a.lastSnapshotAt;
      kb = b.lastSnapshotAt;
    }
    if (ka === null && kb === null) return 0;
    if (ka === null) return 1; // nulls last in both orders
    if (kb === null) return -1;
    if (typeof ka === "number" && typeof kb === "number") return (ka - kb) * dir;
    return String(ka).localeCompare(String(kb)) * dir;
  });
}

/* ------------------------------------------------------------------ */
/* trackChannel                                                        */
/* ------------------------------------------------------------------ */

/**
 * Track a YouTube channel: fetches it via channels.list, upserts the
 * registry row, and writes a baseline snapshot so growth math has a start.
 */
export const trackChannel = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => trackChannelSchema.parse(i))
  .handler(
    async ({ data, context }): Promise<{ status: "ok"; channel: ChannelRow } | Unconfigured> => {
      const { userId } = context;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { adminDb, dbOne, fetchChannels } = await import("./youtube-api.server");
      const { writeChannelSnapshot } = await import("./snapshots.server");

      const res = await fetchChannels(supabaseAdmin, userId, [data.externalChannelId]);
      if (res.status === "unconfigured") {
        return { status: "unconfigured", reason: res.reason };
      }
      const info = res.data.find((c) => c.externalId === data.externalChannelId);
      if (!info) {
        throw new Error(
          `YouTube channel "${data.externalChannelId}" was not found. Check the channel ID and retry.`,
        );
      }

      const db = adminDb(supabaseAdmin);
      let nicheId: string | null = null;
      if (data.nicheId !== undefined) {
        const niche = await dbOne<{ id: string }>(
          db.from("niches").select("id").eq("id", data.nicheId).eq("user_id", userId).maybeSingle(),
        );
        if (!niche) throw new Error("Niche not found.");
        nicheId = data.nicheId;
      }

      const payload: Record<string, unknown> = {
        user_id: userId,
        platform: "youtube",
        external_channel_id: data.externalChannelId,
        handle: info.handle,
        title: info.title,
        tracked: true,
        updated_at: new Date().toISOString(),
      };
      if (data.nicheId !== undefined) payload["niche_id"] = nicheId;

      const row = await dbOne<ChannelRow>(
        db
          .from("channels")
          .upsert(payload, { onConflict: "user_id,platform,external_channel_id" })
          .select(CHANNEL_COLUMNS)
          .single(),
      );
      if (!row) throw new Error("Failed to track channel.");

      // Baseline snapshot so growth math has a starting point.
      await writeChannelSnapshot(supabaseAdmin, userId, row.id, {
        subscriberCount: info.subscriberCount,
        videoCount: info.videoCount,
        viewCount: info.viewCount,
        metrics: { source: "youtube-data-api", fetchedAt: info.fetchedAt },
      });

      return { status: "ok", channel: row };
    },
  );

/* ------------------------------------------------------------------ */
/* untrackChannel                                                      */
/* ------------------------------------------------------------------ */

/** Stop tracking a channel (soft: tracked=false, snapshots kept). */
export const untrackChannel = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => untrackChannelSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ status: "ok" }> => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { adminDb, dbOne } = await import("./youtube-api.server");

    const db = adminDb(supabaseAdmin);
    const row = await dbOne<{ id: string }>(
      db
        .from("channels")
        .update({ tracked: false, updated_at: new Date().toISOString() })
        .eq("id", data.channelId)
        .eq("user_id", userId)
        .select("id")
        .maybeSingle(),
    );
    if (!row) throw new Error("Channel not found.");
    return { status: "ok" };
  });

/* ------------------------------------------------------------------ */
/* listChannels                                                        */
/* ------------------------------------------------------------------ */

export const listChannels = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => listChannelsSchema.parse(i))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ status: "ok"; channels: ChannelCard[] } | Unconfigured | InsufficientData> => {
      const { userId } = context;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { adminDb, dbList } = await import("./youtube-api.server");
      const { computeSubscriberGrowthPct } = await import("./snapshots.server");

      const db = adminDb(supabaseAdmin);
      let query = db
        .from("channels")
        .select(CHANNEL_COLUMNS)
        .eq("user_id", userId)
        .eq("platform", "youtube")
        .eq("tracked", true);
      if (data.nicheId !== undefined) query = query.eq("niche_id", data.nicheId);

      const rows = await dbList<ChannelRow>(
        query.order("created_at", { ascending: false }).limit(500),
      );
      const cards: ChannelCard[] = [];
      for (const row of rows) {
        cards.push(await toChannelCard(db, dbList, computeSubscriberGrowthPct, row));
      }
      const sorted = sortCards(cards, data.sort ?? "recent", data.order ?? "desc");
      return { status: "ok", channels: sorted };
    },
  );

/* ------------------------------------------------------------------ */
/* getChannelDetail                                                    */
/* ------------------------------------------------------------------ */

export const getChannelDetail = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => getChannelDetailSchema.parse(i))
  .handler(
    async ({
      data,
      context,
    }): Promise<({ status: "ok" } & ChannelDetail) | Unconfigured | InsufficientData> => {
      const { userId } = context;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { adminDb, dbList, dbOne } = await import("./youtube-api.server");

      const db = adminDb(supabaseAdmin);
      const channel = await dbOne<ChannelRow>(
        db
          .from("channels")
          .select(CHANNEL_COLUMNS)
          .eq("id", data.channelId)
          .eq("user_id", userId)
          .maybeSingle(),
      );
      if (!channel) throw new Error("Channel not found.");

      const snapshots = await dbList<ChannelSnapshotRow>(
        db
          .from("channel_snapshots")
          .select(CHANNEL_SNAPSHOT_COLUMNS)
          .eq("channel_id", channel.id)
          .order("captured_at", { ascending: false })
          .limit(90),
      );

      const videoRows = await dbList<VideoRow>(
        db
          .from("videos")
          .select(
            "id, user_id, channel_id, platform, external_video_id, title, description, published_at, duration_seconds, thumbnail_url, is_own, metrics, created_at, updated_at",
          )
          .eq("user_id", userId)
          .eq("channel_id", channel.id)
          .order("published_at", { ascending: false, nullsFirst: false })
          .limit(100),
      );
      const videos: VideoCard[] = [];
      for (const video of videoRows) {
        const latestSnap = await dbOne<VideoSnapshotRow>(
          db
            .from("video_snapshots")
            .select(
              "id, user_id, video_id, captured_at, view_count, like_count, comment_count, metrics",
            )
            .eq("video_id", video.id)
            .order("captured_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        );
        videos.push(toVideoCard(video, latestSnap, channel.title));
      }

      const lastSnapshotAt = snapshots[0]?.captured_at ?? null;
      return {
        status: "ok",
        channel,
        snapshots,
        videos,
        freshness: { capturedAt: lastSnapshotAt, staleAfterHours: 24 },
      };
    },
  );

/* ------------------------------------------------------------------ */
/* refreshChannel — no-op when the API cache is still fresh             */
/* ------------------------------------------------------------------ */

export const refreshChannel = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => refreshChannelSchema.parse(i))
  .handler(
    async ({
      data,
      context,
    }): Promise<
      | { status: "ok"; channel: ChannelRow; snapshot: ChannelSnapshotRow | null }
      | Unconfigured
      | InsufficientData
    > => {
      const { userId } = context;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { adminDb, dbOne, fetchChannels } = await import("./youtube-api.server");
      const { writeChannelSnapshot } = await import("./snapshots.server");

      const db = adminDb(supabaseAdmin);
      const channel = await dbOne<ChannelRow>(
        db
          .from("channels")
          .select(CHANNEL_COLUMNS)
          .eq("id", data.channelId)
          .eq("user_id", userId)
          .maybeSingle(),
      );
      if (!channel) throw new Error("Channel not found.");

      // Cache-first: when the 24h channels cache is fresh this makes no live
      // call and writes no duplicate snapshot (no-op).
      const res = await fetchChannels(supabaseAdmin, userId, [channel.external_channel_id]);
      if (res.status === "unconfigured") {
        return { status: "unconfigured", reason: res.reason };
      }
      const info = res.data.find((c) => c.externalId === channel.external_channel_id);
      if (!info) {
        throw new Error(`YouTube channel "${channel.external_channel_id}" was not found.`);
      }

      if (res.cached) {
        const latest = await dbOne<ChannelSnapshotRow>(
          db
            .from("channel_snapshots")
            .select(CHANNEL_SNAPSHOT_COLUMNS)
            .eq("channel_id", channel.id)
            .order("captured_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        );
        return { status: "ok", channel, snapshot: latest };
      }

      await dbOne<{ id: string }>(
        db
          .from("channels")
          .update({
            handle: info.handle,
            title: info.title,
            updated_at: new Date().toISOString(),
          })
          .eq("id", channel.id)
          .eq("user_id", userId)
          .select("id")
          .maybeSingle(),
      );
      const snapshot = await writeChannelSnapshot(supabaseAdmin, userId, channel.id, {
        subscriberCount: info.subscriberCount,
        videoCount: info.videoCount,
        viewCount: info.viewCount,
        metrics: { source: "youtube-data-api", fetchedAt: info.fetchedAt },
      });
      const refreshed = await dbOne<ChannelRow>(
        db.from("channels").select(CHANNEL_COLUMNS).eq("id", channel.id).maybeSingle(),
      );
      return { status: "ok", channel: refreshed ?? channel, snapshot };
    },
  );

/* ------------------------------------------------------------------ */
/* searchChannels — discovery via search.list + channels.list          */
/* ------------------------------------------------------------------ */

/**
 * Discover channels via search.list (type=channel), then hydrate statistics
 * with a batched channels.list call (cache-first). Results are untracked:
 * `id` carries the YouTube channel id (no DB row exists yet); call
 * trackChannel to persist one. growth7dPct/lastSnapshotAt are null — never
 * invented for channels with no snapshots.
 */
export const searchChannels = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => searchChannelsSchema.parse(i))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ status: "ok"; channels: ChannelCard[] } | Unconfigured | InsufficientData> => {
      const { userId } = context;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { fetchChannels, searchChannelsByQuery } = await import("./youtube-api.server");

      const search = await searchChannelsByQuery(
        supabaseAdmin,
        userId,
        data.query,
        data.maxResults ?? 10,
      );
      if (search.status === "unconfigured") {
        return { status: "unconfigured", reason: search.reason };
      }
      const stats = await fetchChannels(
        supabaseAdmin,
        userId,
        search.data.map((h) => h.externalId),
      );
      const statsById = new Map(
        stats.status === "ok" ? stats.data.map((s) => [s.externalId, s]) : [],
      );

      const channels: ChannelCard[] = search.data.map((hit) => {
        const s = statsById.get(hit.externalId);
        return {
          id: hit.externalId,
          externalChannelId: hit.externalId,
          handle: s?.handle ?? null,
          title: s?.title ?? hit.title,
          subscriberCount: s?.subscriberCount ?? null,
          videoCount: s?.videoCount ?? null,
          viewCount: s?.viewCount ?? null,
          growth7dPct: null,
          lastSnapshotAt: null,
          freshness: { capturedAt: null, staleAfterHours: 24 },
        };
      });
      return { status: "ok", channels };
    },
  );
