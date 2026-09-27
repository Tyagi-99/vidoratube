/**
 * Phase 4 Stream D — engagement insight mining + idea handoff.
 *
 * Reads `comments` (which this stream owns the ingestion for) and derives
 * `engagement_insights` rows of kind `question` / `audience_request`.
 * Everything here is derived from real stored comments — mining never
 * invents insights.
 *
 * One-click idea handoff (D139): an insight can become a row in `video_ideas`
 * ("the ideas table"). video_ideas requires a research_projects row, so the
 * first handoff auto-creates a per-user project titled "Audience requests"
 * and files all comment-derived ideas under it. No schema change needed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { mineAudienceRequest } from "./sentiment";

type AdminClient = Pick<SupabaseClient, "from">;

interface CommentRecord {
  id: string;
  user_id: string;
  external_comment_id: string;
  author: string;
  body: string;
  like_count: number;
  is_question: boolean;
  published_at: string | null;
  metadata: Record<string, unknown> | null;
}

export interface MineResult {
  scanned: number;
  questions: number;
  audienceRequests: number;
  /** Insights skipped because an identical one already exists (dedup). */
  skipped: number;
}

interface InsightPayload {
  comment_id: string;
  external_comment_id: string;
  author: string;
  body: string;
  topic?: string | undefined;
  pattern?: string | undefined;
  video_id?: string | undefined;
  mined_at: string;
  idea_id?: string | undefined;
  dedup_key?: string | undefined;
}

/** Stable dedup key: one insight per comment per kind. */
function insightDedupKey(kind: string, commentId: string): string {
  return `comment:${kind}:${commentId}`;
}

async function insightExists(
  admin: AdminClient,
  userId: string,
  kind: string,
  commentId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("engagement_insights")
    .select("id")
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("comment_id", commentId)
    .limit(1);
  return ((data as unknown[]) ?? []).length > 0;
}

/**
 * Mine un-mined recent comments into engagement_insights. Idempotent:
 * re-running skips comments that already produced an insight.
 */
