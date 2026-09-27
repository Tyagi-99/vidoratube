/**
 * Phase 4, Stream A (F27) — multi-channel connection registry over the
 * `channel_connections` table. Server-only.
 *
 * The registry is the management surface for every connected channel/Page/
 * IG account: connect/disconnect lifecycle, connection health checks, and
 * quota visibility. OAuth TOKENS are never stored here — they stay in
 * `youtube_connections` / `meta_connections` (column-level GRANT revocation,
 * see the p1_operations migration comment); this table keeps a pointer
 * (youtube_connection_id / meta_connection_id) plus health/quota metadata.
 *
 * Writes are audit-logged (channel.connected / channel.disconnected) via the
 * best-effort auditPublishEvent helper (./audit) so a missing audit_logs table
 * can never break connect/disconnect.
 */

/** Minimal structural Supabase client — the real client satisfies this. */
export type RegistryClient = {
  from(table: string): any;
};

export type ChannelPlatform = "youtube" | "facebook" | "instagram" | "x" | "tiktok" | "linkedin";

export type ChannelStatus = "healthy" | "degraded" | "expired" | "revoked";

export interface ChannelConnection {
  id: string;
  user_id: string;
  workspace_id: string | null;
  platform: ChannelPlatform;
  external_channel_id: string;
  display_name: string | null;
  youtube_connection_id: string | null;
  meta_connection_id: string | null;
  status: ChannelStatus;
  /**
   * Last health-check outcome. Primitive values only — server-function
   * returns must pass TanStack Start's serializability check.
   */
  health: Record<string, string | number | boolean | null>;
  /**
   * Last quota snapshot. Primitive values only (same serialization rule).
   */
  quota: Record<string, string | number | boolean | null>;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RegisterChannelInput {
  userId: string;
  platform: ChannelPlatform;
  externalChannelId: string;
  displayName?: string | null | undefined;
  youtubeConnectionId?: string | null | undefined;
  metaConnectionId?: string | null | undefined;
}

/**
 * Registers (or refreshes) a channel in the registry. Called from the OAuth
 * callbacks right after the token row is stored — one registry row per
 * (user, platform, external id). Idempotent: reconnecting the same channel
 * updates the row instead of duplicating it.
 */
export async function registerChannelConnection(
  client: RegistryClient,
  input: RegisterChannelInput,
): Promise<ChannelConnection> {
  const row = {
    user_id: input.userId,
    platform: input.platform,
    external_channel_id: input.externalChannelId,
    display_name: input.displayName ?? null,
    youtube_connection_id: input.youtubeConnectionId ?? null,
    meta_connection_id: input.metaConnectionId ?? null,
    status: "healthy" as ChannelStatus,
    health: {},
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await client
    .from("channel_connections")
    .upsert(row, { onConflict: "user_id,platform,external_channel_id" })
    .select()
    .single();
  if (error || !data) {
    throw new Error(`Could not register the channel: ${error?.message ?? "unknown error"}`);
  }
  const { auditPublishEvent } = await import("./audit");
  await auditPublishEvent({
    workspaceId: null,
    actorUserId: input.userId,
    action: "channel.connected",
    entityType: "channel_connection",
    entityId: (data as ChannelConnection).id,
    metadata: { platform: input.platform, external_channel_id: input.externalChannelId },
  });
  return data as ChannelConnection;
}

/**
 * Marks a registry row revoked after disconnect. The token row itself is
 * deleted/revoked by the platform-specific disconnect flow
 * (disconnectYouTube / disconnectMeta); this keeps the registry's lifecycle
 * honest without touching tokens.
 */
export async function markChannelConnectionRevoked(
  client: RegistryClient,
  input: { userId: string; platform: ChannelPlatform; externalChannelId: string },
): Promise<void> {
  const { error } = await client
    .from("channel_connections")
    .update({ status: "revoked", updated_at: new Date().toISOString() })
    .eq("user_id", input.userId)
    .eq("platform", input.platform)
    .eq("external_channel_id", input.externalChannelId);
  if (error) throw new Error(`Could not update the channel registry: ${error.message}`);
  const { auditPublishEvent } = await import("./audit");
  await auditPublishEvent({
    workspaceId: null,
    actorUserId: input.userId,
    action: "channel.disconnected",
    entityType: "channel_connection",
    entityId: null,
    metadata: { platform: input.platform, external_channel_id: input.externalChannelId },
  });
}

/**
 * Revokes every registry row for (user, platform). Used by the
 * platform-specific disconnect flows (disconnectYouTube / disconnectMeta)
 * after the token row is deleted/revoked. Rows are kept for the audit trail;
 * health/quota reads treat revoked rows as disconnected.
 */
export async function revokeChannelRegistrations(
  client: RegistryClient,
  userId: string,
  platform: ChannelPlatform,
): Promise<void> {
  const { error } = await client
    .from("channel_connections")
    .update({ status: "revoked", updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("platform", platform);
  if (error) throw new Error(`Could not update the channel registry: ${error.message}`);
  const { auditPublishEvent } = await import("./audit");
  await auditPublishEvent({
    workspaceId: null,
    actorUserId: userId,
    action: "channel.disconnected",
    entityType: "channel_connection",
    entityId: null,
    metadata: { platform, revoked_all: true },
  });
}

/** Lists the caller's registry rows (RLS owner policy governs access). */
export async function listChannelConnections(
  client: RegistryClient,
  userId: string,
): Promise<ChannelConnection[]> {
  const { data, error } = await client
    .from("channel_connections")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not list channels: ${error.message}`);
  return (data ?? []) as ChannelConnection[];
}

/* ------------------------- quota visibility (D65) -------------------------- */

export interface YouTubeQuotaSummary {
  /** videos.insert calls in the window (own 100/day bucket). */
  videosInsertUsed: number;
  videosInsertLimit: number;
  /** search.list calls in the window (own 100/day bucket). */
  searchListUsed: number;
  searchListLimit: number;
  /** Everything else: units consumed from the shared 10,000/day pool. */
  sharedPoolUnitsUsed: number;
  sharedPoolUnitsLimit: number;
  /** Rolling 24h window (YouTube resets at midnight PT; labeled honestly). */
  window: "rolling_24h";
  computedAt: string;
}

const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Computes YouTube quota consumption from the Phase 2 api_usage recording
 * (D65: quota rows carry cost_basis = "youtube-quota-units-not-usd" and a
 * quota_bucket in meta). Rolling 24h window — labeled as such because the
 * real reset is midnight PT.
 */
export async function computeYouTubeQuotaSummary(
  client: RegistryClient,
  userId: string,
  now: Date = new Date(),
): Promise<YouTubeQuotaSummary> {
  const { YOUTUBE_VIDEOS_INSERT_DAILY_CALLS, YOUTUBE_SEARCH_LIST_DAILY_CALLS, YOUTUBE_SHARED_POOL_UNITS_PER_DAY } =
    await import("@/lib/api-cost");
  const since = new Date(now.getTime() - ROLLING_WINDOW_MS).toISOString();
  const { data, error } = await client
    .from("api_usage")
    .select("units, meta")
    .eq("user_id", userId)
    .eq("provider", "youtube")
    .gte("created_at", since);
  if (error) throw new Error(`Could not read quota usage: ${error.message}`);
  let videosInsertUsed = 0;
  let searchListUsed = 0;
  let sharedPoolUnitsUsed = 0;
  for (const row of (data ?? []) as { units: number; meta: { quota_bucket?: string } | null }[]) {
    const bucket = row.meta?.quota_bucket;
    if (bucket === "videos.insert") videosInsertUsed += 1;
    else if (bucket === "search.list") searchListUsed += 1;
    else sharedPoolUnitsUsed += Number(row.units) || 0;
  }
  return {
    videosInsertUsed,
    videosInsertLimit: YOUTUBE_VIDEOS_INSERT_DAILY_CALLS,
    searchListUsed,
    searchListLimit: YOUTUBE_SEARCH_LIST_DAILY_CALLS,
    sharedPoolUnitsUsed,
    sharedPoolUnitsLimit: YOUTUBE_SHARED_POOL_UNITS_PER_DAY,
    window: "rolling_24h",
    computedAt: now.toISOString(),
  };
}

/* ------------------------------ health check ------------------------------ */

/** Platform probes — injectable so tests never touch the network. */
export interface ChannelProbes {
  probeYouTube?: (accessToken: string) => Promise<{ id: string | null; title: string | null }>;
  probeMetaPages?: (
    accessToken: string,
  ) => Promise<{ pages: { id: string; name: string }[] }>;
  probeInstagramLimit?: (
    accessToken: string,
    igUserId: string,
  ) => Promise<{ quotaUsage: number | null; quotaTotal: number | null }>;
  computeYouTubeQuota?: (userId: string) => Promise<YouTubeQuotaSummary>;
}

/** Default probes: the real platform calls (reads only — safe to retry). */
async function defaultProbes(): Promise<Required<ChannelProbes>> {
  const yt = await import("@/lib/youtube.server");
  const meta = await import("@/lib/meta-publish.server");
  const { withTransientRetry } = await import("./retry");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as unknown as RegistryClient;
  return {
    probeYouTube: (accessToken) => withTransientRetry(() => yt.fetchChannel(accessToken)),
    probeMetaPages: (accessToken) =>
      withTransientRetry(async () => ({
        pages: (await meta.getManagedPages(accessToken)).map((p) => ({ id: p.id, name: p.name })),
      })),
    probeInstagramLimit: (accessToken, igUserId) =>
      withTransientRetry(() => meta.getInstagramPublishingLimit(accessToken, igUserId)),
    computeYouTubeQuota: (userId) => computeYouTubeQuotaSummary(admin, userId),
  };
}

/**
 * Merges injected probes over the real defaults. When every probe is
 * injected (tests), the real platform modules and the service-role client
 * are never imported — no network, no env needed.
 */
async function resolveProbes(overrides?: ChannelProbes): Promise<Required<ChannelProbes>> {
  if (
    overrides?.probeYouTube &&
    overrides?.probeMetaPages &&
    overrides?.probeInstagramLimit &&
    overrides?.computeYouTubeQuota
  ) {
    return overrides as Required<ChannelProbes>;
  }
  const defaults = await defaultProbes();
  return { ...defaults, ...(overrides ?? {}) };
}

export interface HealthCheckResult {
  connection: ChannelConnection;
  /** Fresh quota when the check produced one, otherwise null. */
  quota: YouTubeQuotaSummary | { quotaUsage: number | null; quotaTotal: number | null } | null;
}

/**
 * Health-checks one registry row and persists the outcome:
 * - YouTube: channels.list mine=true. Revoked grant → status 'expired';
 *   other failures → 'degraded' with last_error. Also refreshes the D65
 *   quota summary into the row's quota jsonb.
 * - Facebook: /me/accounts still lists the Page → healthy, else expired.
 * - Instagram: Page healthy AND the IG publishing limit is readable;
 *   the limit is stored in quota jsonb (read at runtime, never hardcoded —
 *   D70).
 */
export async function checkChannelHealth(
  client: RegistryClient,
  userId: string,
  connectionId: string,
  probes?: ChannelProbes,
): Promise<HealthCheckResult> {
  const { data: row, error } = await client
    .from("channel_connections")
    .select("*")
    .eq("id", connectionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !row) throw new Error("Channel not found.");
  const connection = row as ChannelConnection;
  const p = await resolveProbes(probes);
  const nowIso = new Date().toISOString();

  let status: ChannelStatus = "healthy";
  let lastError: string | null = null;
  // Fresh quota when the platform reports one; otherwise the write below
  // keeps the row's stored snapshot.
  let quota: YouTubeQuotaSummary | { quotaUsage: number | null; quotaTotal: number | null } | null =
    null;

  try {
    if (connection.platform === "youtube") {
      const yt = await import("@/lib/youtube.server");
      const { data: tokenRow } = await client
        .from("youtube_connections")
        .select("id, access_token, refresh_token, expires_at")
        .eq("user_id", userId)
        .maybeSingle();
      if (!tokenRow) throw new Error("No YouTube connection stored — connect the channel first.");
      // Refresh-aware: an expired access token with a valid refresh token
      // must not be misreported as expired/degraded.
      const { accessToken, refreshed } = await yt.getValidAccessToken({
        access_token: tokenRow.access_token ?? null,
        refresh_token: tokenRow.refresh_token ?? null,
        expires_at: tokenRow.expires_at ?? null,
      });
      if (refreshed?.access_token) {
        // Persist the refreshed encrypted tokens so the next check (and
        // publish path) starts from a valid grant.
        await client
          .from("youtube_connections")
          .update({
            access_token: await yt.encryptToken(refreshed.access_token),
            refresh_token: refreshed.refresh_token
              ? await yt.encryptToken(refreshed.refresh_token)
              : tokenRow.refresh_token,
            expires_at: new Date(Date.now() + (refreshed.expires_in ?? 3500) * 1000).toISOString(),
            updated_at: nowIso,
          })
          .eq("id", tokenRow.id)
          .eq("user_id", userId);
      }
      const channel = await p.probeYouTube(accessToken);
      if (!channel.id) {
        status = "degraded";
        lastError = "YouTube did not return the channel — the grant may be limited.";
      } else if (channel.id !== connection.external_channel_id) {
        status = "degraded";
        lastError = "The connected channel changed since registration.";
      }
      quota = await p.computeYouTubeQuota(userId);
    } else if (connection.platform === "facebook" || connection.platform === "instagram") {
      const meta = await import("@/lib/meta-publish.server");
      const { data: tokenRow } = await client
        .from("meta_connections")
        .select("access_token")
        .eq("user_id", userId)
        .maybeSingle();
      const accessToken = await meta.decryptMetaToken(tokenRow?.access_token ?? null);
      if (!accessToken) throw new Error("No Meta credentials stored — reconnect the account.");
      const { pages } = await p.probeMetaPages(accessToken);
      const pageId =
        connection.platform === "facebook" ? connection.external_channel_id : null;
      // For instagram rows we resolve the owning Page through meta_connections.
      const pageStillThere =
        pageId != null
          ? pages.some((pg) => pg.id === pageId)
          : pages.length > 0;
      if (!pageStillThere) {
        status = "expired";
        lastError = "The Page is no longer accessible with this grant — reconnect.";
      } else if (connection.platform === "instagram") {
        const limit = await p.probeInstagramLimit(accessToken, connection.external_channel_id);
        quota = { quotaUsage: limit.quotaUsage, quotaTotal: limit.quotaTotal };
      }
    } else {
      status = "degraded";
      lastError = `Health checks are not implemented for platform "${connection.platform}" yet.`;
    }
  } catch (err) {
    // A dead grant (401/invalid_grant at Google, revoked Meta app) is
    // 'expired', not 'degraded': the user must reconnect, not wait.
    const message = err instanceof Error ? err.message : String(err);
    if (/revoked|invalid_grant|401|expired/i.test(message)) {
      status = "expired";
    } else {
      status = "degraded";
    }
    lastError = message.slice(0, 300);
  }

  const health = { last_check_at: nowIso, last_error: lastError };
  const quotaForRow: Record<string, string | number | boolean | null> = {
    ...(connection.quota ?? {}),
  };
  if (quota) Object.assign(quotaForRow, quota);
  const { data: updated, error: updateError } = await client
    .from("channel_connections")
    .update({ status, health, quota: quotaForRow, last_sync_at: nowIso, updated_at: nowIso })
    .eq("id", connection.id)
    .eq("user_id", userId)
    .select()
    .single();
  if (updateError || !updated) {
    throw new Error(`Could not save the health check: ${updateError?.message ?? "unknown error"}`);
  }
  return { connection: updated as ChannelConnection, quota };
}
