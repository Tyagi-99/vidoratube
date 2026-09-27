/**
 * Stream A — quota-aware YouTube Data API v3 client (server-only).
 *
 * Wraps `channels.list`, `videos.list`, and `search.list` (type=channel) with:
 * - honest unconfigured handling: when YOUTUBE_API_KEY is absent every call
 *   returns `{ status: "unconfigured", reason }` naming the founder action —
 *   never fabricated data;
 * - cache-first reads through `youtube_api_cache` (TTL: channels 24h,
 *   videos 6h, search 1h) so repeated reads don't burn quota;
 * - per-call quota recording via `recordYouTubeQuota` (api-cost.ts) on every
 *   live API call;
 * - API failures (quota exceeded, invalid key, network) thrown as `Error`
 *   with a clear message; callers map unconfigured → envelope and let other
 *   errors propagate.
 *
 * Also hosts the internal DB shim used across the intelligence modules: the
 * Phase 1 intelligence tables predate the generated `Database` types, so the
 * service-role client is narrowed to a minimal structural surface. No `any`
 * in exported signatures.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { recordYouTubeQuota, type YouTubeQuotaOperation } from "../api-cost";
import { ProviderError, providerFetch } from "../providers/http.server";

/* ------------------------------------------------------------------ */
/* Internal DB shim                                                    */
/* ------------------------------------------------------------------ */

export interface DbErrorShape {
  message: string;
}

export interface DbSingleResult<T> {
  data: T | null;
  error: DbErrorShape | null;
}

export interface DbListResult<T> {
  data: T[] | null;
  error: DbErrorShape | null;
}

/**
 * Minimal structural surface of the postgrest-js query builder actually used
 * by the intelligence modules. postgrest-js builders are thenable, so a
 * terminal list fetch is just `await query`.
 */
export interface DbQuery {
  select(columns?: string): DbQuery;
  insert(values: Record<string, unknown> | Array<Record<string, unknown>>): DbQuery;
  upsert(
    values: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): DbQuery;
  update(values: Record<string, unknown>): DbQuery;
  delete(): DbQuery;
  eq(column: string, value: unknown): DbQuery;
  neq(column: string, value: unknown): DbQuery;
  in(column: string, values: unknown[]): DbQuery;
  is(column: string, value: null | boolean): DbQuery;
  not(column: string, operator: string, value: unknown): DbQuery;
  gt(column: string, value: unknown): DbQuery;
  gte(column: string, value: unknown): DbQuery;
  lt(column: string, value: unknown): DbQuery;
  lte(column: string, value: unknown): DbQuery;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): DbQuery;
  limit(count: number): DbQuery;
  range(from: number, to: number): DbQuery;
  maybeSingle<T>(): Promise<DbSingleResult<T>>;
  single<T>(): Promise<DbSingleResult<T>>;
  then<TResult>(
    onfulfilled?:
      ((value: DbListResult<unknown>) => TResult | PromiseLike<TResult>) | undefined | null,
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | undefined | null,
  ): PromiseLike<TResult>;
}

export interface AdminDb {
  from(table: string): DbQuery;
}

/** Narrow the service-role client to the structural surface above. */
export function adminDb(admin: SupabaseClient<Database>): AdminDb {
  return admin as unknown as AdminDb;
}

