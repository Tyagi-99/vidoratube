import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { GenerateVideoDialog } from "@/components/vidora/GenerateVideoDialog";
import { ModeChooser } from "@/components/vidora/ModeChooser";
import { VoiceoverCreateDialog } from "@/components/vidora/VoiceoverCreateDialog";
import { AutoEditCreateDialog } from "@/components/vidora/AutoEditCreateDialog";
import { YouTubePanel } from "@/components/vidora/YouTubePanel";
import { OnboardingChecklist } from "@/components/vidora/OnboardingChecklist";
import { PublishDialog } from "@/components/vidora/PublishDialog";
import { CapCutExportButton } from "@/components/vidora/CapCutExportButton";
import { JobPreviewDialog } from "@/components/vidora/JobPreviewDialog";
import { selectDownloadUrl } from "@/lib/jobs/final-video";
import { CREATION_MODES, studioSearchFromUnknown } from "@/lib/creation-modes";
import { ResumeComposeButton, isStalledCompose } from "@/components/vidora/ResumeComposeButton";

import { getMyAccount, listMyJobs, deleteMyJob, reapStaleVideoJobs } from "@/lib/jobs.functions";
import {
  AudioLines,
  Coins,
  Film,
  LayoutDashboard,
  Plus,
  Trash2,
  Youtube,
  Loader2,
  Download,
} from "lucide-react";

import { toast } from "sonner";
import { track } from "@/lib/analytics";

