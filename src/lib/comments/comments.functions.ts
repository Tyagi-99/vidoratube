/**
 * Phase 4 Stream D — client-facing comment intelligence server functions.
 * All endpoints require a signed-in app user; writes go through the admin
 * client with an explicit user_id guard (same pattern as
 * notifications.functions.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAppUser } from "../server-auth";

async function admin(): Promise<Pick<SupabaseClient, "from">> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as Pick<SupabaseClient, "from">;
}

interface CommentRowView {
  id: string;
  platform: string;
  author: string;
  body: string;
  like_count: number;
  published_at: string | null;
  sentiment: string | null;
  is_question: boolean;
  replied: boolean;
  metadata: Record<string, unknown> | null;
}

export const listComments = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        questionsOnly: z.boolean().default(false),
        sentiment: z.enum(["positive", "neutral", "negative", "mixed"]).optional(),
        limit: z.number().int().min(1).max(100).default(30),
      })
      .default({})
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();
    let q = db
      .from("comments")
      .select(
        "id,platform,external_comment_id,author,body,like_count,published_at,sentiment,is_question,replied,metadata,created_at",
      )
      .eq("user_id", context.userId)
      .order("published_at", { ascending: false })
      .limit(data.limit);
    if (data.questionsOnly) q = q.eq("is_question", true);
    if (data.sentiment) q = q.eq("sentiment", data.sentiment);
    const { data: rows, error } = await q;
    if (error) throw new Error((error as { message?: string }).message ?? "query failed");
    return ((rows ?? []) as CommentRowView[]).map((r) => ({
      id: r.id,
      platform: r.platform,
      author: r.author,
      body: r.body,
      like_count: r.like_count,
      published_at: r.published_at,
      sentiment: r.sentiment,
      is_question: r.is_question,
      replied: r.replied,
      draft_reply: (r.metadata?.["draft_reply"] ?? null) as {
        text: string;
        status: "draft" | "approved" | "posted";
        approved_by: string | null;
        posted_at: string | null;
      } | null,
    }));
  });

export const listIngestibleVideos = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .handler(async ({ context }) => {
    const { listIngestibleVideos } = await import("./youtube-ingest.server");
    return listIngestibleVideos(await admin(), context.userId);
  });

export const ingestComments = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ videoId: z.string().min(1).max(64) }).parse(i))
  .handler(async ({ data, context }) => {
    const { ingestYouTubeComments } = await import("./youtube-ingest.server");
    return ingestYouTubeComments(await admin(), { userId: context.userId, videoId: data.videoId });
  });

export const mineInsights = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .handler(async ({ context }) => {
    const { mineEngagementInsights } = await import("./insights.server");
    return mineEngagementInsights(await admin(), { userId: context.userId });
  });

export const listInsights = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .handler(async ({ context }) => {
    const { listEngagementInsights } = await import("./insights.server");
    return listEngagementInsights(await admin(), context.userId);
  });

export const createIdeaFromInsight = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ insightId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { createIdeaFromInsight } = await import("./insights.server");
    return createIdeaFromInsight(await admin(), {
      userId: context.userId,
      insightId: data.insightId,
    });
  });

export const saveDraftReply = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z.object({ commentId: z.string().uuid(), text: z.string().min(1).max(10000) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { createDraftReply } = await import("./drafts.server");
    return createDraftReply(await admin(), {
      userId: context.userId,
      commentId: data.commentId,
      text: data.text,
    });
  });

export const approveDraftReply = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ commentId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { approveDraftReply } = await import("./drafts.server");
    return approveDraftReply(await admin(), { userId: context.userId, commentId: data.commentId });
  });

export const postReply = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ commentId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { postApprovedReply } = await import("./drafts.server");
    return postApprovedReply(await admin(), { userId: context.userId, commentId: data.commentId });
  });
