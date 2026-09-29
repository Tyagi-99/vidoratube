import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/server-auth";

/**
 * Sprint 7–8 (workstream A): Meta (Facebook/Instagram) server functions.
 *
 * Connect/disconnect mirrors the YouTube flow (Facebook Login -> long-lived
 * Page token -> stored encrypted). Publishing executes an APPROVED publish job
 * through the Meta adapters — every adapter call is gated to the
 * founder-designated test accounts (publishing-gates.server.ts) and re-checks
 * the human-approval record before executing.
 */

function origin(): string {
  return new URL(getRequest().url).origin;
}

export const getMetaConnection = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .handler(async ({ context }) => {
    const { metaConfigured } = await import("./meta-publish.server");
    const { data } = await context.supabase
      .from("meta_connections")
      .select("page_id, page_name, ig_user_id, ig_username, created_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    return {
      configured: metaConfigured(),
      connection: data ?? null,
    };
  });

/**
 * Returns the Facebook Login URL for the connect flow. Requests the minimum
 * publish permission set; the callback verifies the connected Page/IG account
 * against the founder-designated test accounts before storing anything.
 */
export const startMetaConnect = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { enforcePostgresRateLimit } = await import("./rate-limit");
    await enforcePostgresRateLimit(
      supabaseAdmin,
      `meta:connect:${context.userId}`,
      { max: 5, windowSeconds: 3600 },
      "Too many Meta connection attempts. Please wait a bit and try again.",
    );
    const { metaCredentials, signMetaState, buildMetaLoginUrl } = await import(
      "./meta-publish.server"
    );
    const { appId } = metaCredentials();
    const state = await signMetaState(context.userId);
    const url = buildMetaLoginUrl({ appId, origin: origin(), state });
    return { url };
  });

export const disconnectMeta = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .handler(async ({ context }) => {
    // Meta has no single revoke endpoint for Page tokens; deleting the row
    // removes Vidora's copy. The founder can also remove the app at
    // facebook.com > Settings > Business integrations.
    const { error } = await context.supabase
      .from("meta_connections")
      .delete()
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    // Phase 4, Stream A (F27): registry rows keep the audit trail but are
    // marked revoked so health/quota reads treat them as disconnected.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { revokeChannelRegistrations } = await import("./publish/channels.server");
    await revokeChannelRegistrations(supabaseAdmin, context.userId, "facebook");
    await revokeChannelRegistrations(supabaseAdmin, context.userId, "instagram");
    return { ok: true };
  });

const publishToMetaSchema = z.object({
  publish_job_id: z.string().uuid(),
  targets: z.array(z.enum(["facebook", "instagram"])).min(1).max(2),
});

/**
 * Executes an approved publish job to the Meta test accounts.
 *
 * Guards, in order (mirroring runExecutePublishJob's hard requirements):
 * 1. job exists + owned; status approved/scheduled (drafts can never execute);
 *    scheduled jobs only when due; made-for-kids confirmation present.
 * 2. the attached video job finished rendering with a result_url.
 * 3. HARD 1: an unforgeable human-approval RECORD exists in the approvals
 *    table for this exact job (requirePublishApproval). The approvals table
 *    has no client write policies, so a forged publish_jobs row (client-side
 *    UPDATE of approved_by/approved_at, which the publish_jobs RLS policy
 *    permits) can never satisfy this. P0 fix 2026-09-29.
 * 4. HARD 2: the CURRENT latest safety score is re-checked — < 50 BLOCKS
 *    public; private/unlisted proceed with a recorded warning. P1 fix.
 * 5. HARD 3: the strict evidence gate is re-checked at execution time. P1 fix.
 * 6. atomic claim to "uploading"; per-platform test-account match; adapter
 *    publish; result columns recorded. Gates run BEFORE the claim, so a gate
 *    failure leaves the job approved (not stuck in failed). P2 fix.
 */
export const publishJobToMeta = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((input: unknown) => publishToMetaSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return runPublishJobToMeta({
      supabase,
      supabaseAdmin,
      userId,
      publishJobId: data.publish_job_id,
      targets: data.targets,
    });
  });

/** Platform upload for Meta, injectable so tests can prove the gates without uploading. */
export interface MetaPublishUploader {
  getConnection: (admin: any, userId: string) => Promise<any | null>;
  decryptToken: (ciphertext: string) => Promise<string | null>;
  assertTargetEnabled: (target: "facebook" | "instagram") => string;
  videoUrl: (admin: any, userId: string, videoJobId: string) => Promise<string>;
  publishFacebook: (input: {
    pageAccessToken: string;
    pageId: string;
    videoUrl: string;
    title: string;
    description: string;
    scheduledFor: string | null;
  }) => Promise<{ videoId: string }>;
  publishInstagram: (input: {
    accessToken: string;
    igUserId: string;
    videoUrl: string;
    caption: string;
  }) => Promise<{ mediaId: string; permalink: string | null }>;
}

