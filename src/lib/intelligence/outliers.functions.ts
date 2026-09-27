/**
 * Stream C — Outlier Explorer (F4).
 *
 * Snapshot-based outlier detection over the Phase 1 intelligence tables
 * (`videos` + `video_snapshots`). Pure math lives in exported helpers so it
 * is unit-testable with fixed fixtures; the server functions below are thin
 * DB wrappers that honor the Phase 2 envelope convention.
 *
 * Honesty rules enforced here:
 * - No invented metrics: anything unknown is `null`, never 0.
 * - No virality/CTR/revenue predictions — scores are descriptive multiples
 *   of observed channel medians.
 * - The generated Supabase `Database` type predates the Phase 1 intelligence
 *   tables, so queries go through an untyped accessor and are mapped into
 *   local row interfaces below.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "../server-auth";
import type { Json } from "@/integrations/supabase/types";
import {
  confidenceFor,
  type Confidence,
  type OutlierScore,
  type ScoreFactor,
} from "./types";

/* ------------------------------------------------------------------ */
/* Local row shapes (intelligence tables are absent from the generated  */
/* Supabase Database type, so these are validated by shape at runtime) */
/* ------------------------------------------------------------------ */

export interface VideoRow {
  id: string;
  channel_id: string | null;
  external_video_id: string;
  title: string | null;
  thumbnail_url: string | null;
  published_at: string | null;
  duration_seconds: number | string | null;
  metrics: Json | null;
  channels: {
    id: string;
    title: string | null;
    platform: string | null;
    external_channel_id: string | null;
    tracked: boolean | null;
  } | null;
}

export interface VideoSnapshotRow {
  video_id: string;
  captured_at: string;
  view_count: number | null;
  like_count: number | null;
  comment_count: number | null;
}

export interface ChannelRow {
  id: string;
  platform: string | null;
  external_channel_id: string;
  handle: string | null;
  title: string | null;
}

export interface ChannelSnapshotRow {
  channel_id: string;
  captured_at: string;
  subscriber_count: number | null;
  video_count: number | null;
  view_count: number | null;
}

export interface CompetitorChannelRow {
  platform: string | null;
  external_channel_id: string | null;
  niche_id: string | null;
}

/** Untyped accessor for tables missing from the generated Database type. */
export function intelDb(admin: unknown): { from(table: string): any } {
  return admin as { from(table: string): any };
}

/* ------------------------------------------------------------------ */
/* Pure helpers (deterministic, unit-tested)                           */
/* ------------------------------------------------------------------ */

export interface SnapshotPoint {
  capturedAt: string;
  viewCount: number | null;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    const v = sorted[mid];
    return v === undefined ? null : v;
  }
  const lo = sorted[mid - 1];
  const hi = sorted[mid];
  return lo === undefined || hi === undefined ? null : (lo + hi) / 2;
}

/**
 * Views/day between the first and latest snapshot.
 * Null when fewer than 2 snapshots, when either endpoint lacks a view
 * count, or when the snapshots share a timestamp (no elapsed time).
 */
export function computeVelocityPerDay(snapshots: SnapshotPoint[]): number | null {
  if (snapshots.length < 2) return null;
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  if (!first || !last || first.viewCount == null || last.viewCount == null) return null;
  const elapsedDays =
    (new Date(last.capturedAt).getTime() - new Date(first.capturedAt).getTime()) / 86_400_000;
  if (!Number.isFinite(elapsedDays) || elapsedDays <= 0) return null;
  return Math.round(((last.viewCount - first.viewCount) / elapsedDays) * 10) / 10;
}

/**
 * 7-day subscriber growth in percent: latest snapshot vs the latest
 * snapshot captured at least 7 days earlier. Null when not computable —
 * never 0 (0 would falsely claim "no growth").
 */
