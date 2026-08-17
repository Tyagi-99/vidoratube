import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { GenerateVideoDialog } from "@/components/vidora/GenerateVideoDialog";
import { YouTubePanel } from "@/components/vidora/YouTubePanel";
import { publishJobToYouTube } from "@/lib/youtube.functions";
import { getMyAccount, listMyJobs, deleteMyJob } from "@/lib/jobs.functions";
import { supabase } from "@/integrations/supabase/client";
import { Coins, Film, LayoutDashboard, LogOut, Plus, Shield, Trash2, Youtube, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/studio")({
  head: () => ({
    meta: [
      { title: "Studio dashboard — Vidora AI" },
      { name: "description", content: "Your Vidora AI studio: render videos, track jobs and manage credits." },
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const accountFn = useServerFn(getMyAccount);
  const jobsFn = useServerFn(listMyJobs);
  const removeFn = useServerFn(deleteMyJob);

  const account = useQuery({ queryKey: ["account"], queryFn: () => accountFn({}) });
  const jobs = useQuery({ queryKey: ["my-jobs"], queryFn: () => jobsFn({}) });

  const remove = useMutation({
    mutationFn: (id: string) => removeFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Video deleted");
      queryClient.invalidateQueries({ queryKey: ["my-jobs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const publishFn = useServerFn(publishJobToYouTube);
  const publish = useMutation({
    mutationFn: (id: string) => publishFn({ data: { id, privacy: "private" as const } }),
    onSuccess: (res) => {
      toast.success("Published to YouTube (private)", {
        description: res.url,
      });
      queryClient.invalidateQueries({ queryKey: ["my-jobs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const profile = account.data?.profile;

  return (
    <main className="min-h-screen bg-top-glow px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Studio
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {profile?.display_name ? `Hey, ${profile.display_name}` : "Your studio"}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {account.data?.isAdmin && (
              <Button asChild variant="outline" className="gap-2">
                <Link to="/admin">
                  <Shield className="h-4 w-4" />
                  Admin
                </Link>
              </Button>
            )}
            <Button variant="ghost" onClick={signOut} className="gap-2">
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
            <Button onClick={() => setDialogOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              New video
            </Button>
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <StatCard
            icon={<Coins className="h-4 w-4" />}
            label="Credits left"
            value={account.isLoading ? null : String(profile?.credits ?? 0)}
          />
          <StatCard
            icon={<Film className="h-4 w-4" />}
            label="Videos rendered"
            value={account.isLoading ? null : String(account.data?.jobCount ?? 0)}
          />
          <StatCard
            icon={<LayoutDashboard className="h-4 w-4" />}
            label="Plan"
            value={account.isLoading ? null : (profile?.plan ?? "free")}
          />
        </div>

        <div className="mt-4">
          <YouTubePanel />
        </div>

        <h2 className="mt-12 text-xl font-bold tracking-tight text-foreground">Your videos</h2>

        {jobs.isLoading ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-56 rounded-2xl" />
            ))}
          </div>
        ) : (jobs.data ?? []).length === 0 ? (
          <Card className="mt-4 border-dashed border-border bg-card">
            <CardContent className="flex flex-col items-center gap-4 p-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Film className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-foreground">No videos yet</p>
                <p className="text-sm text-muted-foreground">
                  Paste a script and Vidora will handle the rest.
                </p>
              </div>
              <Button onClick={() => setDialogOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                Make your first video
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(jobs.data ?? []).map((job) => (
              <div key={job.id} className="surface-card overflow-hidden">
                <div className="relative aspect-video w-full bg-muted">
                  {job.thumbnail_url && (
                    <img
                      src={job.thumbnail_url}
                      alt={`Thumbnail for ${job.title}`}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  )}
                  <span
                    className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${statusStyles[job.status] ?? "bg-muted"}`}
                  >
                    {job.status}
                  </span>
                </div>
                <div className="space-y-3 p-4">
                  <p className="line-clamp-2 font-semibold text-foreground">{job.title}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary" className="capitalize">
                      {job.format}
                    </Badge>
                    <Badge variant="secondary" className="capitalize">
                      {job.voice}
                    </Badge>
                    <span>{new Date(job.created_at).toLocaleDateString()}</span>
                  </div>
                  {job.error && <p className="text-xs text-destructive">{job.error}</p>}
                  <div className="flex flex-wrap gap-2">
                    {job.result_url && (
                      <Button asChild size="sm" variant="outline" className="flex-1">
                        <a href={job.result_url} target="_blank" rel="noreferrer">
                          Open
                        </a>
                      </Button>
                    )}
                    {job.status === "completed" && (
                      <CapCutExportButton job={job} className="flex-1 gap-1" />
                    )}

                    {job.status === "completed" && job.result_url && (
                      job.youtube_video_id ? (
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
                          onClick={() => publish.mutate(job.id)}
                          disabled={publish.isPending}
                        >
                          {publish.isPending && publish.variables === job.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Youtube className="h-4 w-4" />
                          )}
                          Publish
                        </Button>
                      )
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => remove.mutate(job.id)}
                      aria-label={`Delete ${job.title}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <GenerateVideoDialog open={dialogOpen} onOpenChange={setDialogOpen} />
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
    <div className="surface-card p-5">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-[0.14em]">{label}</span>
      </div>
      {value === null ? (
        <Skeleton className="mt-3 h-8 w-20" />
      ) : (
        <p className="mt-2 text-3xl font-bold capitalize tracking-tight text-foreground">{value}</p>
      )}
    </div>
  );
}