/** Terminal list fetch: throws on error, returns rows (never null). */
export async function dbList<T>(query: DbQuery): Promise<T[]> {
  const result = (await query) as DbListResult<T>;
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

/** Terminal single-row fetch: throws on error, returns the row or null. */
export async function dbOne<T>(promise: Promise<DbSingleResult<T>>): Promise<T | null> {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data;
}

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

/** Founder action named in every unconfigured response. */
export const YOUTUBE_UNCONFIGURED_REASON =
  "YouTube Data API is not connected. Founder action: set the YOUTUBE_API_KEY " +
  "environment variable (a YouTube Data API v3 key from Google Cloud Console) " +
  "on the server, then retry.";

export function youtubeApiConfigured(): boolean {
  return Boolean(process.env["YOUTUBE_API_KEY"]);
}

export type YouTubeApiOk<T> = { status: "ok"; data: T; cached: boolean };
export type YouTubeApiUnconfigured = {
  status: "unconfigured";
  reason: string;
};
export type YouTubeApiResult<T> = YouTubeApiOk<T> | YouTubeApiUnconfigured;

/* ------------------------------------------------------------------ */
/* Normalized shapes                                                   */
/* ------------------------------------------------------------------ */

export interface YouTubeChannelInfo {
  externalId: string;
  title: string | null;
  /** customUrl, e.g. "@somehandle". */
  handle: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  subscriberCount: number | null;
  videoCount: number | null;
  viewCount: number | null;
  publishedAt: string | null;
  /** ISO timestamp of the API payload behind this info. */
  fetchedAt: string;
}

export interface YouTubeVideoInfo {
  externalId: string;
  title: string;
  description: string;
  channelId: string | null;
  channelTitle: string | null;
  publishedAt: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  /** ISO timestamp of the API payload behind this info. */
  fetchedAt: string;
}

/** search.list (type=channel) hit — snippet only, no statistics. */
export interface YouTubeChannelSearchHit {
  externalId: string;
  title: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
}

/* ------------------------------------------------------------------ */
/* Cache (youtube_api_cache)                                           */
/* ------------------------------------------------------------------ */

const CACHE_TTL_HOURS = {
  channels: 24,
  videos: 6,
  search: 1,
} as const;

interface CacheRow {
  cache_key: string;
  user_id: string;
  payload: unknown;
  expires_at: string;
}

async function readCache<T>(
  admin: SupabaseClient<Database>,
  userId: string,
  cacheKey: string,
): Promise<T | null> {
  const row = await dbOne<CacheRow>(
    adminDb(admin)
      .from("youtube_api_cache")
      .select("cache_key, user_id, payload, expires_at")
      .eq("cache_key", cacheKey)
      .eq("user_id", userId)
      .maybeSingle(),
  );
  if (!row) return null;
  if (Number.isNaN(Date.parse(row.expires_at))) return null;
  if (Date.parse(row.expires_at) <= Date.now()) return null; // expired
  return row.payload as T;
}

/**
 * Best-effort cache write: a failed write must never break the request that
 * already paid the quota for the data.
 */
async function writeCache(
  admin: SupabaseClient<Database>,
  userId: string,
  cacheKey: string,
  payload: unknown,
  ttlHours: number,
): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + ttlHours * 3_600_000).toISOString();
    const result = (await adminDb(admin)
      .from("youtube_api_cache")
      .upsert(
        {
          cache_key: cacheKey,
          user_id: userId,
          payload: payload as Record<string, unknown>,
          expires_at: expiresAt,
        },
        { onConflict: "cache_key" },
      )) as DbListResult<unknown>;
    if (result.error) throw new Error(result.error.message);
  } catch {
    // best-effort: the caller already holds fresh data
  }
}

/* ------------------------------------------------------------------ */
/* Low-level API call                                                  */
/* ------------------------------------------------------------------ */

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

function mapProviderError(err: unknown, operation: string): Error {
  if (err instanceof ProviderError) {
    const detail = err.message;
    if (err.status === 0) {
      return new Error(
        `YouTube Data API request failed (${operation}): network error or timeout. ${detail}`,
      );
    }
    if (err.status === 403 && /quotaexceeded/i.test(detail)) {
      return new Error(
        `YouTube Data API quota exceeded (${operation}). The project's daily quota is spent; ` +
          `retry after the reset or ask the founder to request a quota increase in Google Cloud Console.`,
      );
    }
    if (err.status === 400 || err.status === 401 || err.status === 403) {
      return new Error(
        `YouTube Data API rejected the request (${operation}, HTTP ${err.status}). The YOUTUBE_API_KEY ` +
          `is invalid, restricted, or not enabled for YouTube Data API v3 — founder action: verify the key ` +
          `in Google Cloud Console. ${detail}`,
      );
    }
    if (err.status === 429) {
      return new Error(
        `YouTube Data API rate-limited the request (${operation}, HTTP 429). Wait and retry. ${detail}`,
      );
    }
    return new Error(
      `YouTube Data API request failed (${operation}, HTTP ${err.status}). ${detail}`,
    );
  }
  return new Error(
    `YouTube Data API request failed (${operation}): ${err instanceof Error ? err.message : String(err)}`,
  );
}