export function growth7dPct(
  snapshots: { capturedAt: string; subscriberCount: number | null }[],
): number | null {
  if (snapshots.length < 2) return null;
  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime(),
  );
  const latest = sorted[sorted.length - 1];
  if (!latest || latest.subscriberCount == null) return null;
  const cutoff = new Date(latest.capturedAt).getTime() - 7 * 86_400_000;
  const baseline = [...sorted]
    .reverse()
    .find((s) => new Date(s.capturedAt).getTime() <= cutoff && s.subscriberCount != null);
  if (!baseline || baseline.subscriberCount == null || baseline.subscriberCount === 0) return null;
  return (
    Math.round(((latest.subscriberCount - baseline.subscriberCount) / baseline.subscriberCount) * 1000) /
    10
  );
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function formatCompact(v: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v);
}

export function formatAge(ageDays: number): string {
  if (ageDays < 1) return "less than a day";
  if (ageDays < 2) return "1 day";
  return `${Math.round(ageDays)} days`;
}

/**
 * Contract rule: any factor with evidenceCount === 0 renders with a
 * "weak evidence" badge AND drags confidence down one level.
 */
export function applyWeakEvidencePenalty(
  confidence: Confidence,
  factors: ScoreFactor[],
): Confidence {
  if (!factors.some((f) => f.evidenceCount === 0)) return confidence;
  if (confidence === "high") return "medium";
  if (confidence === "medium") return "low";
  return "low";
}

export interface OutlierInputs {
  /** Latest observed view count for the video. */
  latestViews: number;
  /** Latest view counts of SIBLING videos (same channel, excluding self). */
  siblingLatestViews: number[];
  /** This video's snapshots, ascending by captured_at. */
  snapshots: SnapshotPoint[];
  /** Injectable clock for deterministic tests. */
  now?: Date;
}

/**
 * OutlierScore = latest views / channel median views.
 * Returns null when the median is not computable (no siblings, or a
 * non-positive median) — the caller must exclude such videos rather than
 * invent a score.
 */
export function computeOutlierScore(input: OutlierInputs): OutlierScore | null {
  const med = median(input.siblingLatestViews);
  if (med == null || med <= 0) return null;
  const score = input.latestViews / med;
  const velocityPerDay = computeVelocityPerDay(input.snapshots);
  const snapshotsUsed = input.snapshots.length;
  const nowMs = (input.now ?? new Date()).getTime();
  const lastPoint = input.snapshots[input.snapshots.length - 1];
  const ageDays = lastPoint
    ? Math.max(0, (nowMs - new Date(lastPoint.capturedAt).getTime()) / 86_400_000)
    : Number.POSITIVE_INFINITY;

  const siblingCount = input.siblingLatestViews.length;
  const velocityDetail =
    velocityPerDay == null
      ? "Needs at least 2 snapshots with view counts to measure velocity"
      : `${formatCompact(velocityPerDay)} views/day from first to latest snapshot ` +
        `(${snapshotsUsed} snapshot${snapshotsUsed === 1 ? "" : "s"})`;

  const factors: ScoreFactor[] = [
    {
      key: "outperformance",
      label: "Outperformance vs channel median",
      weight: 0.5,
      value: clamp(Math.round(((score - 1) / 9) * 100), 0, 100),
      detail:
        `${score.toFixed(1)}× the channel median of ${formatCompact(med)} views ` +
        `across ${siblingCount} sibling video${siblingCount === 1 ? "" : "s"}`,
      evidenceCount: siblingCount,
    },
    {
      key: "velocity",
      label: "View velocity",
      weight: 0.3,
      value:
        velocityPerDay == null
          ? 0
          : clamp(Math.round((Math.log10(1 + velocityPerDay) / 4) * 100), 0, 100),
      detail: velocityDetail,
      evidenceCount: velocityPerDay == null ? 0 : snapshotsUsed,
    },
    {
      key: "recency",
      label: "Data recency",
      weight: 0.2,
      value: Number.isFinite(ageDays) ? Math.max(0, Math.round(100 - ageDays * 10)) : 0,
      detail: Number.isFinite(ageDays)
        ? `Latest snapshot ${formatAge(ageDays)} ago`
        : "No snapshot timestamp available",
      evidenceCount: Number.isFinite(ageDays) ? 1 : 0,
    },
  ];

  const confidence = applyWeakEvidencePenalty(
    confidenceFor(siblingCount, snapshotsUsed),
    factors,
  );
  return {
    score: Math.round(score * 100) / 100,
    velocityPerDay,
    factors,
    confidence,
    snapshotsUsed,
  };
}