async function defaultMetaUploader(): Promise<MetaPublishUploader> {
  const { assertMetaPublishingEnabled } = await import("./publishing-gates.server");
  const {
    decryptMetaToken,
    publishFacebookPageVideo,
    publishInstagramReel,
    publicVideoUrl,
  } = await import("./meta-publish.server");
  return {
    getConnection: async (admin: any, userId: string) => {
      const { data } = await admin
        .from("meta_connections")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      return data ?? null;
    },
    decryptToken: decryptMetaToken,
    assertTargetEnabled: assertMetaPublishingEnabled,
    videoUrl: publicVideoUrl,
    publishFacebook: async (input) => {
      const { videoId } = await publishFacebookPageVideo({
        pageAccessToken: input.pageAccessToken,
        pageId: input.pageId,
        videoUrl: input.videoUrl,
        title: input.title,
        description: input.description,
        scheduledFor: input.scheduledFor,
      });
      return { videoId };
    },
    publishInstagram: async (input) => {
      const { mediaId } = await publishInstagramReel({
        accessToken: input.accessToken,
        igUserId: input.igUserId,
        videoUrl: input.videoUrl,
        caption: input.caption,
      });
      // Permalink is nice-to-have: never fail the publish over it.
      let permalink: string | null = null;
      try {
        const res = await fetch(
          `https://graph.facebook.com/v26.0/${mediaId}?fields=permalink&access_token=${encodeURIComponent(input.accessToken)}`,
        );
        const payload = (await res.json().catch(() => ({}))) as { permalink?: string };
        if (res.ok && payload.permalink) permalink = payload.permalink;
      } catch {
        /* ignore */
      }
      return { mediaId, permalink };
    },
  };
}

/**
 * Core of publishJobToMeta, exported for tests. `metaUploader` defaults to
 * the real Meta adapters; tests inject a mock.
 */
