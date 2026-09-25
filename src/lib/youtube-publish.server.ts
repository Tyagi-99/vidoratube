import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * P5: YouTube publish execution for publish_jobs.
 * Reuses the resumable uploader from youtube.server.ts; adds scheduling
 * (publishAt) and thumbnail setting (thumbnails.set).
 */

export interface PublishVideoInput {
  userId: string;
  videoJobId: string;
  title: string;
  description: string;
  tags: string[];
  privacy: "private" | "unlisted" | "public";
  madeForKids: boolean;
  /** ISO datetime — YouTube holds the video private until this time. */
  publishAt?: string | null;
}

/** Uploads the rendered video for a publish job. Returns the YouTube video id. */
export async function publishVideoJob(
  admin: SupabaseClient<Database>,
  input: PublishVideoInput,
): Promise<{ videoId: string }> {
  const {
    getValidAccessToken,
    streamStoredVideo,
    uploadToYouTube,
    hasUploadScope,
    encryptToken,
  } = await import("./youtube.server");

  const { data: connection } = await admin
    .from("youtube_connections")
    .select("*")
    .eq("user_id", input.userId)
    .maybeSingle();
  if (!connection) throw new Error("Connect your YouTube channel first.");
  if (!hasUploadScope(connection.scope)) {
    throw new Error("YouTube upload permission is missing. Grant it to publish.");
  }

  const { accessToken, refreshed } = await getValidAccessToken(connection);
  const video = await streamStoredVideo(admin, input.videoJobId, input.userId);
  const videoId = await uploadToYouTube({
    accessToken,
    video,
    title: input.title,
    description: input.description,
    privacyStatus: input.privacy,
    madeForKids: input.madeForKids,
    tags: input.tags,
  });

  if (refreshed?.access_token) {
    await admin
      .from("youtube_connections")
      .update({
        access_token: await encryptToken(refreshed.access_token),
        expires_at: new Date(Date.now() + (refreshed.expires_in ?? 3500) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", input.userId);
  }

  // Scheduling: set publishAt so the video goes live at the chosen time.
  if (input.publishAt) {
    await setScheduledPublishTime(accessToken, videoId, input.publishAt);
  }

  return { videoId };
}

/** Sets a video's scheduled publish time (video must be private/unlisted). */
async function setScheduledPublishTime(
  accessToken: string,
  videoId: string,
  publishAt: string,
): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=status&id=${videoId}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: videoId,
        status: { privacyStatus: "private", publishAt },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `YouTube rejected the schedule (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`,
    );
  }
}

export interface SetThumbnailInput {
  userId: string;
  videoId: string;
  thumbnailId: string;
}

/**
 * Downloads the selected thumbnail (with its text overlay spec), burns the
 * overlay is expected to be pre-burned by the client and stored — this fetches
 * the final bytes from storage and calls YouTube thumbnails.set.
 *
 * The client burns the text overlay via canvas and uploads the final image
 * through `uploadFinalThumbnail`; this function reads those bytes.
 */
export async function setVideoThumbnail(
  admin: SupabaseClient<Database>,
  input: SetThumbnailInput,
): Promise<void> {
  const { getValidAccessToken, hasUploadScope } = await import("./youtube.server");

  const { data: thumb } = await admin
    .from("thumbnails")
    .select("final_url, url")
    .eq("id", input.thumbnailId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (!thumb) throw new Error("Thumbnail not found");
  const imageUrl = thumb.final_url ?? thumb.url;

  const { data: connection } = await admin
    .from("youtube_connections")
    .select("*")
    .eq("user_id", input.userId)
    .maybeSingle();
  if (!connection || !hasUploadScope(connection.scope)) {
    throw new Error("YouTube upload permission is missing.");
  }
  const { accessToken } = await getValidAccessToken(connection);

  // Fetch the image bytes via a signed URL.
  const path = imageUrl.split("/generated-videos/")[1] ?? imageUrl;
  const { data: signed, error: signError } = await admin.storage
    .from("generated-videos")
    .createSignedUrl(path, 600);
  if (signError || !signed?.signedUrl) throw new Error("Could not read the thumbnail file.");
  const img = await fetch(signed.signedUrl);
  if (!img.ok) throw new Error("Could not download the thumbnail file.");
  const bytes = new Uint8Array(await img.arrayBuffer());

  const res = await fetch(
    `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${input.videoId}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "image/jpeg",
      },
      body: bytes as unknown as BodyInit,
    },
  );
  if (!res.ok) {
    throw new Error(
      `YouTube rejected the thumbnail (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`,
    );
  }
}