export const Route = createFileRoute("/_authenticated/studio")({
  validateSearch: (search: Record<string, unknown>) => studioSearchFromUnknown(search),
  head: () => ({
    meta: [
      { title: "Studio dashboard — Vidora AI" },
      {
        name: "description",
        content: "Your Vidora AI studio: render videos, track jobs and manage credits.",
      },
      { property: "og:title", content: "Studio dashboard — Vidora AI" },
      { property: "og:description", content: "Render videos and track your jobs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: StudioPage,
});

const statusStyles: Record<string, string> = {
  completed: "bg-primary/15 text-primary",
  running: "bg-accent text-accent-foreground",
  queued: "bg-muted text-muted-foreground",
  failed: "bg-destructive/15 text-destructive",
};

function StudioPage() {
  const { create: pageMode, youtube, reason } = Route.useSearch();
  const [modeChooserOpen, setModeChooserOpen] = useState(false);
  const [publishTarget, setPublishTarget] = useState<{ id: string; title: string } | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const accountFn = useServerFn(getMyAccount);
  const jobsFn = useServerFn(listMyJobs);
  const removeFn = useServerFn(deleteMyJob);
  const reapFn = useServerFn(reapStaleVideoJobs);

  const account = useQuery({ queryKey: ["account"], queryFn: () => accountFn({}) });
  const jobs = useQuery({ queryKey: ["my-jobs"], queryFn: () => jobsFn({}) });

  // Clean up jobs stuck in "running" from a dead tab: fails them and refunds
  // the credit exactly once. Fire-and-forget, once per studio visit.
  useEffect(() => {
    void reapFn({}).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Surface the YouTube OAuth outcome, then strip the params so a refresh
  // doesn't re-toast. (The callback redirects here with ?youtube=…&reason=…;
  // the search schema used to strip them before this component ever saw them.)
  useEffect(() => {
    if (!youtube) return;
    if (youtube === "connected") {
      toast.success("YouTube connected", {
        description:
          "Read-only access for now — we'll ask for upload permission the first time you publish.",
      });
    } else if (youtube === "upload_granted") {
      toast.success("Upload permission granted", {
        description: "You can publish to YouTube now.",
      });
      // Resume the publish the user started before the Google redirect.
      try {
        const pendingId = sessionStorage.getItem("vidora:yt-pending-publish");
        sessionStorage.removeItem("vidora:yt-pending-publish");
        if (pendingId) {
          const job = jobs.data?.find((j) => j.id === pendingId);
          setPublishTarget({ id: pendingId, title: job?.title ?? "" });
        }
      } catch {
        /* ignore */
      }
    } else {
      const detail = (reason ?? "unknown_error").replace(/_/g, " ");
      toast.error("YouTube connection failed", { description: detail });
    }
    void navigate({ to: "/studio", search: {}, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [youtube]);

  const remove = useMutation({
    mutationFn: (id: string) => removeFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Video deleted");
      queryClient.invalidateQueries({ queryKey: ["my-jobs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const profile = account.data?.profile;

  if (pageMode) {
    const closePage = () => {
      void navigate({ to: "/studio", replace: true });
    };
    if (pageMode === "auto_edit") {
      return <AutoEditCreateDialog asPage open onOpenChange={closePage} />;
    }
    return (
      <main className="min-h-[calc(100dvh-4rem)] bg-background px-4 py-10 sm:px-6">
        {pageMode === "script" && <GenerateVideoDialog asPage open onOpenChange={closePage} />}
        {pageMode === "story" && (
          <GenerateVideoDialog asPage open onOpenChange={closePage} storyMode />
        )}
        {pageMode === "voiceover" && <VoiceoverCreateDialog asPage open onOpenChange={closePage} />}
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100dvh-4rem)] bg-background">
      <div className="border-b border-border bg-card/40">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="mb-8">
            <OnboardingChecklist />
          </div>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="min-w-0">
              <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                {profile?.display_name ? `Hey, ${profile.display_name}` : "Your studio"}
              </h1>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Script, voiceover or automatic edit — each render finishes as one 1080p MP4.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" asChild className="gap-2">
                <Link to="/voices">
                  <AudioLines className="h-4 w-4" />
                  Voice Studio
                </Link>
              </Button>
              <Button onClick={() => setModeChooserOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                New video
              </Button>
            </div>
          </div>

          <dl className="mt-8 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
            <StatCard
              icon={<Coins className="h-4 w-4" />}
              label="Credits left"
              value={
                account.isLoading ? null : account.isError ? "—" : String(profile?.credits ?? 0)
              }
            />
            <StatCard
              icon={<Film className="h-4 w-4" />}
              label="Videos rendered"
              value={
                account.isLoading
                  ? null
                  : account.isError
                    ? "—"
                    : String(account.data?.jobCount ?? 0)
              }
            />
            <StatCard
              icon={<LayoutDashboard className="h-4 w-4" />}
              label="Plan"
              value={account.isLoading ? null : account.isError ? "—" : (profile?.plan ?? "free")}
            />
          </dl>
          {account.isError && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
              <p className="text-sm text-muted-foreground">
                Couldn&apos;t load your account (
                {(account.error as Error)?.message ?? "unknown error"}). Your credits are shown as
                “—”, not 0.
              </p>
              <Button size="sm" variant="outline" onClick={() => account.refetch()}>
                Retry
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-6">
          <YouTubePanel />
        </div>

        <div className="flex items-baseline justify-between gap-4 border-b border-border pb-4">
          <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Your videos
          </h2>
          {!jobs.isLoading && (jobs.data ?? []).length > 0 && (
            <span className="text-sm text-muted-foreground">
              {(jobs.data ?? []).length} item{(jobs.data ?? []).length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {jobs.isLoading ? (
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="surface-card overflow-hidden">
                <Skeleton className="aspect-video w-full rounded-none" />
                <div className="space-y-3 p-5">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-9 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : jobs.isError ? (
          <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 p-8">
            <p className="font-semibold text-foreground">We couldn't load your videos</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {(jobs.error as Error)?.message ?? "Something went wrong."}
            </p>
            <Button className="mt-5" variant="outline" onClick={() => jobs.refetch()}>
              Try again
            </Button>
          </div>
        ) : (jobs.data ?? []).length === 0 ? (
          <Card className="mt-6 border-dashed border-border bg-card">
            <CardContent className="mx-auto flex max-w-md flex-col items-center gap-5 p-14 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted text-accent">
                <Film className="h-6 w-6" />
              </div>
              <div>
                <p className="font-display text-lg font-semibold text-foreground">
                  Nothing rendered yet
                </p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Start from a script, a voiceover, or an automatic edit. Your finished MP4s collect
                  here.
                </p>
              </div>
              <Button onClick={() => setModeChooserOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                Make your first video
              </Button>
              <div className="flex flex-wrap justify-center gap-2">
                {CREATION_MODES.map((mode) => (
                  <Button key={mode.id} asChild variant="outline" size="sm">
                    <a href={mode.href}>{mode.title}</a>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {(jobs.data ?? []).map((job) => {
              const downloadUrl = selectDownloadUrl(job);
              return (
                <article key={job.id} className="surface-card flex flex-col overflow-hidden">
                  <div className="relative aspect-video w-full overflow-hidden bg-muted">
                    {job.thumbnail_url ? (
                      <img
                        src={job.thumbnail_url}
                        alt={`Thumbnail for ${job.title}`}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <Film className="h-6 w-6" aria-hidden="true" />
                      </div>
                    )}
                    <span
                      className={`absolute left-3 top-3 rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wider ${statusStyles[job.status] ?? "bg-muted text-muted-foreground"}`}
                    >
                      {job.status}
                    </span>
                  </div>

                  <div className="flex flex-1 flex-col gap-4 p-5">
                    <div>
                      <h3 className="line-clamp-2 font-display text-base font-semibold leading-snug text-foreground">
                        {job.title}
                      </h3>
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <Badge variant="secondary" className="capitalize">
                          {job.format}
                        </Badge>
                        <Badge variant="secondary" className="capitalize">
                          {job.voice}
                        </Badge>
                        <span aria-hidden="true">·</span>
                        <time dateTime={job.created_at}>
                          {new Date(job.created_at).toLocaleDateString()}
                        </time>
                      </div>
                    </div>

                    {job.error && (
                      <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-relaxed text-destructive">
                        {job.error}
                      </p>
                    )}
                    {isStalledCompose(job) && (
                      <p className="rounded-md border border-border bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                        Stills and voiceover are ready. Vidora is composing the final MP4 in this
                        browser tab — keep the page open until Download appears.
                      </p>
                    )}

                    <div className="mt-auto flex flex-wrap gap-2">
                      {isStalledCompose(job) && (
                        <ResumeComposeButton job={job} className="flex-1 gap-1" />
                      )}
                      <JobPreviewDialog job={job} className="flex-1 gap-1" />
                      {(downloadUrl || job.audio_url) && (
                        <Button asChild size="sm" variant="outline" className="flex-1 gap-1">
                          <a
                            href={downloadUrl ?? job.audio_url ?? "#"}
                            target="_blank"
                            rel="noreferrer"
                            download
                            onClick={() => track("download_clicked", { job_id: job.id })}
                          >
                            <Download className="h-4 w-4" />
                            {downloadUrl ? "Download" : "Audio"}
                          </a>
                        </Button>
                      )}
                      <CapCutExportButton job={job} className="flex-1 gap-1" />

                      {job.status === "completed" &&
                        downloadUrl &&
                        (job.youtube_video_id ? (
                          <Button asChild size="sm" variant="secondary" className="flex-1 gap-1">
                            <a
                              href={`https://youtu.be/${job.youtube_video_id}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <Youtube className="h-4 w-4" />
                              On YouTube
                            </a>
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="flex-1 gap-1"
                            onClick={() => setPublishTarget({ id: job.id, title: job.title ?? "" })}
                          >
                            <Youtube className="h-4 w-4" />
                            Publish
                          </Button>
                        ))}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Delete ${job.title}`}
                            disabled={remove.isPending && remove.variables === job.id}
                          >
                            {remove.isPending && remove.variables === job.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete &ldquo;{job.title}&rdquo;?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This permanently deletes the video and its files. This cannot be
                              undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Keep video</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => remove.mutate(job.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Delete video
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <ModeChooser
        open={modeChooserOpen}
        onOpenChange={setModeChooserOpen}
        title="New video"
        description="Pick Script to Video, Voiceover, or Automatic Edit."
        onChoose={(mode) => {
          setModeChooserOpen(false);
          void navigate({ to: "/studio", search: { create: mode } });
        }}
      />
      {publishTarget && (
        <PublishDialog
          jobId={publishTarget.id}
          jobTitle={publishTarget.title}
          open
          onOpenChange={(open) => {
            if (!open) setPublishTarget(null);
          }}
        />
      )}
    </main>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
}) {
  return (
    <div className="bg-card p-5">
      <dt className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em]">{label}</span>
      </dt>
      {value === null ? (
        <Skeleton className="mt-3 h-8 w-20" />
      ) : (
        <dd className="mt-2 font-display text-3xl font-semibold capitalize tracking-tight text-foreground tabular-nums">
          {value}
        </dd>
      )}
    </div>
  );
}
