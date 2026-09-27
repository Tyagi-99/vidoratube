import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Grid3X3,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  getCalendarJobs,
  reschedulePublishJob,
  type CalendarJob,
} from "@/lib/publish/calendar.functions";

/**
 * Phase 4, Stream A (F28) — content calendar over publish_jobs.scheduled_for.
 *
 * Week / month / pipeline views. Drag-and-drop reschedules via
 * reschedulePublishJob (server-only, audit-logged). HARD RULES (D164):
 * - Only approved/scheduled jobs can be moved. Drafts must be approved first —
 *   dropping a draft shows an error, never schedules it.
 * - Rescheduling never publishes: it only moves scheduled_for.
 * - Drops in the past are refused; "unschedule" drops move the job back to
 *   approved (scheduled_for = null).
 */

type View = "week" | "month" | "pipeline";

const STATUS_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  approved: "secondary",
  scheduled: "default",
  uploading: "secondary",
  published: "default",
  failed: "destructive",
  canceled: "outline",
};

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Monday first
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function JobCard({
  job,
  draggable,
  onDragStart,
}: {
  job: CalendarJob;
  draggable: boolean;
  onDragStart: (job: CalendarJob) => void;
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/publish-job-id", job.id);
        onDragStart(job);
      }}
      className={`rounded-md border border-border bg-card p-2 text-xs shadow-sm ${
        draggable ? "cursor-grab active:cursor-grabbing" : "opacity-70"
      }`}
      title={job.title ?? "Untitled"}
    >
      <p className="truncate font-medium">{job.title ?? "Untitled"}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <Badge variant={STATUS_TONE[job.status] ?? "outline"} className="text-[10px]">
          {job.status}
        </Badge>
        {job.scheduled_for && <span className="text-muted-foreground">{fmtTime(job.scheduled_for)}</span>}
        {job.safety_score != null && (
          <span className={job.safety_score < 50 ? "font-semibold text-destructive" : "text-muted-foreground"}>
            {job.safety_score}
          </span>
        )}
      </div>
    </div>
  );
}

