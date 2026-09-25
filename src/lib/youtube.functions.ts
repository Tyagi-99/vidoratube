import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
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
 * Returns the consent URL that grants the upload scope on top of whatever the
 * user already granted (include_granted_scopes=true). Called when the user
 * first clicks Publish on a connection that only has read-only access.
 */
export const requestUploadScope = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { googleCredentials, signState, buildConsentUrl, YOUTUBE_UPLOAD_SCOPE } = await import(
      "./youtube.server"
    );
    const { clientId } = googleCredentials();
    const { state, challenge } = await signState(context.userId, "upload");
    const url = buildConsentUrl({
      clientId,
      origin: origin(),
      state,
      challenge,
      scopes: YOUTUBE_UPLOAD_SCOPE,
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
    return { ok: true };
  });

const publishSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(4900).optional(),
  privacy: z.enum(["private", "unlisted", "public"]).default("private"),
  /** Required by YouTube: the uploader's own "made for kids" declaration (COPPA). */
  madeForKids: z.boolean(),
});

export const publishJobToYouTube = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => publishSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const {
      getValidAccessToken,
      uploadToYouTube,
      streamStoredVideo,
      publishPrecheck,
      claimJobForUpload,
      encryptToken,
      hasUploadScope,
      YouTubeRevokedError,
    } = await import("./youtube.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: job } = await supabase
      .from("video_jobs")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!job) throw new Error("Video not found");
    if (job.status !== "completed" || !job.result_url) {
      throw new Error("This video hasn't finished rendering yet.");
    }

    // Idempotent publish: a job that is already published returns its video id
    // instead of uploading a duplicate; a concurrent publish is refused.
    const precheck = publishPrecheck(job);
    if (precheck.action === "return-existing") {
      return {
        videoId: precheck.videoId,
        url: `https://youtu.be/${precheck.videoId}`,
        job,
      };
    }
    if (precheck.action === "already-uploading") {
      throw new Error("This video is already being published — check YouTube shortly.");
    }
    // Atomic claim: the UPDATE only applies if the status hasn't changed since
    // we read it, so two racing publishes can't both proceed.
    const claimed = await claimJobForUpload(supabase, job.id, job.youtube_status);
    if (!claimed) {
      const { data: fresh } = await supabase
        .from("video_jobs")
        .select("youtube_status, youtube_video_id")
        .eq("id", job.id)
        .maybeSingle();
      if (fresh?.youtube_status === "published" && fresh.youtube_video_id) {
        return {
          videoId: fresh.youtube_video_id,
          url: `https://youtu.be/${fresh.youtube_video_id}`,
          job: { ...job, ...fresh },
        };
      }
      throw new Error("This video is already being published — check YouTube shortly.");
    }

    const { data: connection } = await supabaseAdmin
      .from("youtube_connections")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (!connection) throw new Error("Connect your YouTube channel first.");
    // Incremental scope: the connection may only have read-only access. The
    // client catches this and starts the upload-scope upgrade flow.
    if (!hasUploadScope(connection.scope)) {
      const error = new Error(
        "YouTube upload permission is missing. Grant it to publish.",
      ) as Error & { code?: string };
      error.code = "NEEDS_UPLOAD_SCOPE";
      throw error;
    }

    try {
      // Reuses the stored access token while valid; refreshes only when needed.
      const { accessToken, refreshed } = await getValidAccessToken(connection);

      const video = await streamStoredVideo(supabaseAdmin, job.id, userId);
      const videoId = await uploadToYouTube({
        accessToken,
        video,
        title: data.title ?? job.title ?? "Vidora video",
        description: data.description ?? job.narration ?? "",
        privacyStatus: data.privacy,
        madeForKids: data.madeForKids,
        tags: ["vidora", job.format].filter(Boolean) as string[],
      });

      if (refreshed?.access_token) {
        await supabaseAdmin
          .from("youtube_connections")
          .update({
            access_token: await encryptToken(refreshed.access_token),
            expires_at: new Date(Date.now() + (refreshed.expires_in ?? 3500) * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", userId);
      }

      const { data: updated } = await supabase
        .from("video_jobs")
        .update({ youtube_video_id: videoId, youtube_status: "published" })
        .eq("id", job.id)
        .select()
        .single();

      return { videoId, url: `https://youtu.be/${videoId}`, job: updated };
    } catch (error) {
      // The grant is dead (user revoked at Google, or it expired): delete the
      // row so the panel stops showing "Connected" and offers a reconnect.
      if (error instanceof YouTubeRevokedError) {
        await supabaseAdmin.from("youtube_connections").delete().eq("user_id", userId);
      }
      const message = error instanceof Error ? error.message : "Upload failed";
      await supabase
        .from("video_jobs")
        .update({ youtube_status: `failed: ${message}`.slice(0, 200) })
        .eq("id", job.id);
      throw error instanceof Error ? error : new Error(message);
    }
  });
