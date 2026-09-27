/**
 * Phase 4 Stream D — Comment Intelligence studio page.
 *
 * - Ingest comments from YouTube (OAuth-gated; honest "not connected" state).
 * - Question feed with sentiment badges.
 * - Draft replies: write → human approve → post (server-enforced gate).
 * - Mined engagement insights with one-click "create idea" handoff.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  listComments,
  listIngestibleVideos,
  ingestComments,
  mineInsights,
  listInsights,
  createIdeaFromInsight,
  saveDraftReply,
  approveDraftReply,
  postReply,
} from "@/lib/comments/comments.functions";
import type { EngagementInsight } from "@/lib/comments/insights.server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/comments/")({
  component: CommentsIndex,
});

type DraftReplyView = {
  text: string;
  status: "draft" | "approved" | "posted";
  approved_by: string | null;
  posted_at: string | null;
} | null;

interface CommentView {
  id: string;
  platform: string;
  author: string;
  body: string;
  like_count: number;
  published_at: string | null;
  sentiment: string | null;
  is_question: boolean;
  replied: boolean;
  draft_reply: DraftReplyView;
}

const SENTIMENT_STYLE: Record<string, string> = {
  positive: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  neutral: "bg-muted text-muted-foreground",
  negative: "bg-red-500/10 text-red-600 border-red-500/20",
  mixed: "bg-amber-500/10 text-amber-600 border-amber-500/20",
};

function DraftBox({ comment }: { comment: CommentView }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState(comment.draft_reply?.text ?? "");
  const saveFn = useServerFn(saveDraftReply);
  const approveFn = useServerFn(approveDraftReply);
  const postFn = useServerFn(postReply);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["comments"] });

  const save = useMutation({
    mutationFn: () => saveFn({ data: { commentId: comment.id, text } }),
    onSuccess: () => {
      toast.success("Draft saved — nothing was posted.");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save draft."),
  });
  const approve = useMutation({
    mutationFn: () => approveFn({ data: { commentId: comment.id } }),
    onSuccess: () => {
      toast.success("Draft approved. It still needs a human click to post.");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not approve."),
  });
  const post = useMutation({
    mutationFn: () => postFn({ data: { commentId: comment.id } }),
    onSuccess: (r: { posted: boolean; reason?: string }) => {
      if (r.posted) {
        toast.success("Reply posted to YouTube.");
      } else if (r.reason === "needs_reconnect" || r.reason === "no_youtube_connection") {
        toast.error("Could not post: your YouTube connection needs attention. The draft is safe.");
      }
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not post."),
  });

  const status = comment.draft_reply?.status;

  return (
    <div className="mt-3 rounded-lg border border-border/60 bg-muted/30 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        Reply draft
        {status && (
          <Badge variant="outline" className="text-[10px]">
            {status === "draft" && "Draft — not posted"}
            {status === "approved" && "Approved — not yet posted"}
            {status === "posted" && "Posted"}
          </Badge>
        )}
      </div>
      {status === "posted" ? (
        <p className="text-xs text-muted-foreground">
          Posted
          {comment.draft_reply?.posted_at
            ? ` on ${new Date(comment.draft_reply.posted_at).toLocaleString()}`
            : ""}
          .
        </p>
      ) : (
        <>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a reply… (drafts never auto-post)"
            className="min-h-20 text-sm"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => save.mutate()}
              disabled={save.isPending || !text.trim()}
            >
              {save.isPending ? "Saving…" : "Save draft"}
            </Button>
            {status === "draft" && (
              <Button size="sm" onClick={() => approve.mutate()} disabled={approve.isPending}>
                {approve.isPending ? "Approving…" : "Approve"}
              </Button>
            )}
            {status === "approved" && (
              <Button size="sm" onClick={() => post.mutate()} disabled={post.isPending}>
                {post.isPending ? "Posting…" : "Post reply (human-confirmed)"}
              </Button>
            )}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Drafts never send themselves. Posting requires the Approve step first — enforced
            server-side.
          </p>
        </>
      )}
    </div>
  );
}

function CommentsIndex() {
  const queryClient = useQueryClient();
  const [questionsOnly, setQuestionsOnly] = useState(false);
  const [sentimentFilter, setSentimentFilter] = useState<string | null>(null);

  const listFn = useServerFn(listComments);
  const videosFn = useServerFn(listIngestibleVideos);
  const ingestFn = useServerFn(ingestComments);
  const mineFn = useServerFn(mineInsights);
  const insightsFn = useServerFn(listInsights);
  const ideaFn = useServerFn(createIdeaFromInsight);

  const commentsQ = useQuery({
    queryKey: ["comments", questionsOnly, sentimentFilter],
    queryFn: () =>
      listFn({
        data: {
          questionsOnly,
          sentiment:
            (sentimentFilter as "positive" | "neutral" | "negative" | "mixed" | undefined) ??
            undefined,
          limit: 30,
        },
      }) as Promise<CommentView[]>,
  });
  const videosQ = useQuery({
    queryKey: ["comment-videos"],
    queryFn: () =>
      videosFn() as Promise<
        { publishJobId: string; youtubeVideoId: string; title: string | null }[]
      >,
  });
  const insightsQ = useQuery({
    queryKey: ["engagement-insights"],
    queryFn: () => insightsFn() as Promise<EngagementInsight[]>,
  });

  const ingest = useMutation({
    mutationFn: (videoId: string) => ingestFn({ data: { videoId } }),
    onSuccess: (r: { status: string; reason?: string; fetched: number; questions: number }) => {
      if (r.status === "unavailable") {
        toast.error(
          r.reason === "token_revoked"
            ? "Your YouTube connection was revoked — reconnect it to ingest comments."
            : "No YouTube channel connected. Connect one to ingest comments.",
        );
      } else {
        toast.success(`Ingested ${r.fetched} comments (${r.questions} questions).`);
        queryClient.invalidateQueries({ queryKey: ["comments"] });
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Ingestion failed."),
  });

  const mine = useMutation({
    mutationFn: () => mineFn(),
    onSuccess: (r: { questions: number; audienceRequests: number; skipped: number }) => {
      toast.success(
        `Mined ${r.questions} questions + ${r.audienceRequests} audience requests${r.skipped ? ` (${r.skipped} already known)` : ""}.`,
      );
      queryClient.invalidateQueries({ queryKey: ["engagement-insights"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Mining failed."),
  });

  const makeIdea = useMutation({
    mutationFn: (insightId: string) => ideaFn({ data: { insightId } }),
    onSuccess: (r: { alreadyExisted: boolean }) => {
      toast.success(
        r.alreadyExisted
          ? "Idea already exists for this insight."
          : "Idea created from audience request.",
      );
      queryClient.invalidateQueries({ queryKey: ["engagement-insights"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create idea."),
  });

  const videos = videosQ.data ?? [];
  const comments = commentsQ.data ?? [];
  const insights = insightsQ.data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Comment intelligence</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ingest YouTube comments, answer questions, mine audience requests — drafts never auto-post
          and comments are never deleted.
        </p>
      </div>

      {/* Ingestion */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ingest comments</CardTitle>
        </CardHeader>
        <CardContent>
          {videosQ.isPending ? (
            <Skeleton className="h-10 w-full" />
          ) : videos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No published YouTube videos found yet. Comments become ingestible after a publish job
              completes on YouTube.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {videos.map((v) => (
                <Button
                  key={v.publishJobId}
                  variant="outline"
                  size="sm"
                  disabled={ingest.isPending}
                  onClick={() => ingest.mutate(v.youtubeVideoId)}
                >
                  {ingest.isPending ? "Ingesting…" : `Ingest: ${v.title ?? v.youtubeVideoId}`}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Insights */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Audience requests & questions</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => mine.mutate()}
            disabled={mine.isPending}
          >
            {mine.isPending ? "Mining…" : "Mine insights"}
          </Button>
        </CardHeader>
        <CardContent>
          {insights.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing mined yet — ingest comments, then run mining to surface audience requests.
            </p>
          ) : (
            <ul className="space-y-3">
              {insights.map((i) => (
                <li key={i.id} className="rounded-lg border border-border/60 p-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {i.kind === "audience_request" ? "Audience request" : i.kind}
                    </Badge>
                    {i.payload.topic && (
                      <span className="text-sm font-medium">{String(i.payload.topic)}</span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    “{String(i.payload.body ?? "")}”
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-2 h-7 px-2 text-xs"
                    disabled={makeIdea.isPending || Boolean(i.payload.idea_id)}
                    onClick={() => makeIdea.mutate(i.id)}
                  >
                    {i.payload.idea_id ? "✓ Idea created" : "Create idea →"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Comments */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Comments</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={questionsOnly ? "default" : "outline"}
              onClick={() => setQuestionsOnly((v) => !v)}
            >
              Questions only
            </Button>
            {["positive", "neutral", "negative", "mixed"].map((s) => (
              <Button
                key={s}
                size="sm"
                variant={sentimentFilter === s ? "default" : "outline"}
                onClick={() => setSentimentFilter((v) => (v === s ? null : s))}
              >
                {s}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {commentsQ.isPending ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : comments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No comments stored yet.</p>
          ) : (
            <ul className="space-y-4">
              {comments.map((c) => (
                <li key={c.id} className="rounded-lg border border-border/60 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{c.author || "Anonymous"}</span>
                    {c.sentiment && (
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${SENTIMENT_STYLE[c.sentiment] ?? ""}`}
                      >
                        {c.sentiment}
                      </Badge>
                    )}
                    {c.is_question && (
                      <Badge variant="outline" className="text-[10px]">
                        question
                      </Badge>
                    )}
                    {c.replied && (
                      <Badge variant="outline" className="text-[10px]">
                        replied
                      </Badge>
                    )}
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      ♥ {c.like_count}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{c.body}</p>
                  <DraftBox comment={c} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