export async function mineEngagementInsights(
  admin: AdminClient,
  input: { userId: string; sinceDays?: number; limit?: number },
): Promise<MineResult> {
  const { userId } = input;
  const since = new Date(Date.now() - (input.sinceDays ?? 30) * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from("comments")
    .select(
      "id,user_id,external_comment_id,author,body,like_count,is_question,published_at,metadata",
    )
    .eq("user_id", userId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(input.limit ?? 500);
  if (error) throw new Error((error as { message?: string }).message ?? "comment scan failed");

  const comments = (data as CommentRecord[] | null) ?? [];
  const result: MineResult = {
    scanned: comments.length,
    questions: 0,
    audienceRequests: 0,
    skipped: 0,
  };

  for (const c of comments) {
    const kinds: { kind: "question" | "audience_request"; payload: InsightPayload }[] = [];
    const metaVideoId = c.metadata?.["video_id"];
    const videoId = typeof metaVideoId === "string" ? metaVideoId : undefined;

    if (c.is_question) {
      kinds.push({
        kind: "question",
        payload: {
          comment_id: c.id,
          external_comment_id: c.external_comment_id,
          author: c.author,
          body: c.body.slice(0, 500),
          video_id: videoId,
          mined_at: new Date().toISOString(),
        },
      });
    }

    const request = mineAudienceRequest(c.body);
    if (request) {
      kinds.push({
        kind: "audience_request",
        payload: {
          comment_id: c.id,
          external_comment_id: c.external_comment_id,
          author: c.author,
          body: c.body.slice(0, 500),
          topic: request.topic,
          pattern: request.pattern,
          video_id: videoId,
          mined_at: new Date().toISOString(),
        },
      });
    }

    for (const { kind, payload } of kinds) {
      if (await insightExists(admin, userId, kind, c.id)) {
        result.skipped++;
        continue;
      }
      const { error: insertError } = await admin.from("engagement_insights").insert({
        user_id: userId,
        kind,
        comment_id: c.id,
        payload: { ...payload, dedup_key: insightDedupKey(kind, c.id) },
      });
      if (insertError)
        throw new Error((insertError as { message?: string }).message ?? "insight insert failed");
      if (kind === "question") result.questions++;
      else result.audienceRequests++;
    }
  }

  return result;
}

export interface EngagementInsight {
  id: string;
  kind: string;
  comment_id: string | null;
  payload: InsightPayload;
  created_at: string;
}

export async function listEngagementInsights(
  admin: AdminClient,
  userId: string,
  limit = 50,
): Promise<EngagementInsight[]> {
  const { data, error } = await admin
    .from("engagement_insights")
    .select("id,kind,comment_id,payload,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error((error as { message?: string }).message ?? "insight list failed");
  return (data as EngagementInsight[] | null) ?? [];
}

const AUDIENCE_REQUESTS_PROJECT_TITLE = "Audience requests";

/** Fetch (or lazily create) the per-user research project for comment ideas. */
async function getAudienceRequestsProject(admin: AdminClient, userId: string): Promise<string> {
  const { data: existing } = (await admin
    .from("research_projects")
    .select("id")
    .eq("user_id", userId)
    .eq("title", AUDIENCE_REQUESTS_PROJECT_TITLE)
    .limit(1)) as { data: { id: string }[] | null };

  if (existing && existing.length > 0) return existing[0]!.id;

  const { data: created, error } = (await admin
    .from("research_projects")
    .insert({
      user_id: userId,
      title: AUDIENCE_REQUESTS_PROJECT_TITLE,
      description:
        "Auto-created by comment intelligence: video ideas requested by the audience in comments.",
    })
    .select("id")
    .single()) as { data: { id: string } | null; error: { message?: string } | null };
  if (error || !created) throw new Error(error?.message ?? "could not create ideas project");
  return created.id;
}

export interface CreateIdeaResult {
  ideaId: string;
  projectId: string;
  /** True when this insight already had an idea (idempotent second click). */
  alreadyExisted: boolean;
}

/**
 * One-click handoff: turn an engagement_insight into a video_ideas row.
 * Idempotent — clicking twice returns the same idea id.
 */
export async function createIdeaFromInsight(
  admin: AdminClient,
  input: { userId: string; insightId: string },
): Promise<CreateIdeaResult> {
  const { userId, insightId } = input;

  const { data: insight, error } = (await admin
    .from("engagement_insights")
    .select("id,kind,payload")
    .eq("user_id", userId)
    .eq("id", insightId)
    .single()) as {
    data: { id: string; kind: string; payload: InsightPayload } | null;
    error: { message?: string } | null;
  };
  if (error || !insight) throw new Error("Insight not found.");

  if (typeof insight.payload.idea_id === "string") {
    return { ideaId: insight.payload.idea_id, projectId: "", alreadyExisted: true };
  }

  const projectId = await getAudienceRequestsProject(admin, userId);

  const title =
    insight.kind === "audience_request" && insight.payload.topic
      ? `Audience request: ${insight.payload.topic}`.slice(0, 160)
      : `From comment by ${insight.payload.author || "a viewer"}`.slice(0, 160);

  const { data: idea, error: ideaError } = (await admin
    .from("video_ideas")
    .insert({
      user_id: userId,
      project_id: projectId,
      title,
      hook: (insight.payload.body as string | undefined)?.slice(0, 280) ?? "",
      angle:
        insight.kind === "audience_request"
          ? "audience-requested topic"
          : "viewer question answered",
      format: "short",
      difficulty: "medium",
      safety_flag: "safe",
      status: "new",
    })
    .select("id")
    .single()) as { data: { id: string } | null; error: { message?: string } | null };
  if (ideaError || !idea) throw new Error(ideaError?.message ?? "idea insert failed");

  // Stamp the insight so a second click is a no-op.
  await admin
    .from("engagement_insights")
    .update({ payload: { ...insight.payload, idea_id: idea.id } })
    .eq("id", insightId);

  return { ideaId: idea.id, projectId, alreadyExisted: false };
}
