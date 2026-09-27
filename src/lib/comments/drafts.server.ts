/**
 * Phase 4 Stream D — draft reply state machine.
 *
 * Pinned contract (law):
 *   comments.metadata.draft_reply =
 *     { text, status: 'draft'|'approved'|'posted', approved_by, posted_at }
 *
 * Rules enforced server-side:
 *   1. A draft NEVER sends itself. createDraftReply only stores text.
 *   2. Posting requires a human approval record: postApprovedReply READS the
 *      stored status and throws unless it is exactly 'approved'.
 *   3. There is NO delete path. This module exposes no function that calls a
 *      platform comment delete, and a grep invariant (see
 *      drafts.test.ts "no platform delete code path") fails the suite if one
 *      is ever added.
 *
 * Posting uses the YouTube comments.insert API (parentId = the platform
 * comment id), which needs the youtube.force-ssl scope. If the stored grant
 * lacks it, postApprovedReply returns an honest "needs_reconnect" result —
 * it never silently drops the draft.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type AdminClient = Pick<SupabaseClient, "from">;

export type DraftStatus = "draft" | "approved" | "posted";

export interface DraftReply {
  text: string;
  status: DraftStatus;
  approved_by: string | null;
  posted_at: string | null;
}

interface CommentRow {
  id: string;
  user_id: string;
  platform: string;
  external_comment_id: string;
  replied: boolean;
  metadata: Record<string, unknown> | null;
}

function readDraft(row: CommentRow): DraftReply | null {
  const d = row.metadata?.["draft_reply"];
  if (!d || typeof d !== "object") return null;
  const r = d as Partial<DraftReply>;
  if (typeof r.text !== "string") return null;
  if (r.status !== "draft" && r.status !== "approved" && r.status !== "posted") return null;
  return {
    text: r.text,
    status: r.status,
    approved_by: typeof r.approved_by === "string" ? r.approved_by : null,
    posted_at: typeof r.posted_at === "string" ? r.posted_at : null,
  };
}

async function loadComment(
  admin: AdminClient,
  userId: string,
  commentId: string,
): Promise<CommentRow> {
  const { data, error } = (await admin
    .from("comments")
    .select("id,user_id,platform,external_comment_id,replied,metadata")
    .eq("user_id", userId)
    .eq("id", commentId)
    .single()) as { data: CommentRow | null; error: { message?: string } | null };
  if (error || !data) throw new Error("Comment not found.");
  return data;
}

async function writeDraft(admin: AdminClient, row: CommentRow, draft: DraftReply): Promise<void> {
  const { error } = await admin
    .from("comments")
    .update({
      metadata: { ...(row.metadata ?? {}), draft_reply: draft },
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (error) throw new Error((error as { message?: string }).message ?? "draft save failed");
}

/** Store (or replace) a draft reply. Never posts — drafts are inert text. */
export async function createDraftReply(
  admin: AdminClient,
  input: { userId: string; commentId: string; text: string },
): Promise<DraftReply> {
  const text = input.text.trim();
  if (!text) throw new Error("Reply text is required.");
  if (text.length > 10000) throw new Error("Reply text is too long (max 10,000 chars).");
  const row = await loadComment(admin, input.userId, input.commentId);
  const draft: DraftReply = { text, status: "draft", approved_by: null, posted_at: null };
  await writeDraft(admin, row, draft);
  return draft;
}

/**
 * Human approval. The ONLY transition into 'approved'. The approver is the
 * signed-in user — approval cannot be forged by the draft author field.
 */
export async function approveDraftReply(
  admin: AdminClient,
  input: { userId: string; commentId: string },
): Promise<DraftReply> {
  const row = await loadComment(admin, input.userId, input.commentId);
  const existing = readDraft(row);
  if (!existing) throw new Error("No draft reply on this comment.");
  if (existing.status === "posted") throw new Error("Reply already posted.");
  const draft: DraftReply = { ...existing, status: "approved", approved_by: input.userId };
  await writeDraft(admin, row, draft);
  return draft;
}

export type PostResult =
  | { posted: true; draft: DraftReply }
  | { posted: false; reason: "needs_reconnect" | "no_youtube_connection"; draft: DraftReply };

/**
 * Post the reply to the platform. SERVER-ENFORCED gate: the stored draft
 * status must be exactly 'approved', otherwise this throws and nothing is
 * sent. After a successful post the draft moves to 'posted' and the comment
 * is marked replied.
 */
export async function postApprovedReply(
  admin: AdminClient,
  input: { userId: string; commentId: string },
): Promise<PostResult> {
  const row = await loadComment(admin, input.userId, input.commentId);
  const draft = readDraft(row);
  if (!draft) throw new Error("No draft reply on this comment.");
  // ── THE GATE: only a human-approved draft may post. ──
  if (draft.status !== "approved") {
    throw new Error(
      `Reply is not approved (status: ${draft.status}). Approve it first — drafts never auto-post.`,
    );
  }
  if (row.platform !== "youtube") {
    throw new Error(`Reply posting is only supported for YouTube (comment is ${row.platform}).`);
  }

  const { data: connection } = (await admin
    .from("youtube_connections")
    .select("access_token,refresh_token,expires_at")
    .eq("user_id", input.userId)
    .maybeSingle()) as {
    data: { access_token: string; refresh_token: string; expires_at: string | null } | null;
  };
  if (!connection) {
    return { posted: false, reason: "no_youtube_connection", draft };
  }

  const { getValidAccessToken } = await import("../youtube.server");
  let accessToken: string;
  try {
    ({ accessToken } = await getValidAccessToken(connection));
  } catch {
    return { posted: false, reason: "needs_reconnect", draft };
  }

  const res = await fetch("https://www.googleapis.com/youtube/v3/comments?part=snippet", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      snippet: {
        parentId: row.external_comment_id,
        textOriginal: draft.text,
      },
    }),
  });
  if (res.status === 401 || res.status === 403) {
    // Scope missing or grant dead — the draft stays 'approved', nothing lost.
    return { posted: false, reason: "needs_reconnect", draft };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`YouTube comments.insert failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const posted: DraftReply = { ...draft, status: "posted", posted_at: new Date().toISOString() };
  const { error } = await admin
    .from("comments")
    .update({
      metadata: { ...(row.metadata ?? {}), draft_reply: posted },
      replied: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (error) throw new Error((error as { message?: string }).message ?? "post bookkeeping failed");
  return { posted: true, draft: posted };
}

/** Read the current draft (for UI rendering). */
export async function getDraftReply(
  admin: AdminClient,
  input: { userId: string; commentId: string },
): Promise<DraftReply | null> {
  const row = await loadComment(admin, input.userId, input.commentId);
  return readDraft(row);
}
