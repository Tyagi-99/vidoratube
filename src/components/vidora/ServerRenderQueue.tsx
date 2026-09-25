import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import {
  cancelServerRender,
  listServerRenders,
} from "@/lib/server-renders.functions";

type QueueRow = {
  id: string;
  status: string;
  stage: string;
  progress: number;
  aspect_ratio: string | null;
  resolution: string | null;
  file_url: string | null;
  error: string | null;
  created_at: string;
};

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  running: "Rendering",
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

/**
 * Server render queue: live progress via Supabase Realtime, cancel button,
 * download link on completion.
 */
export function ServerRenderQueue({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const listFn = useServerFn(listServerRenders);
  const cancelFn = useServerFn(cancelServerRender);

  useEffect(() => {
    let alive = true;
    listFn({ data: { projectId } })
      .then((r) => {
        if (alive) setRows(r as QueueRow[]);
      })
      .catch(() => {});

    // Live updates: the worker heartbeats progress into this table.
    const channel = supabase
      .channel(`server-renders:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "renders",
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          const next = payload.new as QueueRow;
          if (!next?.id) return;
          setRows((prev) => {
            const i = prev.findIndex((r) => r.id === next.id);
            if (i === -1) return [next, ...prev].slice(0, 20);
            const copy = [...prev];
            copy[i] = { ...copy[i], ...next };
            return copy;
          });
        },
      )
      .subscribe();
    return () => {
      alive = false;
      void supabase.removeChannel(channel);
    };
  }, [projectId, listFn]);

  if (rows.length === 0) return null;

  const active = rows.filter((r) => r.status === "queued" || r.status === "running");

  const onCancel = async (id: string) => {
    setCancelling(id);
    try {
      await cancelFn({ data: { id } });
    } finally {
      setCancelling(null);
    }
  };

  return (
    <div className="space-y-3" aria-label="Server render queue">
      <h3 className="text-sm font-medium">Server renders</h3>
      {active.length > 0 && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
          <p className="text-sm text-foreground">
            <span className="font-semibold">You can close this tab.</span>{" "}
            {active.length} render{active.length === 1 ? " is" : "s are"} running on the server —
            progress updates live below, and you&apos;ll find the finished MP4
            {active.length === 1 ? "" : "s"} here when you come back.
          </p>
        </div>
      )}
      {rows.map((r) => (
        <div key={r.id} className="rounded-lg border p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge variant={r.status === "failed" ? "destructive" : "secondary"}>
                {STATUS_LABEL[r.status] ?? r.status}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {r.aspect_ratio ?? ""} {r.resolution ? `· ${r.resolution}` : ""}
              </span>
            </div>
            {(r.status === "queued" || r.status === "running") && (
              <Button
                size="sm"
                variant="outline"
                disabled={cancelling === r.id}
                onClick={() => onCancel(r.id)}
              >
                {cancelling === r.id ? "Cancelling…" : "Cancel"}
              </Button>
            )}
            {r.status === "completed" && r.file_url && (
              <Button size="sm" variant="outline" asChild>
                <a href={r.file_url} download>
                  Download MP4
                </a>
              </Button>
            )}
          </div>
          {(r.status === "running" || r.status === "queued") && (
            <>
              <Progress value={r.progress} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {r.stage} — {r.progress}%
              </p>
            </>
          )}
          {r.status === "failed" && r.error && (
            <p className="text-xs text-destructive">{r.error}</p>
          )}
          {r.status === "cancelled" && (
            <p className="text-xs text-muted-foreground">Cancelled</p>
          )}
        </div>
      ))}
    </div>
  );
}
