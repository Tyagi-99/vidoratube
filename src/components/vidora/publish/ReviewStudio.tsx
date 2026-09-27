import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  getReviewQueue,
  rejectPublishJob,
  type ReviewQueueJob,
} from "@/lib/publish/review.functions";
import { approvePublishJob } from "@/lib/publish.functions";
import { publishJobToMeta } from "@/lib/meta.functions";
import { MetadataDiffDialog } from "./MetadataDiffDialog";

/**
 * Phase 4, Stream A (F29) — Review Studio.
 *
 * The team approval queue: draft/approved/scheduled jobs with safety scores,
 * the immutable D61 server-approval history, and D78 client sign-off surfaced
 * as information only (client sign-off NEVER satisfies the publish gate).
 *
 * - Approve → the existing approvePublishJob (D62 score<50 hard-block for
 *   public stays server-side; the UI just shows the score honestly).
 * - Reject → rejectPublishJob: terminal cancellation with a required reason.
 * - Meta publish controls → publishJobToMeta (assertPublishJobApproved +
 *   test-account gates inside).
 * - Live-metadata overwrite → MetadataDiffDialog (diff → explicit confirm →
 *   hash-bound update, audit-logged).
 */

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <Badge variant="outline">no score</Badge>;
  const tone = score < 50 ? "destructive" : score < 75 ? "secondary" : "default";
  return (
    <Badge variant={tone} title={score < 50 ? "Public publishing is hard-blocked below 50" : undefined}>
      safety {score}
    </Badge>
  );
}

