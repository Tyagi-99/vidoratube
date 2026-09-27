import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "@/lib/server-auth";

/**
 * Phase 4, Stream A — YouTube live-metadata overwrite flow (D140).
 *
 * Never silently overwrite live metadata:
 *   1. `getYouTubeMetadataDiff` fetches the CURRENT remote title/description
 *      and returns it alongside the proposed values, a `changed` flag, and a
 *      `remoteHash` (SHA-256 of the remote snapshot).
 *   2. The UI shows the diff and collects an explicit human confirm.
 *   3. `updateYouTubeVideoMetadata` requires `confirmed: true` AND a
 *      `remote_hash` that still matches the live remote snapshot — a stale
 *      confirm (someone else changed the video in between) is rejected.
 *   4. The overwrite is audit-logged (publish.metadata_overwritten) and the
 *      videos.update quota (50 units, shared pool) is recorded via the Phase 2
 *      quota recorder.
 *
 * Gates: the test-channel gate applies (only the founder-designated test
 * channel), and the video's remote channelId must equal the test channel —
 * this function can never touch a video outside the test channel.
 */

const diffSchema = z.object({
  /** YouTube video id (11 chars). */
  video_id: z.string().trim().min(1).max(32),
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().max(5000).default(""),
});

export type MetadataDiffInput = z.infer<typeof diffSchema>;

export interface MetadataDiff {
  remote: { title: string; description: string; privacyStatus: string | null };
  proposed: { title: string; description: string };
  changed: boolean;
  /** SHA-256 hex of "title\ndescription" of the remote snapshot. */
  remoteHash: string;
}

/** SHA-256 hex of the remote snapshot — binds the human confirm to it. */
export async function hashRemoteMetadata(title: string, description: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${title}\n${description}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface GateContext {
  accessToken: string;
  testChannelId: string;
}

/**
 * Shared gates for the metadata flow: publishing enabled, the connected
 * channel IS the test channel, and the target video lives on the test
 * channel. Returns the access token for the platform call.
 */
export async function gateMetadataAccess(
  supabaseAdmin: any,
  userId: string,
  videoId: string,
  fetchRemote: (accessToken: string, videoId: string) => Promise<{ channelId: string | null }>,
): Promise<GateContext> {
  const {
    assertYouTubePublishingEnabled,
    assertYouTubeChannelAllowed,
    TestAccountMismatchError,
  } = await import("@/lib/publishing-gates.server");
  const { getValidAccessToken, hasPublishScopes } = await import("@/lib/youtube.server");

  const testChannelId = assertYouTubePublishingEnabled();
  const { data: connection } = await supabaseAdmin
    .from("youtube_connections")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (!connection || !hasPublishScopes(connection.scope)) {
    throw new Error("YouTube publish permissions are missing or incomplete. Grant them first.");
  }
  assertYouTubeChannelAllowed(connection.channel_id);
  const { accessToken } = await getValidAccessToken(connection);

  // The video itself must live on the test channel — never touch a video
  // that belongs to another channel, even with a valid token.
  const remote = await fetchRemote(accessToken, videoId);
  if (remote.channelId !== testChannelId) {
    throw new TestAccountMismatchError(
      "That video does not belong to the designated test channel — the metadata update was refused.",
    );
  }
  return { accessToken, testChannelId };
}

/**
 * Fetches the live remote metadata and returns the diff against the proposed
 * values. Read-only: shows what WOULD change.
 */
export const getYouTubeMetadataDiff = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((input: unknown) => diffSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { fetchRemoteVideoMetadata } = await import("@/lib/youtube-publish.server");
    const { accessToken } = await gateMetadataAccess(
      supabaseAdmin,
      context.userId,
      data.video_id,
      fetchRemoteVideoMetadata,
    );
    const remote = await fetchRemoteVideoMetadata(accessToken, data.video_id);
    const changed = remote.title !== data.title || remote.description !== data.description;
    const diff: MetadataDiff = {
      remote: {
        title: remote.title,
        description: remote.description,
        privacyStatus: remote.privacyStatus,
      },
      proposed: { title: data.title, description: data.description },
      changed,
      remoteHash: await hashRemoteMetadata(remote.title, remote.description),
    };
    return diff;
  });

