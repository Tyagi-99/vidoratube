/**
 * Phase 4 Stream D — YouTube comment ingestion.
 *
 * OAuth-gated (D142): comments are fetched with the user's stored YouTube
 * grant via commentThreads.list. When there is no grant (or it is revoked),
 * ingestion returns `{ status: "unavailable" }` — an HONEST signal. It never
 * fabricates comments, and it never falls back to fixture/sample data
 * silently: callers must surface the unavailable state in the UI.
 *
 * Idempotency: rows are upserted on the pinned
 * UNIQUE(user_id, platform, external_comment_id). Re-ingesting the same
 * video only refreshes like_count / sentiment — never duplicates.
 *
 * Scope note: commentThreads.list is read-only; the connect-time
 * `youtube.readonly` scope already covers it (no publish scopes needed).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifySentiment, isQuestion } from "./sentiment";

export const COMMENTS_PLATFORM = "youtube" as const;

export type IngestStatus = "ok" | "unavailable";

export interface IngestResult {
  status: IngestStatus;
  /** Machine-readable reason when status === "unavailable". */
  reason?: "no_youtube_connection" | "token_revoked" | "api_error" | "no_videos";
  videoId?: string;
  fetched: number;
  inserted: number;
  updated: number;
  questions: number;
}

interface YouTubeCommentSnippet {
  id: string;
  snippet: {
    authorDisplayName?: string;
    textDisplay?: string;
    textOriginal?: string;
    likeCount?: number;
    publishedAt?: string;
  };
}

interface CommentThreadItem {
  id: string;
  snippet: {
    topLevelComment?: YouTubeCommentSnippet;
    replies?: { comments?: YouTubeCommentSnippet[] };
  };
}

interface CommentThreadsResponse {
  items?: CommentThreadItem[];
  nextPageToken?: string;
  error?: { message?: string; status?: string };
}

interface CommentRow {
  user_id: string;
  platform: string;
  external_comment_id: string;
  author: string;
  body: string;
  like_count: number;
  published_at: string | null;
  sentiment: string | null;
  is_question: boolean;
  metadata: Record<string, unknown>;
}

function toRow(
  userId: string,
  videoId: string,
  c: YouTubeCommentSnippet,
  parentExternalId: string | null,
): CommentRow {
  const body = c.snippet.textDisplay ?? c.snippet.textOriginal ?? "";
  return {
    user_id: userId,
    platform: COMMENTS_PLATFORM,
    external_comment_id: c.id,
    author: c.snippet.authorDisplayName ?? "",
    body,
    like_count: Math.max(0, c.snippet.likeCount ?? 0),
    published_at: c.snippet.publishedAt ?? null,
    sentiment: classifySentiment(body),
    is_question: isQuestion(body),
    metadata: {
      source: "youtube_data_api",
      video_id: videoId,
      parent_external_comment_id: parentExternalId,
    },
  };
}