export async function runPublishJobToMeta({  supabase,
  supabaseAdmin,
  userId,
  publishJobId,
  targets,
  metaUploader,
}: {
  supabase: any;
  supabaseAdmin: any;
  userId: string;
  publishJobId: string;
  targets: Array<"facebook" | "instagram">;
  metaUploader?: MetaPublishUploader;
}): Promise<{
  results: { facebook?: { postId: string }; instagram?: { mediaId: string; permalink: string | null } };
  publishJob: any;
}> {
  const { data: job } = await supabase
    .from("publish_jobs")
    .select("*")
    .eq("id", publishJobId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!job) throw new Error("Publish job not found");
  if (!["approved", "scheduled"].includes(job.status)) {
    throw new Error(`Job is not ready to publish (current: ${job.status}).`);
  }
  if (
    job.status === "scheduled" &&
    job.scheduled_for &&
    new Date(job.scheduled_for).getTime() > Date.now()
  ) {
    throw new Error("This job is scheduled for later — it will publish at its scheduled time.");
  }
  if (job.made_for_kids === null || job.made_for_kids === undefined) {
    throw new Error("Please confirm whether this video is made for kids.");
  }
  if (!job.video_job_id) throw new Error("Publish job has no video attached.");

  // The attached video must have finished rendering — never publish a
  // half-rendered or missing output (P2 fix 2026-09-29).
  const { data: videoJob } = await supabaseAdmin
    .from("video_jobs")
    .select("id, status, result_url")
    .eq("id", job.video_job_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!videoJob || videoJob.status !== "completed" || !videoJob.result_url) {
    throw new Error("The attached video has not finished rendering yet.");
  }

  const {
    requirePublishApproval,
    approvalScopeForPrivacy,
    recordPublishWarning,
  } = await import("./publish-approval");
  const {
    evaluatePublishGate,
    lowScoreWarningMessage,
    publishBlockedMessage,
  } = await import("./safety");
  const { assertPublishStrictGate } = await import("./publish.functions");

  // HARD REQUIREMENT 1: a human approval record must exist for this job.
  // This is the P0 fix: assertPublishJobApproved only inspected the job row,
  // whose approved_by/approved_at columns the client can forge via RLS.
  // The approvals table has no client write policies.
  // NOTE: approvals are recorded per job with the privacy-derived scope by
  // approvePublishJob; Meta publishing requires that same record (the job was
  // human-approved for publishing). Per-platform (facebook/instagram) scope
  // recording is follow-up work — the approvals table already supports the
  // scopes, the approval flow just doesn't write them yet.
  await requirePublishApproval(supabaseAdmin, {
    userId,
    publishJobId: job.id,
    scope: approvalScopeForPrivacy(job.privacy),
  });

  // HARD REQUIREMENT 2: re-check the CURRENT latest safety score.
  const { data: latestScore } = await supabaseAdmin
    .from("safety_scores")
    .select("score")
    .eq("project_id", job.project_id)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const execGate = evaluatePublishGate(latestScore?.score ?? null, job.privacy as "public" | "unlisted" | "private");
  if (execGate.blocked) {
    throw new Error(publishBlockedMessage(execGate.score as number));
  }
  const execWarning = execGate.warning ? lowScoreWarningMessage(execGate.score as number) : null;
  if (execWarning) {
    await recordPublishWarning(supabaseAdmin, {
      userId,
      projectId: job.project_id,
      publishJobId: job.id,
      kind: "safety-low-score",
      message: execWarning,
    });
  }

  // HARD REQUIREMENT 3: re-check the strict evidence gate at execution time.
  await assertPublishStrictGate(supabase, userId, job.project_id);

  // Atomic claim against double-execution — AFTER the gates, so a gate
  // failure leaves the job approved instead of stuck in failed (P2 fix).
  const { data: claimed } = await supabase
    .from("publish_jobs")
    .update({ status: "uploading" })
    .eq("id", job.id)
    .in("status", ["approved", "scheduled"])
    .select()
    .maybeSingle();
  if (!claimed) throw new Error("This job is already being published.");

  const up: MetaPublishUploader = metaUploader ?? (await defaultMetaUploader());

  try {
    const connection = await up.getConnection(supabaseAdmin, userId);
    if (!connection) throw new Error("Connect your Meta account first.");
    const pageAccessToken = await up.decryptToken(connection.access_token);
    if (!pageAccessToken) throw new Error("The Meta connection lost its credentials — please reconnect.");

    // Defense in depth: the adapter gates again on the env test ids, but
    // refuse early here when the STORED connection isn't the test account.
    const { TestAccountMismatchError } = await import("./publishing-gates.server");
    if (targets.includes("facebook")) {
      const testPageId = up.assertTargetEnabled("facebook");
      if (connection.page_id !== testPageId) {
        throw new TestAccountMismatchError(
          "The connected Facebook Page is not the founder-designated test Page.",
        );
      }
    }
    if (targets.includes("instagram")) {
      const testIgId = up.assertTargetEnabled("instagram");
      if (!connection.ig_user_id || connection.ig_user_id !== testIgId) {
        throw new TestAccountMismatchError(
          "The connected Instagram account is not the founder-designated test account.",
        );
      }
    }

    const videoUrl = await up.videoUrl(supabaseAdmin, userId, job.video_job_id);
    const title = job.title ?? "Vidora video";
    const description = job.description ?? "";
    const results: { facebook?: { postId: string }; instagram?: { mediaId: string; permalink: string | null } } = {};

    if (targets.includes("facebook")) {
      const testPageId = up.assertTargetEnabled("facebook");
      const { videoId } = await up.publishFacebook({
        pageAccessToken,
        pageId: testPageId,
        videoUrl,
        title,
        description,
        scheduledFor: job.scheduled_for,
      });
      results.facebook = { postId: videoId };
    }

    if (targets.includes("instagram")) {
      const testIgId = up.assertTargetEnabled("instagram");
      const caption = [title, description].filter(Boolean).join("\n\n").slice(0, 2200);
      const { mediaId, permalink } = await up.publishInstagram({
        accessToken: pageAccessToken,
        igUserId: testIgId,
        videoUrl,
        caption,
      });
      results.instagram = { mediaId, permalink };
    }

    const { data: updated } = await supabase
      .from("publish_jobs")
      .update({
        status: "published",
        published_at: new Date().toISOString(),
        meta_fb_post_id: results.facebook?.postId ?? null,
        meta_ig_media_id: results.instagram?.mediaId ?? null,
        meta_ig_permalink: results.instagram?.permalink ?? null,
      })
      .eq("id", job.id)
      .select()
      .single();
    return { results, publishJob: updated };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Meta publish failed";
    await supabase
      .from("publish_jobs")
      .update({ status: "failed", error: message.slice(0, 500) })
      .eq("id", job.id);
    throw error instanceof Error ? error : new Error(message);
  }
}
