import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Youtube, ShieldAlert, CalendarClock, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { ThumbnailStudio } from "./ThumbnailStudio";
import { SeoStudio } from "./SeoStudio";
import {
  createPublishJob,
  approvePublishJob,
  executePublishJob,
  cancelPublishJob,
  listPublishJobs,
  getSEOMetadata,
} from "@/lib/publish.functions";
import { getYouTubeConnection, requestUploadScope } from "@/lib/youtube.functions";
import { listMyJobs } from "@/lib/jobs.functions";
import { track } from "@/lib/analytics";

type Privacy = "private" | "unlisted" | "public";
type Step = "thumbnail" | "seo" | "schedule" | "review";

const STEPS: Step[] = ["thumbnail", "seo", "schedule", "review"];

export function PublishPipeline({
  projectId,
  videoTitle,
  videoTopic,
  scriptSummary,
  primaryKeyword,
  nicheKeywords,
}: {
  projectId: string;
  videoTitle: string;
  videoTopic: string;
  scriptSummary: string;
  primaryKeyword: string;
  nicheKeywords: string[];
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const connFn = useServerFn(getYouTubeConnection);
  const scopeFn = useServerFn(requestUploadScope);
  const createFn = useServerFn(createPublishJob);
  const approveFn = useServerFn(approvePublishJob);
  const executeFn = useServerFn(executePublishJob);
  const cancelFn = useServerFn(cancelPublishJob);
  const listFn = useServerFn(listPublishJobs);
  const seoFn = useServerFn(getSEOMetadata);
  const jobsFn = useServerFn(listMyJobs);

  const [step, setStep] = useState<Step>("thumbnail");
  const [privacy, setPrivacy] = useState<Privacy>("private");
  const [madeForKids, setMadeForKids] = useState<boolean | null>(null);
  const [scheduledFor, setScheduledFor] = useState("");
  const [videoJobId, setVideoJobId] = useState<string | null>(null);

  const connection = useQuery({
    queryKey: ["youtube"],
    queryFn: () => connFn({}),
  });
  const history = useQuery({
    queryKey: ["publish-jobs", projectId],
    queryFn: () => listFn({}),
  });
  const seo = useQuery({
    queryKey: ["seo", projectId],
    queryFn: () => seoFn({ data: { project_id: projectId } }),
  });
  const completedVideos = useQuery({
    queryKey: ["my-jobs"],
    queryFn: () => jobsFn({}),
  });
  const readyVideos = (completedVideos.data ?? []).filter(
    (j: { status: string; result_url: string | null }) => j.status === "completed" && j.result_url,
  );

  const createJob = useMutation({
    mutationFn: () => {
      if (!videoJobId) throw new Error("Choose a video to publish first.");
      return createFn({ data: { project_id: projectId, video_job_id: videoJobId } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const grantScope = useMutation({
    mutationFn: () => scopeFn({}),
    onSuccess: ({ url }) => {
      if (videoJobId) sessionStorage.setItem("vidora:yt-pending-publish", videoJobId);
      window.location.href = url;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approve = useMutation({
    mutationFn: (publishJobId: string) =>
      approveFn({
        data: {
          publish_job_id: publishJobId,
          title: seo.data?.seo?.selected_title ?? videoTitle,
          description: seo.data?.seo?.description ?? undefined,
          tags: seo.data?.seo?.tags ?? [],
          privacy,
          madeForKids: madeForKids ?? false,
          scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
        },
      }),
    onSuccess: (res) => {
      track("publish_started", { project_id: projectId });
      queryClient.invalidateQueries({ queryKey: ["publish-jobs", projectId] });
      const job = res.publishJob;
      if (job.status === "scheduled") {
        toast.success("Scheduled", { description: "Your video will publish at the scheduled time." });
      } else {
        execute.mutate(job.id);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const execute = useMutation({
    mutationFn: (publishJobId: string) => executeFn({ data: { publish_job_id: publishJobId } }),
    onSuccess: (res) => {
      track("publish_succeeded", { project_id: projectId });
      toast.success("Published to YouTube", { description: res.url });
      queryClient.invalidateQueries({ queryKey: ["publish-jobs", projectId] });
    },
    onError: (e: Error) => {
      track("publish_failed", { project_id: projectId });
      toast.error(e.message);
      queryClient.invalidateQueries({ queryKey: ["publish-jobs", projectId] });
    },
  });

  const cancel = useMutation({
    mutationFn: (publishJobId: string) => cancelFn({ data: { publish_job_id: publishJobId } }),
    onSuccess: () => {
      toast.success("Publish canceled");
      queryClient.invalidateQueries({ queryKey: ["publish-jobs", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const conn = connection.data?.connection;
  const configured = connection.data?.configured;
  const needsScope = configured && conn && !conn.hasUploadScope;
  const activeJob = (history.data?.jobs ?? []).find((j) =>
    ["draft", "approved", "scheduled", "uploading"].includes(j.status),
  );

  const stepIndex = STEPS.indexOf(step);
  const reviewReady = madeForKids !== null;

  return (
    <div className="space-y-6">
      {/* Video picker */}
      <div className="space-y-1.5">
        <Label className="text-sm font-semibold">Video to publish</Label>
        <Select value={videoJobId ?? ""} onValueChange={(v) => setVideoJobId(v || null)}>
          <SelectTrigger>
            <SelectValue placeholder="Choose a finished video…" />
          </SelectTrigger>
          <SelectContent>
            {readyVideos.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.title ?? "Untitled video"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {readyVideos.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No finished videos yet — render one first, then come back to publish.
          </p>
        )}
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-1">
        {STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => setStep(s)}
            className={`flex-1 rounded-lg px-2 py-2 text-xs font-medium capitalize transition-colors ${
              s === step ? "bg-primary text-primary-foreground" : i < stepIndex ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
            }`}
          >
            {i + 1}. {s}
          </button>
        ))}
      </div>

      {!configured ? (
        <p className="text-sm text-muted-foreground">
          YouTube publishing isn&apos;t configured yet — add your Google OAuth keys in Admin →
          Integrations.
        </p>
      ) : !conn ? (
        <p className="text-sm text-muted-foreground">
          Connect your YouTube channel first, then come back to publish.
        </p>
      ) : needsScope ? (
        <div className="space-y-4">
          <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
            <ShieldAlert className="h-5 w-5 shrink-0 text-amber-500" />
            <div className="text-sm">
              <p className="font-semibold text-foreground">Upload permission needed</p>
              <p className="mt-1 text-muted-foreground">
                Grant the upload permission to publish — Google will ask you to confirm.
              </p>
            </div>
          </div>
          <Button className="w-full gap-2" onClick={() => grantScope.mutate()} disabled={grantScope.isPending}>
            {grantScope.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Youtube className="h-4 w-4" />}
            Grant upload permission
          </Button>
        </div>
      ) : (
        <>
          {step === "thumbnail" && (
            <ThumbnailStudio projectId={projectId} videoTitle={videoTitle} videoTopic={videoTopic} />
          )}
          {step === "seo" && (
            <SeoStudio
              projectId={projectId}
              videoTitle={videoTitle}
              scriptSummary={scriptSummary}
              primaryKeyword={primaryKeyword}
              nicheKeywords={nicheKeywords}
            />
          )}
          {step === "schedule" && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-sm font-semibold">
                  <CalendarClock className="h-4 w-4" /> {t("schedule_label")}
                </Label>
                <Input
                  type="datetime-local"
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                  min={new Date().toISOString().slice(0, 16)}
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty to publish immediately after approval.
                </p>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Visibility</Label>
                <RadioGroup value={privacy} onValueChange={(v) => setPrivacy(v as Privacy)} className="flex gap-2">
                  {(["private", "unlisted", "public"] as const).map((p) => (
                    <div key={p} className="flex-1">
                      <RadioGroupItem value={p} id={`pp-${p}`} className="peer sr-only" />
                      <Label
                        htmlFor={`pp-${p}`}
                        className="flex cursor-pointer items-center justify-center rounded-lg border border-border px-3 py-2 text-sm capitalize peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 peer-data-[state=checked]:font-semibold"
                      >
                        {p}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold">
                  {t("made_for_kids_q")} <span className="text-destructive">*</span>
                </Label>
                <RadioGroup
                  value={madeForKids === null ? "" : madeForKids ? "yes" : "no"}
                  onValueChange={(v) => setMadeForKids(v === "yes")}
                  className="flex gap-2"
                >
                  {(["yes", "no"] as const).map((v) => (
                    <div key={v} className="flex-1">
                      <RadioGroupItem value={v} id={`kids-${v}`} className="peer sr-only" />
                      <Label
                        htmlFor={`kids-${v}`}
                        className="flex cursor-pointer items-center justify-center rounded-lg border border-border px-3 py-2 text-sm capitalize peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 peer-data-[state=checked]:font-semibold"
                      >
                        {v}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
                <p className="text-xs text-muted-foreground">
                  YouTube requires this declaration (COPPA) on every upload.
                </p>
              </div>
            </div>
          )}
          {step === "review" && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">{t("review_publish")}</h3>
              <div className="rounded-lg border p-4 text-sm">
                <p className="font-medium">{seo.data?.seo?.selected_title ?? videoTitle}</p>
                <p className="mt-1 line-clamp-3 text-muted-foreground">
                  {seo.data?.seo?.description ?? "No description yet."}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge variant="outline">{privacy}</Badge>
                  <Badge variant="outline">{madeForKids ? "Made for kids: yes" : madeForKids === false ? "Made for kids: no" : "Made for kids: ?"}</Badge>
                  {scheduledFor && <Badge variant="outline">Scheduled: {new Date(scheduledFor).toLocaleString()}</Badge>}
                </div>
              </div>
              {!reviewReady && (
                <p className="text-sm text-destructive">
                  Please answer the “made for kids” question in the Schedule step.
                </p>
              )}
              {/* THE human approval gate — no other path publishes. */}
              <Button
                className="w-full gap-2"
                size="lg"
                disabled={!reviewReady || approve.isPending || execute.isPending || !!activeJob}
                onClick={async () => {
                  if (!videoJobId) {
                    toast.error("Choose a video to publish first.");
                    return;
                  }
                  let jobId = activeJob?.id;
                  if (!jobId) {
                    const created = await createJob.mutateAsync();
                    jobId = created.publishJob.id;
                  }
                  approve.mutate(jobId);
                }}
              >
                {approve.isPending || execute.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-5 w-5" />
                )}
                {approve.isPending || execute.isPending
                  ? t("approving")
                  : scheduledFor
                    ? t("schedule_publish")
                    : t("approve_publish")}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Nothing publishes until you press this button. Scheduled videos go live at the chosen time.
              </p>
            </div>
          )}

          {/* Step nav */}
          <div className="flex justify-between">
            <Button variant="outline" disabled={stepIndex === 0} onClick={() => setStep(STEPS[stepIndex - 1]!)}>
              Back
            </Button>
            {stepIndex < STEPS.length - 1 && (
              <Button onClick={() => setStep(STEPS[stepIndex + 1]!)}>Continue</Button>
            )}
          </div>
        </>
      )}

      {/* Publish history */}
      {(history.data?.jobs ?? []).length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t("publish_history")}</h3>
          {(history.data?.jobs ?? []).map((job) => (
            <div key={job.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{job.title ?? "Untitled"}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(job.created_at).toLocaleDateString()}
                  {job.youtube_url && (
                    <>
                      {" · "}
                      <a href={job.youtube_url} target="_blank" rel="noreferrer" className="text-primary underline">
                        YouTube
                      </a>
                    </>
                  )}
                  {job.error && <span className="text-destructive"> · {job.error}</span>}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={job.status === "published" ? "default" : job.status === "failed" ? "destructive" : "secondary"}>
                  {job.status}
                </Badge>
                {["draft", "approved", "scheduled"].includes(job.status) && (
                  <Button size="sm" variant="ghost" onClick={() => cancel.mutate(job.id)}>
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
