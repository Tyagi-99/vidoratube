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
    return { ok: true };
  });

const publishToMetaSchema = z.object({
  publish_job_id: z.string().uuid(),
  targets: z.array(z.enum(["facebook", "instagram"])).min(1).max(2),
});

/**
 * Executes an approved publish job to the Meta test accounts.
 *
 * Guards, in order: job exists + owned; status approved/scheduled (drafts can
 * never execute); scheduled jobs only when due; human-approval record present
 * (assertPublishJobApproved — integration point for the sibling workstream's
 * server-enforced approvals table); atomic claim to "uploading"; per-platform
 * test-account match; adapter publish; result columns recorded.
 */
export const publishJobToMeta = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((input: unknown) => publishToMetaSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const {
      assertPublishJobApproved,
      assertMetaPublishingEnabled,
      TestAccountMismatchError,
    } = await import("./publishing-gates.server");
    const {
      decryptMetaToken,
      publishFacebookPageVideo,
      publishInstagramReel,
      publicVideoUrl,
    } = await import("./meta-publish.server");

    const { data: job } = await supabase
      .from("publish_jobs")
      .select("*")
      .eq("id", data.publish_job_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!job) throw new Error("Publish job not found");
    assertPublishJobApproved(job);
    if (
      job.status === "scheduled" &&
      job.scheduled_for &&
      new Date(job.scheduled_for).getTime() > Date.now()
    ) {
      throw new Error("This job is scheduled for later — it will publish at its scheduled time.");
    }
    if (!job.video_job_id) throw new Error("Publish job has no video attached.");

    // Atomic claim against double-execution.
    const { data: claimed } = await supabase
      .from("publish_jobs")
      .update({ status: "uploading" })
      .eq("id", job.id)
      .in("status", ["approved", "scheduled"])
      .select()
      .maybeSingle();
    if (!claimed) throw new Error("This job is already being published.");

    try {
      const { data: connection } = await supabaseAdmin
        .from("meta_connections")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (!connection) throw new Error("Connect your Meta account first.");
      const pageAccessToken = await decryptMetaToken(connection.access_token);
      if (!pageAccessToken) throw new Error("The Meta connection lost its credentials — please reconnect.");

      // Defense in depth: the adapter gates again on the env test ids, but
      // refuse early here when the STORED connection isn't the test account.
      if (data.targets.includes("facebook")) {
        const testPageId = assertMetaPublishingEnabled("facebook");
        if (connection.page_id !== testPageId) {
          throw new TestAccountMismatchError(
            "The connected Facebook Page is not the founder-designated test Page.",
          );
        }
      }
      if (data.targets.includes("instagram")) {
        const testIgId = assertMetaPublishingEnabled("instagram");
        if (!connection.ig_user_id || connection.ig_user_id !== testIgId) {
          throw new TestAccountMismatchError(
            "The connected Instagram account is not the founder-designated test account.",
          );
        }
      }

      const videoUrl = await publicVideoUrl(supabaseAdmin, userId, job.video_job_id);
      const title = job.title ?? "Vidora video";
      const description = job.description ?? "";
      const results: { facebook?: { postId: string }; instagram?: { mediaId: string; permalink: string | null } } = {};

      if (data.targets.includes("facebook")) {
        const testPageId = assertMetaPublishingEnabled("facebook");
        const { videoId } = await publishFacebookPageVideo({
          pageAccessToken,
          pageId: testPageId,
          videoUrl,
          title,
          description,
          scheduledFor: job.scheduled_for,
        });
        results.facebook = { postId: videoId };
      }

      if (data.targets.includes("instagram")) {
        const testIgId = assertMetaPublishingEnabled("instagram");
        const caption = [title, description].filter(Boolean).join("\n\n").slice(0, 2200);
        const { mediaId } = await publishInstagramReel(
          { accessToken: pageAccessToken, igUserId: testIgId, videoUrl, caption },
        );
        // Permalink is nice-to-have: never fail the publish over it.
        let permalink: string | null = null;
        try {
          const res = await fetch(
            `https://graph.facebook.com/v26.0/${mediaId}?fields=permalink&access_token=${encodeURIComponent(pageAccessToken)}`,
          );
          const payload = (await res.json().catch(() => ({}))) as { permalink?: string };
          if (res.ok && payload.permalink) permalink = payload.permalink;
        } catch {
          /* ignore */
        }
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
  });