export function PublishCalendar() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [dragging, setDragging] = useState<CalendarJob | null>(null);

  const listFn = useServerFn(getCalendarJobs);
  const rescheduleFn = useServerFn(reschedulePublishJob);

  const { from, to } = useMemo(() => {
    if (view === "pipeline") {
      const now = new Date();
      return { from: new Date(now.getTime() - 365 * 86400_000), to: new Date(now.getTime() + 365 * 86400_000) };
    }
    if (view === "week") {
      const start = startOfWeek(anchor);
      return { from: start, to: addDays(start, 7) };
    }
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const start = startOfWeek(first);
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    return { from: start, to: addDays(startOfWeek(last), 7) };
  }, [view, anchor]);

  const jobsQuery = useQuery({
    queryKey: ["calendar", view, from.toISOString(), to.toISOString()],
    queryFn: () => listFn({ data: { from: from.toISOString(), to: to.toISOString() } }),
  });
  const jobs = useMemo(() => jobsQuery.data?.jobs ?? [], [jobsQuery.data]);

  const reschedule = useMutation({
    mutationFn: (input: { publish_job_id: string; scheduled_for: string | null }) =>
      rescheduleFn({ data: input }),
    onSuccess: (result: { publishJob: { scheduled_for: string | null } }) => {
      toast.success(
        result.publishJob.scheduled_for
          ? `Scheduled for ${new Date(result.publishJob.scheduled_for).toLocaleString()}`
          : "Unscheduled — back to approved",
      );
      setDragging(null);
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setDragging(null);
    },
  });

  const dropOnDay = (day: Date) => {
    const job = dragging;
    if (!job || reschedule.isPending) return;
    if (job.status !== "approved" && job.status !== "scheduled") {
      toast.error("Drafts must be approved in Review Studio before they can be scheduled.");
      setDragging(null);
      return;
    }
    const at = new Date(day);
    at.setHours(9, 0, 0, 0); // default slot: 9:00 local
    if (at.getTime() <= Date.now()) {
      toast.error("Can't schedule in the past.");
      setDragging(null);
      return;
    }
    reschedule.mutate({ publish_job_id: job.id, scheduled_for: at.toISOString() });
  };

  const unschedule = () => {
    const job = dragging;
    if (!job || reschedule.isPending) return;
    if (job.status !== "scheduled") {
      toast.error("Only scheduled jobs can be unscheduled.");
      setDragging(null);
      return;
    }
    reschedule.mutate({ publish_job_id: job.id, scheduled_for: null });
  };

  const jobsByDay = useMemo(() => {
    const map = new Map<string, CalendarJob[]>();
    for (const j of jobs) {
      if (!j.scheduled_for) continue;
      const d = new Date(j.scheduled_for);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(j);
    }
    return map;
  }, [jobs]);

  const days: Date[] = useMemo(() => {
    const arr: Date[] = [];
    const cursor = new Date(from);
    while (cursor < to) {
      arr.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return arr;
  }, [from, to]);

  const moveAnchor = (dir: 1 | -1) => {
    if (view === "week") setAnchor(addDays(anchor, 7 * dir));
    else setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1));
  };

  const title =
    view === "pipeline"
      ? "Pipeline"
      : view === "week"
        ? `Week of ${startOfWeek(anchor).toLocaleDateString()}`
        : anchor.toLocaleDateString([], { month: "long", year: "numeric" });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border p-1">
          {(
            [
              { id: "week", label: "Week", icon: CalendarDays },
              { id: "month", label: "Month", icon: Grid3X3 },
              { id: "pipeline", label: "Pipeline", icon: Columns3 },
            ] as const
          ).map((v) => (
            <Button
              key={v.id}
              variant={view === v.id ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setView(v.id)}
            >
              <v.icon className="mr-1 h-3.5 w-3.5" /> {v.label}
            </Button>
          ))}
        </div>
        {view !== "pipeline" && (
          <>
            <Button variant="outline" size="sm" onClick={() => moveAnchor(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium">{title}</span>
            <Button variant="outline" size="sm" onClick={() => moveAnchor(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAnchor(new Date())}>
              Today
            </Button>
          </>
        )}
        {dragging && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              unschedule();
            }}
            className="ml-auto flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Drop here to unschedule (back to approved)
          </div>
        )}
      </div>

      {jobsQuery.isLoading ? (
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      ) : jobsQuery.isError ? (
        <p className="text-sm text-destructive">Couldn't load jobs: {(jobsQuery.error as Error).message}</p>
      ) : view === "pipeline" ? (
        <PipelineView jobs={jobs} onDragStart={setDragging} />
      ) : (
        <div className={`grid gap-2 ${view === "week" ? "grid-cols-7" : "grid-cols-7"}`}>
          {days.map((day) => {
            const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
            const isToday = new Date().toDateString() === day.toDateString();
            const dayJobs = (jobsByDay.get(key) ?? []).sort((a, b) =>
              (a.scheduled_for ?? "").localeCompare(b.scheduled_for ?? ""),
            );
            return (
              <Card
                key={key}
                className={`min-h-28 ${isToday ? "border-primary/50" : ""}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  dropOnDay(day);
                }}
              >
                <CardContent className="space-y-1.5 p-2">
                  <p className={`text-xs font-medium ${isToday ? "text-primary" : "text-muted-foreground"}`}>
                    {view === "week"
                      ? day.toLocaleDateString([], { weekday: "short", day: "numeric" })
                      : day.getDate()}
                  </p>
                  {dayJobs.map((j) => (
                    <JobCard
                      key={j.id}
                      job={j}
                      draggable={j.status === "approved" || j.status === "scheduled"}
                      onDragStart={setDragging}
                    />
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Drag approved or scheduled jobs between days to reschedule (audit-logged). Scheduling never
        publishes — execution still needs an explicit "Publish now" from an approved job. Drafts live
        in the pipeline and must be approved in Review Studio first.
      </p>
    </div>
  );
}

const PIPELINE_COLUMNS = ["draft", "approved", "scheduled", "uploading", "published", "failed", "canceled"] as const;

function PipelineView({
  jobs,
  onDragStart,
}: {
  jobs: CalendarJob[];
  onDragStart: (job: CalendarJob) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
      {PIPELINE_COLUMNS.map((status) => {
        const col = jobs
          .filter((j) => j.status === status)
          .sort((a, b) => (a.scheduled_for ?? a.created_at).localeCompare(b.scheduled_for ?? b.created_at));
        return (
          <div key={status} className="rounded-lg border border-border bg-muted/30 p-2">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {status} ({col.length})
            </p>
            <div className="space-y-1.5">
              {col.map((j) => (
                <JobCard
                  key={j.id}
                  job={j}
                  draggable={j.status === "approved" || j.status === "scheduled"}
                  onDragStart={onDragStart}
                />
              ))}
              {col.length === 0 && (
                <p className="py-2 text-center text-[11px] text-muted-foreground">—</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