/* ------------------------------------------------------------------ */
/* Envelope helpers                                                    */
/* ------------------------------------------------------------------ */

const DEFAULT_MIN_SCORE = 2;

/**
 * No data to compute from. When the YouTube API key is absent there is no
 * way to ingest data, so report `unconfigured` (with the founder action);
 * otherwise report honest `insufficient_data`.
 */
function noDataStatus(reason: string):
  | { status: "unconfigured"; reason: string }
  | { status: "insufficient_data"; reason: string } {
  if (!process.env["YOUTUBE_API_KEY"]) {
    return {
      status: "unconfigured",
      reason:
        "YouTube Data API is not connected. Connect it to start tracking channels and capturing snapshots.",
    };
  }
  return { status: "insufficient_data", reason };
}

/* ------------------------------------------------------------------ */
/* listOutliers                                                        */
/* ------------------------------------------------------------------ */

const listOutliersSchema = z.object({
  nicheId: z.string().uuid().optional(),
  minScore: z.number().min(1).max(1000).optional(),
  sort: z.enum(["score", "velocity", "recent"]).optional(),
});

export const listOutliers = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => listOutliersSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = intelDb(supabaseAdmin);
    const minScore = data.minScore ?? DEFAULT_MIN_SCORE;
    const sort = data.sort ?? "score";

    const { data: videoRows, error: videoError } = await db
      .from("videos")
      .select(
        "id, channel_id, external_video_id, title, thumbnail_url, published_at, duration_seconds, " +
          "channels(id, title, platform, external_channel_id, tracked)",
      )
      .eq("user_id", userId);
    if (videoError) throw new Error(videoError.message);
    const videos = (videoRows ?? []) as VideoRow[];
    if (videos.length === 0) {
      return noDataStatus(
        "No videos tracked yet. Track a channel from Intelligence → Channels to start building outlier data.",
      );
    }

    // Optional niche filter: videos whose channel is linked to the niche via
    // the competitor_channels watchlist (the only channel↔niche linkage).
    let eligible = videos.filter((v) => v.channels?.tracked !== false);
    if (data.nicheId) {
      const { data: ccRows } = await db
        .from("competitor_channels")
        .select("platform, external_channel_id, niche_id")
        .eq("user_id", userId)
        .eq("niche_id", data.nicheId);
      const inNiche = new Set(
        ((ccRows ?? []) as CompetitorChannelRow[])
          .filter((r) => r.platform && r.external_channel_id)
          .map((r) => `${r.platform}:${r.external_channel_id}`),
      );
      eligible = eligible.filter((v) => {
        const ch = v.channels;
        return ch?.platform && ch.external_channel_id && inNiche.has(`${ch.platform}:${ch.external_channel_id}`);
      });
    }
    if (eligible.length === 0) {
      return { status: "ok" as const, outliers: [] as OutlierEntry[] };
    }

    const videoIds = eligible.map((v) => v.id);
    const { data: snapRows, error: snapError } = await db
      .from("video_snapshots")
      .select("video_id, captured_at, view_count")
      .eq("user_id", userId)
      .in("video_id", videoIds)
      .order("captured_at", { ascending: true });
    if (snapError) throw new Error(snapError.message);
    const byVideo = new Map<string, SnapshotPoint[]>();
    for (const s of ((snapRows ?? []) as VideoSnapshotRow[])) {
      const list = byVideo.get(s.video_id) ?? [];
      list.push({ capturedAt: s.captured_at, viewCount: s.view_count });
      byVideo.set(s.video_id, list);
    }

    const withSnapshots = eligible.filter((v) => (byVideo.get(v.id) ?? []).length > 0);
    if (withSnapshots.length === 0) {
      return noDataStatus(
        "Videos are tracked but no metric snapshots have been captured yet. Snapshots are recorded by the ingestion pipeline once channels are tracked.",
      );
    }

    // Latest view count per video (for the channel-median denominator).
    const latestViews = new Map<string, number>();
    for (const v of withSnapshots) {
      const snaps = byVideo.get(v.id) ?? [];
      const last = snaps[snaps.length - 1];
      if (last?.viewCount != null) latestViews.set(v.id, last.viewCount);
    }

    const outliers: OutlierEntry[] = [];
    for (const v of withSnapshots) {
      const views = latestViews.get(v.id);
      if (views == null) continue;
      const siblings = withSnapshots.filter(
        (o) => o.id !== v.id && o.channel_id != null && o.channel_id === v.channel_id,
      );
      const siblingViews = siblings
        .map((s) => latestViews.get(s.id))
        .filter((n): n is number => n != null);
      const outlier = computeOutlierScore({
        latestViews: views,
        siblingLatestViews: siblingViews,
        snapshots: byVideo.get(v.id) ?? [],
      });
      if (!outlier || outlier.score < minScore) continue;
      const duration =
        v.duration_seconds == null ? null : Number(v.duration_seconds);
      const durationSeconds =
        duration != null && Number.isFinite(duration) ? duration : null;
      outliers.push({
        id: v.id,
        externalVideoId: v.external_video_id,
        title: v.title ?? "(untitled)",
        thumbnailUrl: v.thumbnail_url,
        publishedAt: v.published_at,
        durationSeconds,
        viewCount: views,
        outlierScore: outlier.score,
        channelTitle: v.channels?.title ?? null,
        outlier,
      });
    }

    outliers.sort((a, b) => {
      if (sort === "velocity") {
        return (b.outlier.velocityPerDay ?? -1) - (a.outlier.velocityPerDay ?? -1);
      }
      if (sort === "recent") {
        const at = (id: string): number => {
          const snaps = byVideo.get(id) ?? [];
          const last = snaps[snaps.length - 1];
          return last ? new Date(last.capturedAt).getTime() : 0;
        };
        return at(b.id) - at(a.id);
      }
      return b.outlier.score - a.outlier.score;
    });

    return { status: "ok" as const, outliers };
  });

