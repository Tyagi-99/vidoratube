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
  /**
   * Sprint 7–8: the publish_jobs row being executed. When present, the
   * adapter re-checks the human-approval record immediately before
   * uploading — a second layer under workstream C's server-enforced
   * approvals table (checked in runExecutePublishJob before this runs).
   */
  publishJobId?: string | undefined;
  /** Project id for quota/cost attribution, when the caller knows one. */
  projectId?: string | null | undefined;
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
    hasPublishScopes,
    encryptToken,
  } = await import("./youtube.server");
  const {
    assertYouTubePublishingEnabled,
    assertYouTubeChannelAllowed,
    assertPublishJobApproved,
  } = await import("./publishing-gates.server");
  const { recordYouTubeQuota } = await import("./api-cost");

  const { data: connection } = await admin
    .from("youtube_connections")
    .select("*")
    .eq("user_id", input.userId)
    .maybeSingle();
  if (!connection) throw new Error("Connect your YouTube channel first.");
  if (!hasPublishScopes(connection.scope)) {
    throw new Error(
      "YouTube publish permissions are missing or incomplete. Grant them to publish.",
    );
  }

  // Sprint 7–8 TEST-CHANNEL GATE: uploads go ONLY to the founder-designated
  // test channel. Checked before any token refresh, network call, or quota
  // spend — unset config disables publishing outright (fail closed).
  assertYouTubePublishingEnabled();
  assertYouTubeChannelAllowed(connection.channel_id);

  // Approval re-check (adapter-level second layer): when executed through a
  // publish job, the human-approval record must be present RIGHT NOW.
  if (input.publishJobId) {
    const { data: publishJob } = await admin
      .from("publish_jobs")
      .select("status, approved_by, approved_at")
      .eq("id", input.publishJobId)
      .eq("user_id", input.userId)
      .maybeSingle();
    assertPublishJobApproved(publishJob);
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
  // Quota: videos.insert lives in its own 100-calls/day bucket (1/call).
  await recordYouTubeQuota(admin, {
    userId: input.userId,
    projectId: input.projectId ?? null,
    operation: "videos.insert",
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
    // Quota: videos.update costs 50 units from the shared pool.
    await recordYouTubeQuota(admin, {
      userId: input.userId,
      projectId: input.projectId ?? null,
      operation: "videos.update",
    });
  }

  return { videoId };
}

/** Sets a video's scheduled publish time (video must be private/unlisted). */
async function setScheduledPublishTime(
  accessToken: string,
  videoId: string,
  publishAt: string,
): Promise<void> {
  const { withTransientRetry } = await import("./publish/retry");
  await withTransientRetry(async () => {
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
  });
}

export interface RemoteVideoMetadata {
  videoId: string;
  channelId: string | null;
  title: string;
  description: string;
  privacyStatus: string | null;
}

/**
 * Phase 4, Stream A — fetches the CURRENT remote title/description for a
 * video. Used by the metadata-overwrite flow: the UI shows the diff between
 * this and the proposed values, and the update requires an explicit human
 * confirm against a hash of this snapshot. Transient failures retried.
 */
export async function fetchRemoteVideoMetadata(
  accessToken: string,
  videoId: string,
): Promise<RemoteVideoMetadata> {
  const { withTransientRetry } = await import("./publish/retry");
  return withTransientRetry(async () => {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,status&id=${encodeURIComponent(videoId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      throw new Error(
        `YouTube rejected the metadata read (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`,
      );
    }
    const payload = (await res.json()) as {
      items?: {
        id?: string;
        snippet?: { channelId?: string; title?: string; description?: string };
        status?: { privacyStatus?: string };
      }[];
    };
    const item = payload.items?.[0];
    if (!item) throw new Error("YouTube has no video with that id on this channel.");
    return {
      videoId,
      channelId: item.snippet?.channelId ?? null,
      title: item.snippet?.title ?? "",
      description: item.snippet?.description ?? "",
      privacyStatus: item.status?.privacyStatus ?? null,
    };
  });
}

export interface UpdateRemoteMetadataInput {
  accessToken: string;
  videoId: string;
  title: string;
  description: string;
}

/**
 * Phase 4, Stream A — overwrites a video's title/description via
 * videos.update. Callers MUST have shown the remote-vs-proposed diff and
 * collected an explicit human confirm (see metadata.functions.ts) — this
 * function performs the write, never the confirmation. Transient failures
 * retried; the caller records quota + audit.
 */
export async function updateRemoteVideoMetadata(
  input: UpdateRemoteMetadataInput,
): Promise<void> {
  const { withTransientRetry } = await import("./publish/retry");
  await withTransientRetry(async () => {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: input.videoId,
        snippet: { title: input.title.slice(0, 100), description: input.description.slice(0, 5000) },
      }),
    });
    if (!res.ok) {
      throw new Error(
        `YouTube rejected the metadata update (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`,
      );
    }
  });
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
  // Sprint 7–8 TEST-CHANNEL GATE first: fail before any DB I/O or network.
  const { assertYouTubePublishingEnabled, assertYouTubeChannelAllowed } = await import(
    "./publishing-gates.server"
  );
  assertYouTubePublishingEnabled();

  const { getValidAccessToken, hasPublishScopes } = await import("./youtube.server");
  const { recordYouTubeQuota } = await import("./api-cost");

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
  if (!connection || !hasPublishScopes(connection.scope)) {
    throw new Error("YouTube publish permissions are missing or incomplete.");
  }
  // The thumbnail lands on the same test channel the video went to.
  assertYouTubeChannelAllowed(connection.channel_id);
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

  // Quota: thumbnails.set costs 50 units from the shared pool.
  await recordYouTubeQuota(admin, {
    userId: input.userId,
    projectId: null,
    operation: "thumbnails.set",
  });
}
