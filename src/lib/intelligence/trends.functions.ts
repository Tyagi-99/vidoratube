/**
 * Stream B — trend radar (F6).
 *
 * Phase 2: trends are derived from video_snapshots velocity across tracked
 * channels (optionally scoped to a niche). Every trend persists ≥1
 * research_sources row (source_type 'video') — citations are mandatory in
 * the output. No LLM, no live search calls (quota-free); the radar reads
 * the same tables Stream A writes.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "../server-auth";
import { confidenceFor, type Confidence, type ScoreFactor } from "./types";
import { getPort as getNichePort, type AdminDb } from "./niches.functions";

interface VideoRowLite {
  id: string;
  external_video_id: string;
  title: string | null;
  published_at: string | null;
  channels: { title?: string | null } | null;
}
interface VideoSnapshotLite {
  video_id: string;
  captured_at: string;
  view_count: number | string | null;
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface TrendSource {
  title: string;
  url: string;
  publishedAt: string | null;
}

export interface Trend {
  id: string;
  topic: string;
  score0to100: number;
  factors: ScoreFactor[];
  confidence: Confidence;
  sources: TrendSource[];
  capturedAt: string;
}

/** One video's velocity evidence, computed from its snapshots. */
export interface VideoVelocityInput {
  videoId: string;
  externalVideoId: string;
  title: string;
  publishedAt: string | null;
  channelTitle: string | null;
  /** Views/day between earliest and latest snapshot; null when <2 snapshots. */
  viewsPerDay: number | null;
  snapshotCount: number;
  latestCapturedAt: string | null;
}

export interface ResearchSourceInsert {
  source_type: "video" | "web";
  url: string | null;
  title: string;
  excerpt: string;
  published_at: string | null;
  metadata: Record<string, unknown>;
}

