/**
 * Stream B — niche server functions (F1).
 *
 * createServerFn + requireAppUser + zod, envelope output per
 * docs/PHASE2_CONTRACTS.md. scoreNiche() reads the channels /
 * channel_snapshots / videos tables directly with the service-role client
 * (the same tables Stream A writes) so Stream B stays independent of
 * Stream A's in-progress code. No live YouTube API calls here — scoring is
 * snapshot-derived, hence no quota burn and no "unconfigured" state on
 * scoreNiche itself.
 */

import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireAppUser } from "../server-auth";
import { scoreNicheOpportunity, type ChannelCardInput } from "./scoring";
import type { Freshness, NicheScore } from "./types";
import type { Blueprint } from "./blueprints.functions";

/** Narrow row shapes for the tables this module reads/writes. */
interface ChannelRowLite {
  id: string;
  external_channel_id: string;
  handle: string | null;
  title: string | null;
}
interface ChannelSnapshotLite {
  captured_at: string;
  subscriber_count: number | string | null;
  video_count: number | string | null;
  view_count: number | string | null;
}
interface VideoPublishedLite {
  published_at: string | null;
}
interface NicheSnapshotLite {
  niche_id: string;
  captured_at: string;
  score: NicheScore;
}
interface CompetitorLinkLite {
  external_channel_id: string;
  platform: string;
}

/** Minimal surface of the service-role client used by this module. */
export type AdminDb = Pick<SupabaseClient, "from">;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface NicheRow {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  enabled: boolean;
  keywords: string[];
  hashtags: string[];
  search_queries: string[];
  target_platforms: string[];
  min_views: number;
  preferred_format: string;
  preferred_language: string;
  scoring_weights: Record<string, number> | null;
  blueprint: Blueprint | null;
  min_subs: number | null;
  max_subs: number | null;
  active_only: boolean;
  require_recent_activity: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChannelEvidence {
  id: string;
  externalChannelId: string;
  handle: string | null;
  title: string | null;
  subscriberCount: number | null;
  videoCount: number | null;
  viewCount: number | null;
  growth7dPct: number | null;
  lastSnapshotAt: string | null;
  recentVideoAt: string | null;
}

export interface ChannelCard {
  id: string;
  externalChannelId: string;
  handle: string | null;
  title: string | null;
  subscriberCount: number | null;
  videoCount: number | null;
  viewCount: number | null;
  growth7dPct: number | null;
  lastSnapshotAt: string | null;
  freshness: Freshness;
}

export interface NicheSnapshotMetrics {
  channelIds: string[];
  channelCount: number;
  excludedByFilters: number;
  videosPublished7d: number;
  filters: {
    minSubs: number | null;
    maxSubs: number | null;
    activeOnly: boolean;
    requireRecentActivity: boolean;
  };
}

export interface NicheSnapshotRow {
  id: string;
  captured_at: string;
  score: NicheScore;
  metrics: NicheSnapshotMetrics;
  source: string;
}

export type NicheEnvelope<T extends Record<string, unknown> = Record<string, unknown>> =
  | ({ status: "ok" } & T)
  | { status: "insufficient_data"; reason: string }
  | { status: "unconfigured"; reason: string };

/* ------------------------------------------------------------------ */
/* Pure helpers (unit-testable, no I/O)                                 */
/* ------------------------------------------------------------------ */

/** Channels count as "active" when their latest snapshot is ≤ 14 days old. */
export const ACTIVE_SNAPSHOT_DAYS = 14;
/** "Recent activity" = a video published within the last 30 days. */
export const RECENT_ACTIVITY_DAYS = 30;

export function applyNicheFilters(
  niche: Pick<NicheRow, "min_subs" | "max_subs" | "active_only" | "require_recent_activity">,
  evidence: ChannelEvidence[],
  now: Date = new Date(),
): { included: ChannelEvidence[]; excluded: number } {
  const activeCutoff = now.getTime() - ACTIVE_SNAPSHOT_DAYS * 86_400_000;
  const recentCutoff = now.getTime() - RECENT_ACTIVITY_DAYS * 86_400_000;
  const included: ChannelEvidence[] = [];
  let excluded = 0;
  for (const e of evidence) {
    if (niche.min_subs != null && (e.subscriberCount ?? 0) < niche.min_subs) {
      excluded++;
      continue;
    }
    if (niche.max_subs != null && (e.subscriberCount ?? 0) > niche.max_subs) {
      excluded++;
      continue;
    }
    if (niche.active_only) {
      const snapMs = e.lastSnapshotAt ? new Date(e.lastSnapshotAt).getTime() : 0;
      if (!(snapMs >= activeCutoff)) {
        excluded++;
        continue;
      }
    }
    if (niche.require_recent_activity) {
      const vidMs = e.recentVideoAt ? new Date(e.recentVideoAt).getTime() : 0;
      if (!(vidMs >= recentCutoff)) {
        excluded++;
        continue;
      }
    }
    included.push(e);
  }
  return { included, excluded };
}

export function toChannelCard(e: ChannelEvidence): ChannelCard {
  return {
    id: e.id,
    externalChannelId: e.externalChannelId,
    handle: e.handle,
    title: e.title,
    subscriberCount: e.subscriberCount,
    videoCount: e.videoCount,
    viewCount: e.viewCount,
    growth7dPct: e.growth7dPct,
    lastSnapshotAt: e.lastSnapshotAt,
    freshness: { capturedAt: e.lastSnapshotAt, staleAfterHours: 72 },
  };
}

function toChannelCardInput(e: ChannelEvidence): ChannelCardInput {
  return {
    id: e.id,
    externalChannelId: e.externalChannelId,
    handle: e.handle,
    title: e.title,
    subscriberCount: e.subscriberCount,
    videoCount: e.videoCount,
    viewCount: e.viewCount,
    growth7dPct: e.growth7dPct,
    lastSnapshotAt: e.lastSnapshotAt,
  };
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "niche"
  );
}