/** VideoCard & { outlier: OutlierScore } — matches the pinned contract. */
export interface OutlierEntry {
  id: string;
  externalVideoId: string;
  title: string;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  durationSeconds: number | null;
  viewCount: number | null;
  outlierScore: number | null;
  channelTitle: string | null;
  outlier: OutlierScore;
}

/* ------------------------------------------------------------------ */
/* getSimilarChannels                                                  */
/*                                                                     */
/* ESTIMATE-based heuristic (labeled as such in the UI): same niche     */
/* via the competitor_channels watchlist + subscriber count within one  */
/* order of magnitude (0.1×–10×). Not a measurement of similarity.      */
/* ------------------------------------------------------------------ */

const similarChannelsSchema = z.object({
  channelId: z.string().uuid(),
  max: z.number().int().min(1).max(50).optional(),
});

export const getSimilarChannels = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => similarChannelsSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = intelDb(supabaseAdmin);
    const max = data.max ?? 8;

    const { data: channelRow, error: channelError } = await db
      .from("channels")
      .select("id, platform, external_channel_id, handle, title")
      .eq("user_id", userId)
      .eq("id", data.channelId)
      .maybeSingle();
    if (channelError) throw new Error(channelError.message);
    const channel = channelRow as ChannelRow | null;
    if (!channel) {
      return { status: "insufficient_data" as const, reason: "Channel not found." };
    }

    const { data: nicheRow } = await db
      .from("competitor_channels")
      .select("niche_id")
      .eq("user_id", userId)
      .eq("platform", channel.platform)
      .eq("external_channel_id", channel.external_channel_id)
      .maybeSingle();
    const nicheId = (nicheRow as { niche_id: string | null } | null)?.niche_id ?? null;
    if (!nicheId) {
      return {
        status: "insufficient_data" as const,
        reason:
          "This channel isn't assigned to a niche yet, so similar channels can't be estimated. Add it to a niche watchlist first.",
      };
    }

    // Candidate channels: same user, same platform, tracked, linked to the
    // same niche via the watchlist.
    const { data: allChannels } = await db
      .from("channels")
      .select("id, platform, external_channel_id, handle, title, tracked")
      .eq("user_id", userId)
      .eq("platform", channel.platform)
      .neq("id", channel.id);
    const { data: ccRows } = await db
      .from("competitor_channels")
      .select("platform, external_channel_id, niche_id")
      .eq("user_id", userId)
      .eq("niche_id", nicheId);
    const nicheKeys = new Set(
      ((ccRows ?? []) as CompetitorChannelRow[]).map(
        (r) => `${r.platform}:${r.external_channel_id}`,
      ),
    );
    const candidates = ((allChannels ?? []) as (ChannelRow & { tracked?: boolean | null })[]).filter(
      (c) =>
        c.tracked !== false && nicheKeys.has(`${c.platform}:${c.external_channel_id}`),
    );

    // One batched snapshot read for the reference channel + all candidates.
    const { data: allSnaps } = await db
      .from("channel_snapshots")
      .select("channel_id, captured_at, subscriber_count, video_count, view_count")
      .eq("user_id", userId)
      .in("channel_id", [channel.id, ...candidates.map((c) => c.id)])
      .order("captured_at", { ascending: true });
    const snapsByChannel = new Map<string, ChannelSnapshotRow[]>();
    for (const s of ((allSnaps ?? []) as ChannelSnapshotRow[])) {
      const list = snapsByChannel.get(s.channel_id) ?? [];
      list.push(s);
      snapsByChannel.set(s.channel_id, list);
    }
    const latestOf = (channelId: string): ChannelSnapshotRow | null => {
      const list = snapsByChannel.get(channelId) ?? [];
      return list[list.length - 1] ?? null;
    };

    const refSnap = latestOf(channel.id);
    const refSubs = refSnap?.subscriber_count ?? null;
    if (refSubs == null || refSubs <= 0) {
      return noDataStatus(
        "No subscriber snapshot for this channel yet, so the subscriber band can't be estimated.",
      );
    }

    const cards: SimilarChannelCard[] = [];
    for (const c of candidates) {
      const snap = latestOf(c.id);
      const subs = snap?.subscriber_count ?? null;
      if (subs == null || subs <= 0) continue; // can't verify the band — exclude, don't invent
      if (subs < refSubs / 10 || subs > refSubs * 10) continue;

      const hist = (snapsByChannel.get(c.id) ?? []).map((s) => ({
        capturedAt: s.captured_at,
        subscriberCount: s.subscriber_count,
      }));

      cards.push({
        id: c.id,
        externalChannelId: c.external_channel_id,
        handle: c.handle,
        title: c.title,
        subscriberCount: subs,
        videoCount: snap?.video_count ?? null,
        viewCount: snap?.view_count ?? null,
        growth7dPct: growth7dPct(hist),
        lastSnapshotAt: snap?.captured_at ?? null,
        freshness: { capturedAt: snap?.captured_at ?? null, staleAfterHours: 24 },
        // Distance used only for ordering the estimates.
        _logDistance: Math.abs(Math.log10(subs / refSubs)),
      });
    }

    cards.sort((a, b) => (a._logDistance ?? 0) - (b._logDistance ?? 0));
    const trimmed = cards.slice(0, max).map(({ _logDistance: _omit, ...rest }) => rest);
    return { status: "ok" as const, channels: trimmed };
  });

/** ChannelCard per the pinned contract (internal sort key stripped). */
export interface SimilarChannelCard {
  id: string;
  externalChannelId: string;
  handle: string | null;
  title: string | null;
  subscriberCount: number | null;
  videoCount: number | null;
  viewCount: number | null;
  growth7dPct: number | null;
  lastSnapshotAt: string | null;
  freshness: { capturedAt: string | null; staleAfterHours: number };
  _logDistance?: number;
}