export const updateSchema = diffSchema.extend({
  /**
   * The publish job this overwrite belongs to. A live-metadata overwrite is
   * a publishing mutation, so it requires an approved job (same gate as
   * every upload path): the video must belong to the job (youtube_video_id
   * match) so one job's approval can't be reused for another video.
   */
  publish_job_id: z.string().uuid(),
  /** Explicit human confirm — must be true, never defaulted. */
  confirmed: z.literal(true, {
    errorMap: () => ({ message: "You must explicitly confirm the metadata overwrite." }),
  }),
  /** Hash of the remote snapshot the human confirmed against. */
  remote_hash: z.string().length(64),
});

export type MetadataUpdateInput = z.infer<typeof updateSchema>;

/**
 * Core of updateYouTubeVideoMetadata, exported for tests. `deps` injects the
 * platform calls so tests never touch the network.
 */
export async function runUpdateYouTubeVideoMetadata({
  supabaseAdmin,
  userId,
  input,
  deps,
}: {
  supabaseAdmin: any;
  userId: string;
  input: MetadataUpdateInput;
  deps: {
    fetchRemote: (accessToken: string, videoId: string) => Promise<{
      channelId: string | null;
      title: string;
      description: string;
    }>;
    applyUpdate: (args: { accessToken: string; videoId: string; title: string; description: string }) => Promise<void>;
  };
}): Promise<{ changed: boolean; videoId: string }> {
  // Approval gate: a live-metadata overwrite is a publishing mutation, so it
  // requires an approved publish job, and the video must be the job's video.
  const { assertPublishJobApproved } = await import("@/lib/publishing-gates.server");
  const { data: job } = await supabaseAdmin
    .from("publish_jobs")
    .select("id, user_id, status, approved_by, approved_at, youtube_video_id")
    .eq("id", input.publish_job_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!job) throw new Error("Publish job not found.");
  assertPublishJobApproved(job);
  if (job.youtube_video_id && job.youtube_video_id !== input.video_id) {
    throw new Error("That video doesn't belong to the approved publish job.");
  }
  if (!job.youtube_video_id) {
    throw new Error("The publish job has no published YouTube video to update.");
  }

  const { accessToken } = await gateMetadataAccess(supabaseAdmin, userId, input.video_id, deps.fetchRemote);

  // Re-read the remote snapshot and verify the confirm is still fresh: if
  // the live metadata changed since the human saw the diff, refuse.
  const current = await deps.fetchRemote(accessToken, input.video_id);
  const currentHash = await hashRemoteMetadata(current.title, current.description);
  if (currentHash !== input.remote_hash) {
    throw new Error(
      "The live video metadata changed since you reviewed the diff. Please review the new diff and confirm again.",
    );
  }
  if (current.title === input.title && current.description === input.description) {
    return { changed: false, videoId: input.video_id };
  }

  await deps.applyUpdate({
    accessToken,
    videoId: input.video_id,
    title: input.title,
    description: input.description,
  });

  // Quota: videos.update costs 50 units from the shared pool (D65).
  const { recordYouTubeQuota } = await import("@/lib/api-cost");
  await recordYouTubeQuota(supabaseAdmin, {
    userId,
    projectId: null,
    operation: "videos.update",
  });

  // Audit-logged: the confirmed overwrite, with before/after.
  const { auditPublishEvent } = await import("./audit");
  await auditPublishEvent({
    workspaceId: null,
    actorUserId: userId,
    action: "publish.metadata_overwritten",
    entityType: "youtube_video",
    entityId: input.video_id,
    metadata: {
      remote_title: current.title,
      new_title: input.title,
      description_changed: current.description !== input.description,
      remote_hash: input.remote_hash,
    },
  });

  return { changed: true, videoId: input.video_id };
}

/**
 * Overwrites a test-channel video's title/description. Requires the explicit
 * human confirm (`confirmed: true`) bound to the exact remote snapshot the
 * human reviewed (`remote_hash`); stale confirms are rejected. Audit-logged.
 */
export const updateYouTubeVideoMetadata = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((input: unknown) => updateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { fetchRemoteVideoMetadata, updateRemoteVideoMetadata } = await import(
      "@/lib/youtube-publish.server"
    );
    return runUpdateYouTubeVideoMetadata({
      supabaseAdmin,
      userId: context.userId,
      input: data,
      deps: {
        fetchRemote: fetchRemoteVideoMetadata,
        applyUpdate: updateRemoteVideoMetadata,
      },
    });
  });