async function fetchThreadsPage(
  accessToken: string,
  videoId: string,
  pageToken?: string,
): Promise<CommentThreadsResponse> {
  const params = new URLSearchParams({
    part: "snippet,replies",
    videoId,
    maxResults: "100",
    textFormat: "plainText",
    order: "time",
  });
  if (pageToken) params.set("pageToken", pageToken);
  const res = await fetch(`https://www.googleapis.com/youtube/v3/commentThreads?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = (await res.json().catch(() => ({}))) as CommentThreadsResponse;
  if (!res.ok) {
    const err = new Error(
      `YouTube commentThreads.list failed (${res.status}): ${json.error?.message ?? "unknown"}`,
    ) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return json;
}

type AdminClient = Pick<SupabaseClient, "from">;

/**
 * Minimal structural typing for the token store rows we touch.
 * youtube_connections is a legacy table outside the generated Database types;
 * we only read/write these columns.
 */
interface TokenStoreRow {
  access_token: string;
  refresh_token: string;
  expires_at: string | null;
}

async function getYouTubeAccessToken(
  admin: AdminClient,
  userId: string,
): Promise<{ accessToken: string } | { error: "no_youtube_connection" | "token_revoked" }> {
  const { data: connection } = (await admin
    .from("youtube_connections")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle()) as { data: TokenStoreRow | null };
  if (!connection) return { error: "no_youtube_connection" };
  try {
    const { getValidAccessToken, encryptToken } = await import("../youtube.server");
    const { accessToken, refreshed } = await getValidAccessToken(connection);
    if (refreshed?.access_token) {
      // Persist the refreshed pair so the next call reuses it.
      await admin
        .from("youtube_connections")
        .update({
          access_token: await encryptToken(refreshed.access_token),
          expires_at: new Date(Date.now() + (refreshed.expires_in ?? 3500) * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
    }
    return { accessToken };
  } catch (e) {
    if (e instanceof Error && (e as { code?: string }).code === "YOUTUBE_REVOKED") {
      return { error: "token_revoked" };
    }
    throw e;
  }
}

/**
 * Ingest comments for one YouTube video id (the platform video id, e.g.
 * publish_jobs.youtube_video_id). Never throws for missing credentials —
 * that is an honest "unavailable" result, not an error.
 */
export async function ingestYouTubeComments(
  admin: AdminClient,
  input: { userId: string; videoId: string; maxPages?: number },
): Promise<IngestResult> {
  const { userId, videoId } = input;
  const maxPages = Math.min(Math.max(input.maxPages ?? 5, 1), 20);

  const token = await getYouTubeAccessToken(admin, userId);
  if ("error" in token) {
    return {
      status: "unavailable",
      reason: token.error,
      fetched: 0,
      inserted: 0,
      updated: 0,
      questions: 0,
    };
  }

  let pageToken: string | undefined;
  let page = 0;
  const rows: CommentRow[] = [];

  try {
    do {
      const data = await fetchThreadsPage(token.accessToken, videoId, pageToken);
      for (const thread of data.items ?? []) {
        const top = thread.snippet.topLevelComment;
        if (top) {
          rows.push(toRow(userId, videoId, top, null));
          for (const reply of thread.snippet.replies?.comments ?? []) {
            rows.push(toRow(userId, videoId, reply, top.id));
          }
        }
      }
      pageToken = data.nextPageToken;
      page++;
    } while (pageToken && page < maxPages);
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 401 || status === 403) {
      return {
        status: "unavailable",
        reason: "token_revoked",
        fetched: 0,
        inserted: 0,
        updated: 0,
        questions: 0,
      };
    }
    return {
      status: "unavailable",
      reason: "api_error",
      videoId,
      fetched: rows.length,
      inserted: 0,
      updated: 0,
      questions: 0,
    };
  }

  // Idempotent upsert on the pinned UNIQUE(user_id, platform, external_comment_id).
  let inserted = 0;
  let updated = 0;
  let questions = 0;
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { data, error } = await admin
      .from("comments")
      .upsert(batch, { onConflict: "user_id,platform,external_comment_id" })
      .select("external_comment_id,created_at,updated_at");
    if (error) {
      throw new Error(
        `Comment upsert failed: ${(error as { message?: string }).message ?? "unknown"}`,
      );
    }
    // Heuristic: a row whose created_at == updated_at (within 1s) was just
    // inserted; the rest were refreshed. Both paths keep the store current.
    for (const r of (data as { created_at: string; updated_at: string }[] | null) ?? []) {
      const fresh = Math.abs(Date.parse(r.created_at) - Date.parse(r.updated_at)) < 1000;
      if (fresh) inserted++;
      else updated++;
    }
    questions += batch.filter((b) => b.is_question).length;
  }

  return { status: "ok", videoId, fetched: rows.length, inserted, updated, questions };
}

/**
 * List the user's published YouTube videos (from publish_jobs) so the UI
 * can offer "ingest comments" per video. Pure read — consume-only.
 */
export async function listIngestibleVideos(
  admin: AdminClient,
  userId: string,
): Promise<{ publishJobId: string; youtubeVideoId: string; title: string | null }[]> {
  const { data, error } = await admin
    .from("publish_jobs")
    .select("id,title,youtube_video_id")
    .eq("user_id", userId)
    .eq("status", "published")
    .not("youtube_video_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw new Error((error as { message?: string }).message ?? "query failed");
  return (
    (data as { id: string; title: string | null; youtube_video_id: string }[] | null) ?? []
  ).map((r) => ({ publishJobId: r.id, youtubeVideoId: r.youtube_video_id, title: r.title }));
}