/* ------------------------------------------------------------------ */
/* Data port — Supabase implementation behind a narrow interface so     */
/* the business logic is unit-testable with an in-memory fake.         */
/* ------------------------------------------------------------------ */

export interface NicheDataPort {
  getNiche(userId: string, nicheId: string): Promise<NicheRow | null>;
  listNiches(userId: string): Promise<NicheRow[]>;
  insertNiche(row: Record<string, unknown>): Promise<NicheRow>;
  updateNiche(userId: string, nicheId: string, patch: Record<string, unknown>): Promise<void>;
  deleteNiche(userId: string, nicheId: string): Promise<void>;
  nicheSlugExists(userId: string, slug: string): Promise<boolean>;
  getLatestScores(userId: string): Promise<Record<string, NicheScore>>;
  listNicheSnapshots(userId: string, nicheId: string, limit: number): Promise<NicheSnapshotRow[]>;
  insertNicheSnapshot(
    userId: string,
    nicheId: string,
    score: NicheScore,
    metrics: NicheSnapshotMetrics,
  ): Promise<void>;
  getNicheChannelEvidence(userId: string, nicheId: string): Promise<ChannelEvidence[]>;
  countRecentVideos(userId: string, channelIds: string[], sinceIso: string): Promise<number>;
}

type Db = AdminDb;

