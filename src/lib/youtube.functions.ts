import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function origin(): string {
  return new URL(getRequest().url).origin;
}

export const getYouTubeConnection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { youtubeConfigured, hasUploadScope } = await import("./youtube.server");
    const { data } = await context.supabase
      .from("youtube_connections")
      .select("channel_id, channel_title, scope, created_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    return {
      configured: youtubeConfigured(),
      connection: data
        ? {
            channel_id: data.channel_id,
            channel_title: data.channel_title,
            created_at: data.created_at,
            hasUploadScope: hasUploadScope(data.scope),
          }
        : null,
    };
  });

/**
 * Returns the Google consent URL the user should be sent to. Requests only
 * the read-only scope — the upload scope is granted incrementally at publish
 * time so connecting never asks for more than it needs.
 */
export const startYouTubeConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // 5 connect attempts per hour per user (OAuth abuse + quota protection).
    const { enforcePostgresRateLimit } = await import("./rate-limit");
    await enforcePostgresRateLimit(
      supabaseAdmin,
      `youtube:connect:${context.userId}`,
      { max: 5, windowSeconds: 3600 },
      "Too many YouTube connection attempts. Please wait a bit and try again.",
    );
    const { googleCredentials, signState, buildConsentUrl, YOUTUBE_CONNECT_SCOPES } = await import(
      "./youtube.server"
    );
    const { clientId } = googleCredentials();
    const { state, challenge } = await signState(context.userId, "connect");
    const url = buildConsentUrl({
      clientId,
      origin: origin(),
      state,
      challenge,
      scopes: YOUTUBE_CONNECT_SCOPES,
    });
    return { url };
  });

/**
 * Returns the consent URL that grants the publish scopes on top of whatever the
 * user already granted (include_granted_scopes=true). Called when the user
 * first clicks Publish on a connection that only has read-only access.
 * Requests youtube.upload (videos.insert, thumbnails.set) AND youtube.force-ssl
 * (videos.update for scheduled publishing — youtube.upload alone gets a 403).
 */
export const requestUploadScope = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { googleCredentials, signState, buildConsentUrl, YOUTUBE_PUBLISH_SCOPES } = await import(
      "./youtube.server"
    );
    const { clientId } = googleCredentials();
    const { state, challenge } = await signState(context.userId, "upload");
    const url = buildConsentUrl({
      clientId,
      origin: origin(),
      state,
      challenge,
      scopes: YOUTUBE_PUBLISH_SCOPES,
    });
    return { url };
  });

export const disconnectYouTube = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { decryptToken, revokeGoogleToken } = await import("./youtube.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Revoke the grant at Google before deleting the row. Revoke never throws;
    // the row is deleted regardless since the user asked to disconnect.
    const { data: connection } = await supabaseAdmin
      .from("youtube_connections")
      .select("refresh_token")
      .eq("user_id", context.userId)
      .maybeSingle();
    const refreshToken = await decryptToken(connection?.refresh_token ?? null);
    if (refreshToken) await revokeGoogleToken(refreshToken);
    const { error } = await context.supabase
      .from("youtube_connections")
      .delete()
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    // Phase 4, Stream A (F27): registry rows keep the audit trail but are
    // marked revoked so health/quota reads treat them as disconnected.
    const { revokeChannelRegistrations } = await import("./publish/channels.server");
    await revokeChannelRegistrations(supabaseAdmin, context.userId, "youtube");
    return { ok: true };
  });

