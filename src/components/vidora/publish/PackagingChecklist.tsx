/**
 * Phase 6 Stream E (P6) — PackagingChecklist: advisory pre-publish checklist
 * with reasoned dismissals (competitor pattern AT-10, D305).
 *
 * ADVISORY ONLY: fails here are packaging advice. Dismissing a warning never
 * bypasses Vidora's strict evidence/safety/approval gates — e.g. the
 * safety_score < 50 block in approvePublishJob still applies.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  dismissChecklistRule,
  getPackagingChecklist,
  restoreChecklistRule,
} from "@/lib/publish/checklist.functions";

export function PackagingChecklist({ publishJobId }: { publishJobId: string }) {
  const queryClient = useQueryClient();
  const getFn = useServerFn(getPackagingChecklist);
  const dismissFn = useServerFn(dismissChecklistRule);
  const restoreFn = useServerFn(restoreChecklistRule);

  const query = useQuery({
    queryKey: ["packaging-checklist", publishJobId],
    queryFn: () => getFn({ data: { publishJobId } }),
  });

  const [dismissing, setDismissing] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["packaging-checklist", publishJobId] });

  const dismiss = useMutation({
    mutationFn: (ruleId: string) =>
      dismissFn({ data: { ruleId, reason: reason.trim(), channelId: null } }),
    onSuccess: () => {
      toast.success("Warning dismissed with reason");
      setDismissing(null);
      setReason("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const restore = useMutation({
    mutationFn: (ruleId: string) => restoreFn({ data: { ruleId, channelId: null } }),
    onSuccess: () => {
      toast.success("Dismissal removed — warning is back");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (query.isLoading) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking packaging…
      </p>
    );
  }
  if (query.isError) {
    return (
      <p className="text-xs text-destructive">
        Couldn't load the packaging checklist: {(query.error as Error).message}
      </p>
    );
  }

  const findings = query.data?.findings ?? [];
  const open = findings.filter((f) => !f.passed && !f.dismissed);
  const passed = findings.filter((f) => f.passed);
  const dismissed = findings.filter((f) => !f.passed && f.dismissed);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Packaging checklist</h3>
        {open.length === 0 ? (
          <Badge variant="secondary">All clear</Badge>
        ) : (
          <Badge variant="outline">
            {open.length} item{open.length === 1 ? "" : "s"} to review
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Advisory only — dismissing items never bypasses safety or approval gates.
      </p>
      <ul className="space-y-1.5">
        {passed.map((f) => (
          <li key={f.id} className="flex items-start gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />
            <span>
              {f.label} <span className="opacity-70">· {f.detail}</span>
            </span>
          </li>
        ))}
        {open.map((f) => (
          <li key={f.id} className="rounded-md border border-border p-2.5 text-xs">
            <div className="flex items-start gap-2">
              {f.severity === "fail" ? (
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              ) : (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">{f.label}</p>
                <p className="mt-0.5 text-muted-foreground">
                  {f.detail} — {f.hint}
                </p>
                {dismissing === f.id ? (
                  <div className="mt-2 space-y-2">
                    <Textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Why is this OK for this video? (3–500 characters)"
                      maxLength={500}
                      rows={2}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => dismiss.mutate(f.id)}
                        disabled={dismiss.isPending || reason.trim().length < 3}
                      >
                        {dismiss.isPending && (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        )}
                        Dismiss with reason
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setDismissing(null);
                          setReason("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-1 h-auto p-0 text-xs underline"
                    onClick={() => setDismissing(f.id)}
                  >
                    Dismiss with reason
                  </Button>
                )}
              </div>
            </div>
          </li>
        ))}
        {dismissed.map((f) => (
          <li
            key={f.id}
            className="flex items-start gap-2 rounded-md bg-muted/40 p-2.5 text-xs text-muted-foreground"
          >
            <RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p>
                <span className="font-medium text-foreground">{f.label}</span> — dismissed
              </p>
              <p className="mt-0.5 italic">“{f.dismissalReason}”</p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-auto p-0 text-xs underline"
              onClick={() => restore.mutate(f.id)}
              disabled={restore.isPending}
            >
              Restore
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
