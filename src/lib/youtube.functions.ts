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
    const { youtubeConfigured } = await import("./youtube.server");
    const { data } = await context.supabase
      .from("youtube_connections")
      .select("channel_id, channel_title, created_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    return { configured: youtubeConfigured(), connection: data ?? null };
  });

/** Returns the Google consent URL the user should be sent to. */
export const startYouTubeConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { googleCredentials, redirectUri, signState, YOUTUBE_SCOPES } = await import(
      "./youtube.server"
    );
    const { clientId } = googleCredentials();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri(origin()),
      response_type: "code",
      scope: YOUTUBE_SCOPES,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state: await signState(context.userId),
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
  });

export const disconnectYouTube = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
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
});

export const publishJobToYouTube = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => publishSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { refreshAccessToken, uploadToYouTube } = await import("./youtube.server");
    const { downloadStoredVideo } = await import("./render.server");
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

    const { data: connection } = await supabaseAdmin
      .from("youtube_connections")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (!connection) throw new Error("Connect your YouTube channel first.");

    await supabase
      .from("video_jobs")
      .update({ youtube_status: "uploading" })
      .eq("id", job.id);

    try {
      const tokens = await refreshAccessToken(connection.refresh_token);
      if (!tokens.access_token) throw new Error("Could not refresh the YouTube token.");

      const video = await downloadStoredVideo(supabaseAdmin, job.id, userId);
      const videoId = await uploadToYouTube({
        accessToken: tokens.access_token,
        video,
        title: data.title ?? job.title ?? "Vidora video",
        description: data.description ?? job.narration ?? "",
        privacyStatus: data.privacy,
        tags: ["vidora", job.format].filter(Boolean) as string[],
      });

      await supabaseAdmin
        .from("youtube_connections")
        .update({
          access_token: tokens.access_token,
          expires_at: new Date(Date.now() + (tokens.expires_in ?? 3500) * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);

      const { data: updated } = await supabase
        .from("video_jobs")
        .update({ youtube_video_id: videoId, youtube_status: "published" })
        .eq("id", job.id)
        .select()
        .single();

      return { videoId, url: `https://youtu.be/${videoId}`, job: updated };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      await supabase
        .from("video_jobs")
        .update({ youtube_status: `failed: ${message}`.slice(0, 200) })
        .eq("id", job.id);
      throw new Error(message);
    }
  });