/** Supabase-backed port. `admin` is the service-role client. */
export function makeNicheDataPort(admin: Db): NicheDataPort {
  async function getChannelEvidenceFor(
    userId: string,
    channelIds: string[],
  ): Promise<ChannelEvidence[]> {
    if (channelIds.length === 0) return [];
    const { data: channels, error } = await admin
      .from("channels")
      .select("id, external_channel_id, handle, title")
      .eq("user_id", userId)
      .in("id", channelIds);
    if (error) throw new Error(error.message);

    const out: ChannelEvidence[] = [];
    for (const ch of (channels ?? []) as ChannelRowLite[]) {
      // Latest snapshot + the oldest snapshot at least 7 days older (for 7d growth).
      const { data: snaps, error: snapErr } = await admin
        .from("channel_snapshots")
        .select("captured_at, subscriber_count, video_count, view_count")
        .eq("channel_id", ch.id)
        .order("captured_at", { ascending: false })
        .limit(25);
      if (snapErr) throw new Error(snapErr.message);
      const snapRows = (snaps ?? []) as ChannelSnapshotLite[];
      const latest = snapRows[0];
      let growth7dPct: number | null = null;
      if (latest && Number(latest.subscriber_count) > 0) {
        const cutoff = new Date(latest.captured_at).getTime() - 7 * 86_400_000;
        const older = snapRows.find(
          (s) => new Date(s.captured_at).getTime() <= cutoff && Number(s.subscriber_count) > 0,
        );
        if (older) {
          const cur = Number(latest.subscriber_count);
          const prev = Number(older.subscriber_count);
          growth7dPct = ((cur - prev) / prev) * 100;
        }
      }
      const { data: recentVideo } = await admin
        .from("videos")
        .select("published_at")
        .eq("user_id", userId)
        .eq("channel_id", ch.id)
        .not("published_at", "is", null)
        .order("published_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      out.push({
        id: ch.id,
        externalChannelId: ch.external_channel_id,
        handle: ch.handle ?? null,
        title: ch.title ?? null,
        subscriberCount: latest?.subscriber_count != null ? Number(latest.subscriber_count) : null,
        videoCount: latest?.video_count != null ? Number(latest.video_count) : null,
        viewCount: latest?.view_count != null ? Number(latest.view_count) : null,
        growth7dPct,
        lastSnapshotAt: latest?.captured_at ?? null,
        recentVideoAt: (recentVideo as VideoPublishedLite | null)?.published_at ?? null,
      });
    }
    return out;
  }

  return {
    async getNiche(userId, nicheId) {
      const { data, error } = await admin
        .from("niches")
        .select("*")
        .eq("user_id", userId)
        .eq("id", nicheId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as NicheRow | null) ?? null;
    },
    async listNiches(userId) {
      const { data, error } = await admin
        .from("niches")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as NicheRow[];
    },
    async insertNiche(row) {
      const { data, error } = await admin.from("niches").insert(row).select("*").single();
      if (error) throw new Error(error.message);
      return data as NicheRow;
    },
    async updateNiche(userId, nicheId, patch) {
      const { error } = await admin
        .from("niches")
        .update(patch)
        .eq("user_id", userId)
        .eq("id", nicheId);
      if (error) throw new Error(error.message);
    },
    async deleteNiche(userId, nicheId) {
      const { error } = await admin.from("niches").delete().eq("user_id", userId).eq("id", nicheId);
      if (error) throw new Error(error.message);
    },
    async nicheSlugExists(userId, slug) {
      const { data, error } = await admin
        .from("niches")
        .select("id")
        .eq("user_id", userId)
        .eq("slug", slug)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return Boolean(data);
    },
    async getLatestScores(userId) {
      const { data, error } = await admin
        .from("niche_snapshots")
        .select("niche_id, captured_at, score")
        .eq("user_id", userId)
        .order("captured_at", { ascending: false });
      if (error) throw new Error(error.message);
      const out: Record<string, NicheScore> = {};
      for (const row of (data ?? []) as NicheSnapshotLite[]) {
        if (!out[row.niche_id] && row.score && typeof row.score === "object") {
          out[row.niche_id] = row.score;
        }
      }
      return out;
    },
    async listNicheSnapshots(userId, nicheId, limit) {
      const { data, error } = await admin
        .from("niche_snapshots")
        .select("id, captured_at, score, metrics, source")
        .eq("user_id", userId)
        .eq("niche_id", nicheId)
        .order("captured_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []) as NicheSnapshotRow[];
    },
    async insertNicheSnapshot(userId, nicheId, score, metrics) {
      const { error } = await admin.from("niche_snapshots").insert({
        user_id: userId,
        niche_id: nicheId,
        score,
        metrics,
        source: "youtube-data-api",
      });
      if (error) throw new Error(error.message);
    },
    async getNicheChannelEvidence(userId, nicheId) {
      // Niche ↔ channel link lives on competitor_channels (P1).
      const { data: links, error } = await admin
        .from("competitor_channels")
        .select("external_channel_id, platform")
        .eq("user_id", userId)
        .eq("niche_id", nicheId)
        .eq("status", "watching");
      if (error) throw new Error(error.message);
      const extIds = [
        ...new Set(((links ?? []) as CompetitorLinkLite[]).map((l) => l.external_channel_id)),
      ];
      if (extIds.length === 0) return [];
      const { data: channels, error: chErr } = await admin
        .from("channels")
        .select("id")
        .eq("user_id", userId)
        .in("external_channel_id", extIds);
      if (chErr) throw new Error(chErr.message);
      const ids = ((channels ?? []) as { id: string }[]).map((c) => c.id);
      return getChannelEvidenceFor(userId, ids);
    },
    async countRecentVideos(userId, channelIds, sinceIso) {
      if (channelIds.length === 0) return 0;
      const { count, error } = await admin
        .from("videos")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .in("channel_id", channelIds)
        .gte("published_at", sinceIso);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Business logic over the port (testable without Supabase)            */
/* ------------------------------------------------------------------ */

/** Recompute a niche's opportunity score and persist a niche_snapshots row. */
export async function recomputeNicheScore(
  port: NicheDataPort,
  userId: string,
  nicheId: string,
  now: Date = new Date(),
): Promise<NicheEnvelope<{ score: NicheScore; channelCount: number; excludedByFilters: number }>> {
  const niche = await port.getNiche(userId, nicheId);
  if (!niche) throw new Error("Niche not found");

  const evidence = await port.getNicheChannelEvidence(userId, nicheId);
  if (evidence.length === 0) {
    return {
      status: "insufficient_data",
      reason:
        "No tracked channels are linked to this niche yet. Track competitor channels against this niche (Stream A: trackChannel with nicheId) and take snapshots before scoring.",
    };
  }

  const { included, excluded } = applyNicheFilters(niche, evidence, now);
  if (included.length === 0) {
    return {
      status: "insufficient_data",
      reason: `All ${evidence.length} linked channels were excluded by this niche's filters (subs range, active-only, or recent-activity). Loosen the filters or link more channels.`,
    };
  }

  const sinceIso = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const videosPublished7d = await port.countRecentVideos(
    userId,
    included.map((e) => e.id),
    sinceIso,
  );

  const score = scoreNicheOpportunity({
    niche: {
      id: niche.id,
      name: niche.name,
      keywords: niche.keywords,
      minSubs: niche.min_subs,
      maxSubs: niche.max_subs,
      preferredLanguage: niche.preferred_language,
      preferredFormat: niche.preferred_format,
      scoringWeights: niche.scoring_weights,
    },
    channels: included.map(toChannelCardInput),
    videosPublished7d,
    now,
  });

  await port.insertNicheSnapshot(userId, nicheId, score, {
    channelIds: included.map((e) => e.id),
    channelCount: included.length,
    excludedByFilters: excluded,
    videosPublished7d,
    filters: {
      minSubs: niche.min_subs,
      maxSubs: niche.max_subs,
      activeOnly: niche.active_only,
      requireRecentActivity: niche.require_recent_activity,
    },
  });

  return { status: "ok", score, channelCount: included.length, excludedByFilters: excluded };
}

async function uniqueSlug(port: NicheDataPort, userId: string, base: string): Promise<string> {
  let slug = base;
  for (let i = 2; i < 100; i++) {
    if (!(await port.nicheSlugExists(userId, slug))) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${Date.now()}`;
}

/* ------------------------------------------------------------------ */
/* Server functions                                                    */
/* ------------------------------------------------------------------ */

const createNicheSchema = z.object({
  name: z.string().min(2).max(80),
  keywords: z.array(z.string().min(1).max(60)).min(1).max(30),
  language: z.string().min(2).max(10).default("en"),
  format: z.enum(["long", "short", "both"]).default("both"),
  minSubs: z.number().int().min(0).nullable().optional(),
  maxSubs: z.number().int().min(0).nullable().optional(),
  activeOnly: z.boolean().optional(),
});

const nicheIdSchema = z.object({ nicheId: z.string().uuid() });

export async function getPort(): Promise<NicheDataPort> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return makeNicheDataPort(supabaseAdmin);
}

/** YouTube Data API configured? Drives the unconfigured state in Stream B pages. */
export const getIntelligenceStatus = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({}).parse(i))
  .handler(async () => {
    return { youtubeConfigured: Boolean(process.env["YOUTUBE_API_KEY"]) };
  });

export const createNiche = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => createNicheSchema.parse(i))
  .handler(async ({ data, context }): Promise<NicheEnvelope<{ niche: NicheRow }>> => {
    const { userId } = context;
    const port = await getPort();
    const base = slugify(data.name);
    const slug = await uniqueSlug(port, userId, base);
    if (data.minSubs != null && data.maxSubs != null && data.minSubs > data.maxSubs) {
      throw new Error("minSubs must be ≤ maxSubs");
    }
    const niche = await port.insertNiche({
      user_id: userId,
      name: data.name.trim(),
      slug,
      keywords: data.keywords.map((k) => k.trim()).filter(Boolean),
      preferred_language: data.language,
      preferred_format: data.format,
      min_subs: data.minSubs ?? null,
      max_subs: data.maxSubs ?? null,
      active_only: data.activeOnly ?? false,
    });
    return { status: "ok", niche };
  });

export const listNiches = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({}).parse(i))
  .handler(
    async ({
      context,
    }): Promise<NicheEnvelope<{ niches: (NicheRow & { latestScore: NicheScore | null })[] }>> => {
      const { userId } = context;
      const port = await getPort();
      const [niches, scores] = await Promise.all([
        port.listNiches(userId),
        port.getLatestScores(userId),
      ]);
      return {
        status: "ok",
        niches: niches.map((n) => ({ ...n, latestScore: scores[n.id] ?? null })),
      };
    },
  );

export const getNicheDetail = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => nicheIdSchema.parse(i))
  .handler(
    async ({
      data,
      context,
    }): Promise<
      NicheEnvelope<{
        niche: NicheRow;
        score: NicheScore | null;
        channels: ChannelCard[];
        snapshots: NicheSnapshotRow[];
      }>
    > => {
      const { userId } = context;
      const port = await getPort();
      const niche = await port.getNiche(userId, data.nicheId);
      if (!niche) throw new Error("Niche not found");
      const [scores, evidence, snapshots] = await Promise.all([
        port.getLatestScores(userId),
        port.getNicheChannelEvidence(userId, data.nicheId),
        port.listNicheSnapshots(userId, data.nicheId, 20),
      ]);
      return {
        status: "ok",
        niche,
        score: scores[niche.id] ?? null,
        channels: evidence.map(toChannelCard),
        snapshots,
      };
    },
  );

export const scoreNiche = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => nicheIdSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const port = await getPort();
    return recomputeNicheScore(port, userId, data.nicheId);
  });

export const deleteNiche = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => nicheIdSchema.parse(i))
  .handler(async ({ data, context }): Promise<NicheEnvelope<{ deleted: true }>> => {
    const { userId } = context;
    const port = await getPort();
    const niche = await port.getNiche(userId, data.nicheId);
    if (!niche) throw new Error("Niche not found");
    await port.deleteNiche(userId, data.nicheId);
    return { status: "ok", deleted: true };
  });
