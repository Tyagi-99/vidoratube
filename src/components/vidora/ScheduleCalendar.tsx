import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarClock, Loader2, Youtube, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  cancelPublishJob,
  executePublishJob,
  listPublishJobs,
} from "@/lib/publish.functions";
import {
  isScheduledDue,
  msUntilDue,
} from "@/lib/scheduling";

type Job = {
  id: string;
  status: string;
  title: string | null;
  privacy: string;
  scheduled_for: string | null;
  youtube_video_id: string | null;
  youtube_url: string | null;
  error: string | null;
  created_at: string;
};

function formatCountdown(ms: number | null): string | null {
  if (ms === null) return null;
  if (ms <= 0) return "Due now";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `in ${hours}h`;
  const days = Math.floor(hours / 24);
  return `in ${days}d`;
}

const statusVariant = (status: string) =>
  status === "published"
    ? ("default" as const)
    : status === "failed"
      ? ("destructive" as const)
      : status === "scheduled"
        ? ("outline" as const)
        : ("secondary" as const);

/**
 * Scheduling calendar: lists scheduled publishes with their scheduled time,
 * platform, and status. Scheduling NEVER auto-publishes — a scheduled job
 * waits for its time and still requires an explicit human "Publish now"
 * press (executePublishJob), which is only possible after the approval gate
 * (approvePublishJob) has moved the job out of draft.
 */
export function ScheduleCalendar({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listPublishJobs);
  const executeFn = useServerFn(executePublishJob);
  const cancelFn = useServerFn(cancelPublishJob);

  const jobs = useQuery({
    queryKey: ["publish-jobs", projectId],
    queryFn: () => listFn({}),
  });
  const all = (jobs.data?.jobs ?? []) as Job[];

  const upcoming = useMemo(
    () =>
      all.filter((j) => ["scheduled", "approved"].includes(j.status)).sort((a, b) => {
        const ta = a.scheduled_for ? new Date(a.scheduled_for).getTime() : 0;
        const tb = b.scheduled_for ? new Date(b.scheduled_for).getTime() : 0;
        return ta - tb;
      }),
    [all],
  );
  const past = useMemo(
    () => all.filter((j) => !["scheduled", "approved"].includes(j.status)),
    [all],
  );

  const execute = useMutation({
    mutationFn: (id: string) => executeFn({ data: { publish_job_id: id } }),
    onSuccess: (res) => {
      toast.success("Published to YouTube", { description: res.url });
      queryClient.invalidateQueries({ queryKey: ["publish-jobs", projectId] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      queryClient.invalidateQueries({ queryKey: ["publish-jobs", projectId] });
    },
  });

  const cancel = useMutation({
    mutationFn: (id: string) => cancelFn({ data: { publish_job_id: id } }),
    onSuccess: () => {
      toast.success("Publish canceled");
      queryClient.invalidateQueries({ queryKey: ["publish-jobs", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (jobs.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4" />
        <h3 className="text-sm font-semibold">Scheduling calendar</h3>
      </div>

      {upcoming.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nothing scheduled. Approve a video in the steps above to schedule it.
        </p>
      ) : (
        <div className="space-y-2">
          {upcoming.map((job) => {
            const due = isScheduledDue(job);
            const countdown = formatCountdown(msUntilDue(job));
            return (
              <div
                key={job.id}
                className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{job.title ?? "Untitled"}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Youtube className="h-3.5 w-3.5" /> YouTube
                    </span>
                    {job.scheduled_for ? (
                      <span>
                        {new Date(job.scheduled_for).toLocaleString()}
                        {countdown && ` · ${countdown}`}
                      </span>
                    ) : (
                      <span>Ready when you are</span>
                    )}
                    <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    size="sm"
                    disabled={!due || execute.isPending}
                    onClick={() => execute.mutate(job.id)}
                    title={
                      due
                        ? "Publish now (explicit human action)"
                        : "Not due yet — scheduled videos never publish on their own"
                    }
                  >
                    {execute.isPending ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Rocket className="mr-1 h-3.5 w-3.5" />
                    )}
                    Publish now
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={cancel.isPending}
                    onClick={() => cancel.mutate(job.id)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Scheduled videos never publish on their own — “Publish now” is an explicit
        human action, and only approved jobs can run.
      </p>

      {past.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase text-muted-foreground">Past</h4>
          {past.map((job) => (
            <div
              key={job.id}
              className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm opacity-80"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{job.title ?? "Untitled"}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(job.created_at).toLocaleDateString()}
                  {job.youtube_url && (
                    <>
                      {" · "}
                      <a
                        href={job.youtube_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline"
                      >
                        YouTube
                      </a>
                    </>
                  )}
                  {job.error && <span className="text-destructive"> · {job.error}</span>}
                </p>
              </div>
              <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
