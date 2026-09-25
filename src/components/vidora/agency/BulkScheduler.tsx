import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarPlus, X } from "lucide-react";
import { bulkSchedule, listClientChannels } from "@/lib/agency/agency.functions";
import { listMyJobs } from "@/lib/jobs.functions";
import { listProjects } from "@/lib/studio.functions";
import { validateBulkSchedule } from "@/lib/agency/agency";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DraftItem {
  key: number;
  projectId: string;
  videoJobId: string;
  clientChannelId: string;
  scheduledFor: string;
  title: string;
}

function defaultDateTime(): string {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function BulkScheduler({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const channelsFn = useServerFn(listClientChannels);
  const jobsFn = useServerFn(listMyJobs);
  const projectsFn = useServerFn(listProjects);
  const scheduleFn = useServerFn(bulkSchedule);

  const [items, setItems] = useState<DraftItem[]>([]);
  const [counter, setCounter] = useState(0);
  const [projectId, setProjectId] = useState("");
  const [videoJobId, setVideoJobId] = useState("");
  const [clientChannelId, setClientChannelId] = useState("");
  const [scheduledFor, setScheduledFor] = useState(defaultDateTime);

  const channels = useQuery({
    queryKey: ["agency-channels", workspaceId],
    queryFn: () => channelsFn({ data: { workspaceId } }),
  });
  const jobs = useQuery({ queryKey: ["my-jobs"], queryFn: () => jobsFn() });
  const projects = useQuery({ queryKey: ["my-projects"], queryFn: () => projectsFn() });
  const finishedJobs = (jobs.data ?? []).filter(
    (j) => (j as { status?: string }).status === "completed",
  ) as { id: string; script?: string; project_id?: string | null }[];

  const addItem = () => {
    if (!projectId || !videoJobId || !clientChannelId) {
      toast.error("Pick a project, a video, and a channel first.");
      return;
    }
    setItems((prev) => [
      ...prev,
      { key: counter, projectId, videoJobId, clientChannelId, scheduledFor: new Date(scheduledFor).toISOString(), title: "" },
    ]);
    setCounter((c) => c + 1);
  };

  const schedule = useMutation({
    mutationFn: () => {
      const parsed = items.map((i) => ({
        projectId: i.projectId,
        videoJobId: i.videoJobId,
        clientChannelId: i.clientChannelId,
        scheduledFor: i.scheduledFor,
        ...(i.title.trim() ? { title: i.title.trim() } : {}),
      }));
      const check = validateBulkSchedule({ workspaceId, items: parsed });
      if (!check.ok) throw new Error(check.errors.join("; "));
      return scheduleFn({ data: { workspaceId, items: parsed } });
    },
    onSuccess: (r) => {
      toast.success(`${r.scheduled} video(s) scheduled as drafts — awaiting client approval`);
      setItems([]);
      queryClient.invalidateQueries({ queryKey: ["agency-approvals", workspaceId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not schedule"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Bulk scheduling</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Queue finished videos across client channels in one action. Everything is created as a{" "}
          <strong>draft</strong> behind a client approval — nothing publishes automatically.
        </p>

        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]">
          <div className="space-y-1">
            <Label>Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Project" />
              </SelectTrigger>
              <SelectContent>
                {(projects.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {(p as { title?: string }).title ?? p.id.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Video</Label>
            <Select value={videoJobId} onValueChange={setVideoJobId}>
              <SelectTrigger>
                <SelectValue placeholder="Finished video" />
              </SelectTrigger>
              <SelectContent>
                {finishedJobs.map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    {(j.script ?? "Video").slice(0, 40)}…
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Channel</Label>
            <Select value={clientChannelId} onValueChange={setClientChannelId}>
              <SelectTrigger>
                <SelectValue placeholder="Client channel" />
              </SelectTrigger>
              <SelectContent>
                {channels.data?.channels.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.platform} · {c.handle}
                    {c.is_test_channel ? " (test)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>When</Label>
            <Input
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button variant="outline" onClick={addItem} disabled={items.length >= 50}>
              Add
            </Button>
          </div>
        </div>

        {items.length > 0 && (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {items.map((i) => {
              const ch = channels.data?.channels.find((c) => c.id === i.clientChannelId);
              const proj = (projects.data ?? []).find((p) => p.id === i.projectId);
              return (
                <li key={i.key} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Badge variant="outline">{ch?.platform}</Badge>
                    <span className="text-muted-foreground">{ch?.handle}</span>
                    <span className="text-muted-foreground">
                      {(proj as { title?: string } | undefined)?.title ?? "Project"}
                    </span>
                    <span>{new Date(i.scheduledFor).toLocaleString()}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setItems((prev) => prev.filter((x) => x.key !== i.key))}
                    aria-label="Remove item"
                  >
                    <X className="size-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        <Button onClick={() => schedule.mutate()} disabled={schedule.isPending || items.length === 0}>
          <CalendarPlus className="mr-2 size-4" />
          {schedule.isPending ? "Scheduling…" : `Schedule ${items.length} as drafts`}
        </Button>
      </CardContent>
    </Card>
  );
}