export interface TrendDataPort {
  getVideoVelocity(userId: string, channelIds?: string[]): Promise<VideoVelocityInput[]>;
  /** Existing radar-generated sources (for 24h dedupe). */
  findRecentRadarSources(
    userId: string,
    trendIds: string[],
    sinceIso: string,
  ): Promise<Set<string>>;
  insertResearchSources(userId: string, rows: ResearchSourceInsert[]): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Pure trend computation (unit-testable, no I/O)                       */
/* ------------------------------------------------------------------ */

/** Trends only consider videos published within the last 90 days. */
export const TREND_WINDOW_DAYS = 90;

export function computeTrends(
  videos: VideoVelocityInput[],
  max: number,
  now: Date = new Date(),
): Trend[] {
  const cutoff = now.getTime() - TREND_WINDOW_DAYS * 86_400_000;
  const eligible = videos.filter(
    (v) =>
      v.viewsPerDay != null &&
      v.viewsPerDay > 0 &&
      v.snapshotCount >= 2 &&
      v.publishedAt != null &&
      new Date(v.publishedAt).getTime() >= cutoff,
  );
  if (eligible.length === 0) return [];

  const ranked = [...eligible].sort((a, b) => (b.viewsPerDay ?? 0) - (a.viewsPerDay ?? 0));
  const top = ranked.slice(0, Math.max(1, max));
  const maxVpd = top[0]!.viewsPerDay ?? 1;
  const denom = Math.log10(1 + maxVpd);

  return top.map((v) => {
    const vpd = v.viewsPerDay ?? 0;
    const velocityValue = Math.round((100 * Math.log10(1 + vpd)) / denom);
    const ageDays = (now.getTime() - new Date(v.publishedAt!).getTime()) / 86_400_000;
    const recencyValue = Math.max(
      0,
      Math.min(100, Math.round(100 * (1 - ageDays / TREND_WINDOW_DAYS))),
    );

    const factors: ScoreFactor[] = [
      {
        key: "velocity",
        label: "Velocity",
        weight: 0.7,
        value: velocityValue,
        detail: `~${formatCompact(vpd)} views/day between first and latest snapshot (${v.snapshotCount} snapshots).`,
        evidenceCount: v.snapshotCount,
      },
      {
        key: "recency",
        label: "Recency",
        weight: 0.3,
        value: recencyValue,
        detail: `Published ${Math.max(0, Math.round(ageDays))} days ago (trend window: ${TREND_WINDOW_DAYS} days).`,
        evidenceCount: 1,
      },
    ];
    const score0to100 = Math.round(velocityValue * 0.7 + recencyValue * 0.3);

    let confidence: Confidence = confidenceFor(1, v.snapshotCount);
    for (const f of factors) {
      if (f.evidenceCount === 0) confidence = confidence === "high" ? "medium" : "low";
    }

    return {
      id: `video:${v.externalVideoId}`,
      topic: v.title || "Untitled video",
      score0to100,
      factors,
      confidence,
      sources: [
        {
          title: v.title || "Untitled video",
          url: `https://www.youtube.com/watch?v=${v.externalVideoId}`,
          publishedAt: v.publishedAt,
        },
      ],
      capturedAt: now.toISOString(),
    };
  });
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

/* ------------------------------------------------------------------ */
/* Supabase port                                                       */
/* ------------------------------------------------------------------ */

type Db = AdminDb;

export function makeTrendDataPort(admin: Db): TrendDataPort {
  return {
    async getVideoVelocity(userId, channelIds) {
      let q = admin
        .from("videos")
        .select("id, external_video_id, title, published_at, channel_id, channels(title)")
        .eq("user_id", userId)
        .not("published_at", "is", null)
        .order("published_at", { ascending: false })
        .limit(300);
      if (channelIds && channelIds.length > 0) q = q.in("channel_id", channelIds);
      const { data: videos, error } = await q;
      if (error) throw new Error(error.message);
      const vids = (videos ?? []) as VideoRowLite[];
      if (vids.length === 0) return [];

      const ids = vids.map((v) => v.id);
      const { data: snaps, error: snapErr } = await admin
        .from("video_snapshots")
        .select("video_id, captured_at, view_count")
        .in("video_id", ids)
        .order("captured_at", { ascending: true });
      if (snapErr) throw new Error(snapErr.message);

      const byVideo = new Map<string, { t: number; views: number }[]>();
      for (const s of (snaps ?? []) as VideoSnapshotLite[]) {
        if (s.view_count == null) continue;
        const arr = byVideo.get(s.video_id) ?? [];
        arr.push({ t: new Date(s.captured_at).getTime(), views: Number(s.view_count) });
        byVideo.set(s.video_id, arr);
      }

      return vids.map((v) => {
        const arr = byVideo.get(v.id) ?? [];
        let viewsPerDay: number | null = null;
        if (arr.length >= 2) {
          const first = arr[0]!;
          const last = arr[arr.length - 1]!;
          const days = (last.t - first.t) / 86_400_000;
          if (days > 0) viewsPerDay = (last.views - first.views) / days;
        }
        return {
          videoId: v.id,
          externalVideoId: v.external_video_id,
          title: v.title ?? "",
          publishedAt: v.published_at,
          channelTitle: v.channels?.title ?? null,
          viewsPerDay,
          snapshotCount: arr.length,
          latestCapturedAt: arr.length > 0 ? new Date(arr[arr.length - 1]!.t).toISOString() : null,
        };
      });
    },

    async findRecentRadarSources(userId, trendIds, sinceIso) {
      if (trendIds.length === 0) return new Set<string>();
      const found = new Set<string>();
      // jsonb @> one trend_id at a time keeps the query simple and index-friendly.
      for (const tid of trendIds) {
        const { data, error } = await admin
          .from("research_sources")
          .select("metadata")
          .eq("user_id", userId)
          .contains("metadata", { generated_by: "trend-radar", trend_id: tid })
          .gte("created_at", sinceIso);
        if (error) throw new Error(error.message);
        if ((data ?? []).length > 0) found.add(tid);
      }
      return found;
    },

    async insertResearchSources(userId, rows) {
      if (rows.length === 0) return;
      const { error } = await admin
        .from("research_sources")
        .insert(rows.map((r) => ({ user_id: userId, ...r })));
      if (error) throw new Error(error.message);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Business logic over the ports                                       */
/* ------------------------------------------------------------------ */

export interface TrendEnvelopeOk {
  status: "ok";
  trends: Trend[];
  generatedAt: string;
}
export type TrendEnvelope =
  | TrendEnvelopeOk
  | { status: "insufficient_data"; reason: string }
  | { status: "unconfigured"; reason: string };

export async function buildTrendRadar(
  trendPort: TrendDataPort,
  nichePort: {
    getNicheChannelEvidence(userId: string, nicheId: string): Promise<{ id: string }[]>;
    getNiche(userId: string, nicheId: string): Promise<{ id: string } | null>;
  },
  userId: string,
  opts: { nicheId?: string | undefined; max?: number | undefined },
  now: Date = new Date(),
): Promise<TrendEnvelope> {
  const max = Math.min(50, Math.max(1, opts.max ?? 10));
  let channelIds: string[] | undefined;
  if (opts.nicheId) {
    const niche = await nichePort.getNiche(userId, opts.nicheId);
    if (!niche) throw new Error("Niche not found");
    const evidence = await nichePort.getNicheChannelEvidence(userId, opts.nicheId);
    channelIds = evidence.map((e) => e.id);
    if (channelIds.length === 0) {
      return {
        status: "insufficient_data",
        reason:
          "This niche has no tracked channels yet. Track channels first, then check the radar.",
      };
    }
  }

  const velocities = await trendPort.getVideoVelocity(userId, channelIds);
  const trends = computeTrends(velocities, max, now);
  if (trends.length === 0) {
    return {
      status: "insufficient_data",
      reason:
        "Not enough snapshot history yet. Trends need videos with ≥2 snapshots published in the last 90 days — track channels and wait for a second snapshot round.",
    };
  }

  // Every trend persists ≥1 research_sources row (citations are mandatory).
  const sinceIso = new Date(now.getTime() - 86_400_000).toISOString();
  const already = await trendPort.findRecentRadarSources(
    userId,
    trends.map((t) => t.id),
    sinceIso,
  );
  const vpdById = new Map(velocities.map((v) => [`video:${v.externalVideoId}`, v]));
  const toInsert: ResearchSourceInsert[] = trends
    .filter((t) => !already.has(t.id))
    .map((t) => {
      const v = vpdById.get(t.id);
      return {
        source_type: "video" as const,
        url: t.sources[0]?.url ?? null,
        title: t.sources[0]?.title ?? t.topic,
        excerpt:
          `Trend signal: ~${Math.round(v?.viewsPerDay ?? 0).toLocaleString("en-US")} views/day ` +
          `across ${v?.snapshotCount ?? 0} snapshots${v?.channelTitle ? ` — ${v.channelTitle}` : ""}. ` +
          `Rule-based velocity ranking, not a virality prediction.`,
        published_at: t.sources[0]?.publishedAt ?? null,
        metadata: {
          generated_by: "trend-radar",
          trend_id: t.id,
          niche_id: opts.nicheId ?? null,
          views_per_day: v?.viewsPerDay ?? null,
          snapshot_count: v?.snapshotCount ?? 0,
          trend_score: t.score0to100,
          generated_at: now.toISOString(),
        },
      };
    });
  await trendPort.insertResearchSources(userId, toInsert);

  return { status: "ok", trends, generatedAt: now.toISOString() };
}

/* ------------------------------------------------------------------ */
/* Server function                                                     */
/* ------------------------------------------------------------------ */

const radarSchema = z.object({
  nicheId: z.string().uuid().optional(),
  max: z.number().int().min(1).max(50).default(10),
});

export const getTrendRadar = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => radarSchema.parse(i))
  .handler(async ({ data, context }): Promise<TrendEnvelope> => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return buildTrendRadar(makeTrendDataPort(supabaseAdmin), await getNichePort(), userId, {
      nicheId: data.nicheId,
      max: data.max,
    });
  });