/** One GET against the YouTube Data API; records quota on success. */
async function youTubeGet(
  admin: SupabaseClient<Database>,
  userId: string,
  operation: YouTubeQuotaOperation,
  path: string,
  params: Record<string, string>,
): Promise<unknown> {
  const key = process.env["YOUTUBE_API_KEY"];
  if (!key) throw new Error("YOUTUBE_API_KEY is not set.");
  const url = new URL(`${YOUTUBE_API_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", key);
  let res: Response;
  try {
    res = await providerFetch("YouTube", url.toString(), { timeoutMs: 30_000 });
  } catch (err) {
    throw mapProviderError(err, operation);
  }
  // providerFetch only returns on res.ok; every live call records quota.
  await recordYouTubeQuota(admin, { userId, operation });
  return (await res.json()) as unknown;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/* ------------------------------------------------------------------ */
/* Response parsing                                                    */
/* ------------------------------------------------------------------ */

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** YouTube statistics counters arrive as decimal strings; never invent them. */
function asCount(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.floor(v));
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
  }
  return null;
}

function thumbnailOf(thumbs: unknown): string | null {
  if (typeof thumbs !== "object" || thumbs === null) return null;
  const t = thumbs as Record<string, { url?: unknown } | undefined>;
  return asString(t["high"]?.url) ?? asString(t["medium"]?.url) ?? asString(t["default"]?.url);
}

interface RawChannelItem {
  id?: unknown;
  snippet?: {
    title?: unknown;
    description?: unknown;
    customUrl?: unknown;
    publishedAt?: unknown;
    thumbnails?: unknown;
  };
  statistics?: {
    subscriberCount?: unknown;
    videoCount?: unknown;
    viewCount?: unknown;
  };
}

function toChannelInfo(item: RawChannelItem, fetchedAt: string): YouTubeChannelInfo | null {
  const id = asString(item.id);
  if (!id) return null;
  const snippet = item.snippet ?? {};
  const stats = item.statistics ?? {};
  return {
    externalId: id,
    title: asString(snippet.title),
    handle: asString(snippet.customUrl),
    description: asString(snippet.description),
    thumbnailUrl: thumbnailOf(snippet.thumbnails),
    subscriberCount: asCount(stats.subscriberCount),
    videoCount: asCount(stats.videoCount),
    viewCount: asCount(stats.viewCount),
    publishedAt: asString(snippet.publishedAt),
    fetchedAt,
  };
}

interface RawVideoItem {
  id?: unknown;
  snippet?: {
    title?: unknown;
    description?: unknown;
    channelId?: unknown;
    channelTitle?: unknown;
    publishedAt?: unknown;
    thumbnails?: unknown;
  };
  statistics?: {
    viewCount?: unknown;
    likeCount?: unknown;
    commentCount?: unknown;
  };
  contentDetails?: { duration?: unknown };
}

function toVideoInfo(item: RawVideoItem, fetchedAt: string): YouTubeVideoInfo | null {
  const id = asString(item.id);
  if (!id) return null;
  const snippet = item.snippet ?? {};
  const stats = item.statistics ?? {};
  const details = item.contentDetails ?? {};
  return {
    externalId: id,
    title: asString(snippet.title) ?? "",
    description: asString(snippet.description) ?? "",
    channelId: asString(snippet.channelId),
    channelTitle: asString(snippet.channelTitle),
    publishedAt: asString(snippet.publishedAt),
    durationSeconds: parseISO8601Duration(asString(details.duration)),
    thumbnailUrl: thumbnailOf(snippet.thumbnails),
    viewCount: asCount(stats.viewCount),
    likeCount: asCount(stats.likeCount),
    commentCount: asCount(stats.commentCount),
    fetchedAt,
  };
}

/** Parse an ISO 8601 duration (e.g. "PT1H2M3S") to whole seconds. */
export function parseISO8601Duration(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso);
  if (!m) return null;
  if (!m[1] && !m[2] && !m[3] && !m[4]) return null;
  const days = Number(m[1] ?? 0);
  const hours = Number(m[2] ?? 0);
  const minutes = Number(m[3] ?? 0);
  const seconds = Number(m[4] ?? 0);
  if (![days, hours, minutes, seconds].every(Number.isFinite)) return null;
  return Math.round(days * 86_400 + hours * 3_600 + minutes * 60 + seconds);
}

interface RawSearchItem {
  id?: { channelId?: unknown };
  snippet?: {
    title?: unknown;
    description?: unknown;
    publishedAt?: unknown;
    thumbnails?: unknown;
  };
}

function toSearchHit(item: RawSearchItem): YouTubeChannelSearchHit | null {
  const id = asString(item.id?.channelId);
  if (!id) return null;
  const snippet = item.snippet ?? {};
  return {
    externalId: id,
    title: asString(snippet.title),
    description: asString(snippet.description),
    thumbnailUrl: thumbnailOf(snippet.thumbnails),
    publishedAt: asString(snippet.publishedAt),
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * channels.list (part=snippet,statistics). Cache-first (24h TTL); every live
 * call records quota. Throws Error on API failure.
 */
export async function fetchChannels(
  admin: SupabaseClient<Database>,
  userId: string,
  channelIds: string[],
  opts?: { forceRefresh?: boolean | undefined },
): Promise<YouTubeApiResult<YouTubeChannelInfo[]>> {
  if (!youtubeApiConfigured()) {
    return { status: "unconfigured", reason: YOUTUBE_UNCONFIGURED_REASON };
  }
  const ids = [...new Set(channelIds.filter((id) => id.trim() !== ""))].sort();
  if (ids.length === 0) return { status: "ok", data: [], cached: false };

  const cacheKey = `yt:v1:${userId}:channels:${ids.join(",")}`;
  if (!opts?.forceRefresh) {
    const cached = await readCache<YouTubeChannelInfo[]>(admin, userId, cacheKey);
    if (cached) return { status: "ok", data: cached, cached: true };
  }

  const fetchedAt = new Date().toISOString();
  const infos: YouTubeChannelInfo[] = [];
  for (const batch of chunk(ids, 50)) {
    const payload = (await youTubeGet(admin, userId, "channels.list", "channels", {
      part: "snippet,statistics",
      id: batch.join(","),
      maxResults: String(batch.length),
    })) as { items?: RawChannelItem[] };
    const items = Array.isArray(payload.items) ? payload.items : [];
    for (const item of items) {
      const info = toChannelInfo(item, fetchedAt);
      if (info) infos.push(info);
    }
  }
  await writeCache(admin, userId, cacheKey, infos, CACHE_TTL_HOURS.channels);
  return { status: "ok", data: infos, cached: false };
}

/**
 * videos.list (part=snippet,statistics,contentDetails). Cache-first (6h TTL);
 * every live call records quota. Throws Error on API failure.
 */
export async function fetchVideos(
  admin: SupabaseClient<Database>,
  userId: string,
  videoIds: string[],
  opts?: { forceRefresh?: boolean | undefined },
): Promise<YouTubeApiResult<YouTubeVideoInfo[]>> {
  if (!youtubeApiConfigured()) {
    return { status: "unconfigured", reason: YOUTUBE_UNCONFIGURED_REASON };
  }
  const ids = [...new Set(videoIds.filter((id) => id.trim() !== ""))].sort();
  if (ids.length === 0) return { status: "ok", data: [], cached: false };

  const cacheKey = `yt:v1:${userId}:videos:${ids.join(",")}`;
  if (!opts?.forceRefresh) {
    const cached = await readCache<YouTubeVideoInfo[]>(admin, userId, cacheKey);
    if (cached) return { status: "ok", data: cached, cached: true };
  }

  const fetchedAt = new Date().toISOString();
  const infos: YouTubeVideoInfo[] = [];
  for (const batch of chunk(ids, 50)) {
    const payload = (await youTubeGet(admin, userId, "videos.list", "videos", {
      part: "snippet,statistics,contentDetails",
      id: batch.join(","),
      maxResults: String(batch.length),
    })) as { items?: RawVideoItem[] };
    const items = Array.isArray(payload.items) ? payload.items : [];
    for (const item of items) {
      const info = toVideoInfo(item, fetchedAt);
      if (info) infos.push(info);
    }
  }
  await writeCache(admin, userId, cacheKey, infos, CACHE_TTL_HOURS.videos);
  return { status: "ok", data: infos, cached: false };
}

/**
 * search.list (type=channel) for channel discovery. Snippet only — no
 * statistics; callers that need stats follow up with fetchChannels.
 * Cache-first (1h TTL); every live call records quota. Throws on failure.
 */
export async function searchChannelsByQuery(
  admin: SupabaseClient<Database>,
  userId: string,
  query: string,
  maxResults = 10,
): Promise<YouTubeApiResult<YouTubeChannelSearchHit[]>> {
  if (!youtubeApiConfigured()) {
    return { status: "unconfigured", reason: YOUTUBE_UNCONFIGURED_REASON };
  }
  const q = query.trim();
  if (!q) return { status: "ok", data: [], cached: false };
  const limit = Math.min(50, Math.max(1, maxResults));

  const cacheKey = `yt:v1:${userId}:search-channels:${q.toLowerCase()}:${limit}`;
  const cached = await readCache<YouTubeChannelSearchHit[]>(admin, userId, cacheKey);
  if (cached) return { status: "ok", data: cached, cached: true };

  const payload = (await youTubeGet(admin, userId, "search.list", "search", {
    part: "snippet",
    type: "channel",
    q,
    maxResults: String(limit),
  })) as { items?: RawSearchItem[] };
  const items = Array.isArray(payload.items) ? payload.items : [];
  const hits: YouTubeChannelSearchHit[] = [];
  for (const item of items) {
    const hit = toSearchHit(item);
    if (hit) hits.push(hit);
  }
  await writeCache(admin, userId, cacheKey, hits, CACHE_TTL_HOURS.search);
  return { status: "ok", data: hits, cached: false };
}