export function ReviewStudio() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [showApprove, setShowApprove] = useState(false);
  const [approveForm, setApproveForm] = useState({
    title: "",
    description: "",
    privacy: "private" as "private" | "unlisted" | "public",
    madeForKids: false,
  });

  const queueFn = useServerFn(getReviewQueue);
  const approveFn = useServerFn(approvePublishJob);
  const rejectFn = useServerFn(rejectPublishJob);
  const metaFn = useServerFn(publishJobToMeta);

  const queue = useQuery({ queryKey: ["review-queue"], queryFn: () => queueFn({}) });
  const data = queue.data;
  const jobs = data?.jobs ?? [];
  const approvals = data?.approvals ?? [];
  const signoffs = data?.signoffs ?? [];
  const selected: ReviewQueueJob | null = jobs.find((j) => j.id === selectedId) ?? null;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["review-queue"] });
    queryClient.invalidateQueries({ queryKey: ["calendar"] });
  };

  const doApprove = useMutation({
    mutationFn: () =>
      approveFn({
        data: {
          publish_job_id: selected!.id,
          title: approveForm.title,
          description: approveForm.description || undefined,
          tags: selected?.tags ?? [],
          privacy: approveForm.privacy,
          madeForKids: approveForm.madeForKids,
        },
      }),
    onSuccess: () => {
      toast.success("Job approved");
      setShowApprove(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const doReject = useMutation({
    mutationFn: () => rejectFn({ data: { publish_job_id: selected!.id, reason: rejectReason } }),
    onSuccess: () => {
      toast.success("Job rejected and canceled");
      setShowReject(false);
      setRejectReason("");
      setSelectedId(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const doMetaPublish = useMutation({
    mutationFn: (targets: ("facebook" | "instagram")[]) =>
      metaFn({ data: { publish_job_id: selected!.id, targets } }),
    onSuccess: (r: {
      results: { facebook?: { postId: string }; instagram?: { mediaId: string } };
    }) => {
      const done: string[] = [];
      if (r.results.facebook) done.push(`Facebook (post ${r.results.facebook.postId})`);
      if (r.results.instagram) done.push(`Instagram (media ${r.results.instagram.mediaId})`);
      if (done.length) toast.success(`Published: ${done.join("; ")}`);
      else toast.success("Meta publish completed");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openApprove = (job: ReviewQueueJob) => {
    setApproveForm({
      title: job.title ?? "",
      description: job.description ?? "",
      privacy: (job.privacy as "private" | "unlisted" | "public") ?? "private",
      madeForKids: job.made_for_kids ?? false,
    });
    setShowApprove(true);
  };

  const jobApprovals = selected ? approvals.filter((a) => a.publish_job_id === selected.id) : [];
  const jobSignoff = selected ? signoffs.find((s) => s.publish_job_id === selected.id) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      {/* Queue */}
      <Card>
        <CardHeader>
          <CardTitle>Review queue</CardTitle>
          <CardDescription>
            {jobs.length} job{jobs.length === 1 ? "" : "s"} awaiting or holding team review.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {queue.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : queue.isError ? (
            <p className="text-sm text-destructive">Couldn't load the queue: {(queue.error as Error).message}</p>
          ) : jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to review — the queue is clear.</p>
          ) : (
            <ul className="divide-y divide-border">
              {jobs.map((j) => (
                <li key={j.id}>
                  <button
                    onClick={() => setSelectedId(j.id)}
                    className={`flex w-full items-center gap-2 py-2.5 text-left ${
                      selectedId === j.id ? "bg-muted/50" : ""
                    } rounded-md px-2 hover:bg-muted/40`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{j.title ?? "Untitled"}</p>
                      <p className="text-xs text-muted-foreground">
                        {j.status}
                        {j.scheduled_for ? ` · ${new Date(j.scheduled_for).toLocaleString()}` : ""}
                      </p>
                    </div>
                    <ScoreBadge score={j.safety_score} />
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Detail */}
      <Card>
        {!selected ? (
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            Select a job from the queue to review it.
          </CardContent>
        ) : (
          <>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {selected.title ?? "Untitled"}
                <Badge variant="outline">{selected.status}</Badge>
                <ScoreBadge score={selected.safety_score} />
              </CardTitle>
              <CardDescription>
                {selected.privacy ?? "private"} · kids: {selected.made_for_kids ? "yes" : "no"}
                {selected.scheduled_for ? ` · scheduled ${new Date(selected.scheduled_for).toLocaleString()}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {selected.safety_score != null && selected.safety_score < 50 && (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <span>
                    Safety score is below 50 — <strong>public publishing is hard-blocked</strong>.
                    Private/unlisted may still proceed with a recorded warning.
                  </span>
                </div>
              )}

              {selected.description && (
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{selected.description}</p>
              )}
              {selected.tags && selected.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selected.tags.map((t) => (
                    <Badge key={t} variant="secondary" className="text-[11px]">{t}</Badge>
                  ))}
                </div>
              )}
              {selected.youtube_video_id && (
                <p className="text-xs text-muted-foreground">
                  Published:{" "}
                  <a
                    href={selected.youtube_url ?? `https://youtu.be/${selected.youtube_video_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    youtu.be/{selected.youtube_video_id}
                  </a>
                </p>
              )}

              {/* Server approval history (D61) — the only thing that authorizes publishing */}
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                  <ShieldCheck className="h-4 w-4" /> Server approvals
                </h3>
                {jobApprovals.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No server approval recorded — this job cannot publish yet.
                  </p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {jobApprovals.map((a) => (
                      <li key={a.id} className="flex items-center gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                        {a.scope} · {new Date(a.approved_at).toLocaleString()}
                        {a.notes ? ` — ${a.notes}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Client sign-off (D78) — information only, never a publish gate */}
              <section>
                <h3 className="mb-2 text-sm font-semibold">Client sign-off</h3>
                {!jobSignoff ? (
                  <p className="text-xs text-muted-foreground">No client sign-off recorded.</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Status: <Badge variant="outline">{jobSignoff.status}</Badge>
                    {jobSignoff.decided_at ? ` · ${new Date(jobSignoff.decided_at).toLocaleString()}` : ""}
                    <span className="mt-1 block">
                      Client sign-off is informational — only a server approval authorizes publishing.
                    </span>
                  </p>
                )}
              </section>

              {/* Actions */}
              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                <Button
                  onClick={() => openApprove(selected)}
                  disabled={doApprove.isPending || selected.status !== "draft"}
                  title={selected.status !== "draft" ? "Only draft jobs need approval" : undefined}
                >
                  {doApprove.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Approve
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setShowReject(true)}
                  disabled={doReject.isPending}
                >
                  <XCircle className="mr-2 h-4 w-4" /> Reject
                </Button>
                {selected.youtube_video_id && (
                  <MetadataDiffDialog
                    publishJobId={selected.id}
                    videoId={selected.youtube_video_id}
                    initialTitle={selected.title ?? ""}
                    initialDescription={selected.description ?? ""}
                  />
                )}
                <Button
                  variant="outline"
                  onClick={() => doMetaPublish.mutate(["facebook", "instagram"])}
                  disabled={doMetaPublish.isPending || selected.status === "draft"}
                  title="Publish this approved job to the Meta test accounts (Facebook Page + Instagram)"
                >
                  {doMetaPublish.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Publish to Meta
                </Button>
              </div>
              {selected.status === "draft" && (
                <p className="text-xs text-muted-foreground">
                  Meta publishing is available after approval. YouTube uploads run through the
                  publish pipeline's scheduled execution.
                </p>
              )}
            </CardContent>
          </>
        )}
      </Card>

      {/* Approve dialog */}
      <Dialog open={showApprove} onOpenChange={setShowApprove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve publish job</DialogTitle>
            <DialogDescription>
              Finalize the title, description, and visibility. Safety score below 50 hard-blocks
              public publishing — that rule is enforced server-side.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="ap-title">Title</Label>
              <Input
                id="ap-title"
                value={approveForm.title}
                maxLength={100}
                onChange={(e) => setApproveForm({ ...approveForm, title: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="ap-desc">Description</Label>
              <Textarea
                id="ap-desc"
                value={approveForm.description}
                maxLength={4900}
                onChange={(e) => setApproveForm({ ...approveForm, description: e.target.value })}
              />
            </div>
            <div className="flex gap-2">
              {(["private", "unlisted", "public"] as const).map((p) => (
                <Button
                  key={p}
                  type="button"
                  variant={approveForm.privacy === p ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setApproveForm({ ...approveForm, privacy: p })}
                >
                  {p}
                </Button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={approveForm.madeForKids}
                onChange={(e) => setApproveForm({ ...approveForm, madeForKids: e.target.checked })}
              />
              Made for kids (required declaration)
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowApprove(false)}>Cancel</Button>
            <Button onClick={() => doApprove.mutate()} disabled={doApprove.isPending || !approveForm.title.trim()}>
              {doApprove.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Approve job
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={showReject} onOpenChange={setShowReject}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject publish job</DialogTitle>
            <DialogDescription>
              Rejection is terminal: the job is canceled and can never publish. The reason is
              required and is kept in the audit log.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="rj-reason">Reason (required)</Label>
            <Textarea
              id="rj-reason"
              value={rejectReason}
              placeholder="Why is this job being rejected?"
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowReject(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => doReject.mutate()}
              disabled={doReject.isPending || !rejectReason.trim()}
            >
              {doReject.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reject and cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
