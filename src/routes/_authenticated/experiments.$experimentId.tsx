/**
 * F34 — Experiment detail: live stats, lifecycle actions, apply-winner.
 * Route: /experiments/$experimentId
 */
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, FlaskConical, Play, Pause, CheckCircle2, Upload } from "lucide-react";
import {
  applyWinner,
  concludeExperiment,
  getExperiment,
  pauseExperiment,
  recordArmMetrics,
  startExperiment,
} from "@/lib/experiments/experiments.functions";
import type { ConclusionEvaluation, PerArmConclusion } from "@/lib/experiments/experiments.server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const Route = createFileRoute("/_authenticated/experiments/$experimentId")({
  component: ExperimentDetail,
});

function fmtPct(x: number | null): string {
  return x === null ? "—" : `${(x * 100).toFixed(2)}%`;
}

function fmtP(p: number | null): string {
  if (p === null) return "—";
  if (p < 0.0001) return p.toExponential(1);
  return p.toFixed(4);
}

function SampleBar({ sample, required }: { sample: number; required: number }) {
  const pct = Math.min(100, (sample / required) * 100);
  return (
    <div className="flex items-center gap-2">
      <Progress value={pct} className="h-2 w-24" />
      <span className="text-xs text-muted-foreground">
        {sample.toLocaleString()} / {required.toLocaleString()}
      </span>
    </div>
  );
}

function GatePanel({ evaluation }: { evaluation: ConclusionEvaluation }) {
  const { sample_gate, duration_gate } = evaluation;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Conclusion gates</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-sm font-medium">Min sample {sample_gate.ok ? "✓" : "— not yet"}</p>
          <div className="mt-2 grid gap-2">
            {sample_gate.detail.map((d) => (
              <div key={d.arm_id} className="flex items-center justify-between gap-2 text-sm">
                <span className={d.ok ? "" : "text-muted-foreground"}>{d.arm_name}</span>
                <SampleBar sample={d.sample_size} required={d.required} />
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-sm font-medium">Min duration {duration_gate.ok ? "✓" : "— not yet"}</p>
          <div className="mt-2 flex items-center gap-2">
            <Progress
              value={Math.min(
                100,
                (duration_gate.elapsed_hours / duration_gate.required_hours) * 100,
              )}
              className="h-2 w-32"
            />
            <span className="text-xs text-muted-foreground">
              {duration_gate.elapsed_hours.toFixed(1)}h / {duration_gate.required_hours}h
            </span>
          </div>
          {!duration_gate.ok && (
            <p className="mt-2 text-xs text-muted-foreground">
              No conclusion — human or automatic — before the minimum duration.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ArmRow_sig({
  r,
  isCtr,
  required,
}: {
  r: PerArmConclusion;
  isCtr: boolean;
  required: number;
}) {
  return (
    <TableRow>
      <TableCell className="font-medium">
        {r.arm_name}
        <Badge variant="outline" className="ml-2 text-[10px]">
          {r.arm_type}
        </Badge>
      </TableCell>
      <TableCell>
        <SampleBar sample={r.sample_size} required={required} />
      </TableCell>
      <TableCell>{isCtr ? fmtPct(r.metric_value) : (r.metric_value?.toFixed(2) ?? "—")}</TableCell>
      <TableCell className="font-mono">{fmtP(r.p_value_vs_control)}</TableCell>
      <TableCell>
        {r.arm_type === "control" ? (
          <span className="text-xs text-muted-foreground">baseline</span>
        ) : r.significant_improvement ? (
          <Badge
            className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            variant="secondary"
          >
            significant ✓
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-muted-foreground">
            not yet significant
          </Badge>
        )}
      </TableCell>
    </TableRow>
  );
}

function ExperimentDetail() {
  const { experimentId } = Route.useParams();
  const queryClient = useQueryClient();
  const getFn = useServerFn(getExperiment);
  const startFn = useServerFn(startExperiment);
  const pauseFn = useServerFn(pauseExperiment);
  const recordFn = useServerFn(recordArmMetrics);
  const concludeFn = useServerFn(concludeExperiment);
  const applyFn = useServerFn(applyWinner);

  const [applyOpen, setApplyOpen] = useState(false);
  const [recordArmId, setRecordArmId] = useState<string>("");
  const [mImpressions, setMImpressions] = useState("");
  const [mClicks, setMClicks] = useState("");
  const [mN, setMN] = useState("");
  const [mMean, setMMean] = useState("");
  const [mVar, setMVar] = useState("");

  const detail = useQuery({
    queryKey: ["experiment", experimentId],
    queryFn: () => getFn({ data: { id: experimentId } }),
    refetchInterval: 30_000,
  });
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["experiment", experimentId] });

  const start = useMutation({
    mutationFn: () => startFn({ data: { id: experimentId } }),
    onSuccess: () => {
      toast.success("Experiment started.");
      invalidate();
    },
    onError: (e) => toast.error(`Start failed: ${(e as Error).message}`),
  });
  const pause = useMutation({
    mutationFn: () => pauseFn({ data: { id: experimentId } }),
    onSuccess: () => {
      toast.success("Experiment paused (back to draft).");
      invalidate();
    },
    onError: (e) => toast.error(`Pause failed: ${(e as Error).message}`),
  });
  const record = useMutation({
    mutationFn: () => {
      const exp = detail.data?.experiment;
      const isCtr = exp?.primary_metric === "ctr";
      const metrics = isCtr
        ? {
            impressions: parseInt(mImpressions, 10) || 0,
            clicks: parseInt(mClicks, 10) || 0,
          }
        : {
            n: parseInt(mN, 10) || 0,
            mean: parseFloat(mMean) || 0,
            variance: parseFloat(mVar) || 0,
          };
      return recordFn({ data: { experiment_id: experimentId, arm_id: recordArmId, metrics } });
    },
    onSuccess: (r) => {
      if (r.concluded) {
        toast.success(
          r.concluded.verdict === "winner"
            ? "Experiment auto-concluded with a winner. Nothing was auto-applied."
            : "Experiment auto-concluded: inconclusive.",
        );
      } else {
        toast.success("Metrics recorded.");
      }
      invalidate();
    },
    onError: (e) => toast.error(`Record failed: ${(e as Error).message}`),
  });
  const conclude = useMutation({
    mutationFn: () => concludeFn({ data: { id: experimentId } }),
    onSuccess: (r) => {
      if (!r.ok) {
        toast.info("Not ready to conclude yet — see the gates below.");
      } else {
        toast.success(
          r.verdict === "winner"
            ? "Concluded with a winner. Apply it manually if you want it live."
            : "Concluded: no significant winner.",
        );
      }
      invalidate();
    },
    onError: (e) => toast.error(`Conclude failed: ${(e as Error).message}`),
  });
  const apply = useMutation({
    mutationFn: () => applyFn({ data: { id: experimentId } }),
    onSuccess: (r) => {
      toast.success("Winner applied to the live video.");
      if (!r.auditLogged) {
        toast.warning("Applied, but the audit log could not be written (no workspace).");
      }
      setApplyOpen(false);
      invalidate();
    },
    onError: (e) => {
      toast.error(`Apply failed: ${(e as Error).message}`);
      setApplyOpen(false);
    },
  });

  if (detail.isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="mt-4 h-64 rounded-2xl" />
      </div>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Alert variant="destructive">
          <AlertTitle>Failed to load</AlertTitle>
          <AlertDescription>{(detail.error as Error)?.message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const { experiment: exp, arms, evaluation } = detail.data;
  const isCtr = exp.primary_metric === "ctr";
  const conclusion = exp.conclusion as {
    verdict?: "winner" | "inconclusive";
    winner_arm_id?: string | null;
    p_value?: number | null;
    method?: string;
    decided_by?: string;
    decided_at?: string;
  };
  const canApply =
    exp.status === "completed" && conclusion.verdict === "winner" && conclusion.winner_arm_id;
  const winnerArm = arms.find((a) => a.id === conclusion.winner_arm_id);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link
        to="/experiments"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> All experiments
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <FlaskConical className="size-6" aria-hidden="true" />
            {exp.name}
          </h1>
          {exp.hypothesis && (
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{exp.hypothesis}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary" className="capitalize">
              {exp.status}
            </Badge>
            <Badge variant="outline">{exp.primary_metric}</Badge>
            <Badge variant="outline">min {exp.min_sample_size}/arm</Badge>
            <Badge variant="outline">min {exp.min_duration_hours}h</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {exp.status === "draft" && (
            <Button onClick={() => start.mutate()} disabled={start.isPending}>
              <Play className="mr-2 size-4" aria-hidden="true" />
              {start.isPending ? "Starting…" : "Start"}
            </Button>
          )}
          {exp.status === "running" && (
            <>
              <Button variant="outline" onClick={() => pause.mutate()} disabled={pause.isPending}>
                <Pause className="mr-2 size-4" aria-hidden="true" /> Pause
              </Button>
              <Button onClick={() => conclude.mutate()} disabled={conclude.isPending}>
                <CheckCircle2 className="mr-2 size-4" aria-hidden="true" />
                {conclude.isPending ? "Checking…" : "Conclude"}
              </Button>
            </>
          )}
          {canApply && (
            <Button variant="default" onClick={() => setApplyOpen(true)}>
              <Upload className="mr-2 size-4" aria-hidden="true" /> Apply winner
            </Button>
          )}
        </div>
      </div>

      {exp.status !== "completed" && (
        <div className="mt-6">
          <GatePanel evaluation={evaluation} />
        </div>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Arms — live stats</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Arm</TableHead>
                <TableHead>Sample</TableHead>
                <TableHead>{isCtr ? "CTR" : "Mean"}</TableHead>
                <TableHead>p vs control</TableHead>
                <TableHead>Readout</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {evaluation.arm_results.map((r) => (
                <ArmRow_sig key={r.arm_id} r={r} isCtr={isCtr} required={exp.min_sample_size} />
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            Method: {evaluation.arm_results[0]?.method ?? "—"} · α = 0.05 · two-tailed. "Not yet
            significant" means exactly that — not a trend, not a hint.
          </p>
        </CardContent>
      </Card>

      {exp.status === "completed" && conclusion.verdict && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Conclusion</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge
                className={
                  conclusion.verdict === "winner"
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                    : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                }
                variant="secondary"
              >
                {conclusion.verdict === "winner" ? "winner found" : "inconclusive"}
              </Badge>
              <Badge variant="outline">decided by {conclusion.decided_by}</Badge>
              {conclusion.decided_at && (
                <Badge variant="outline">{new Date(conclusion.decided_at).toLocaleString()}</Badge>
              )}
            </div>
            {conclusion.verdict === "winner" && winnerArm && (
              <p>
                Winner: <span className="font-medium">{winnerArm.name}</span> · p ={" "}
                <span className="font-mono">{fmtP(conclusion.p_value ?? null)}</span> · method{" "}
                {conclusion.method}. Nothing was auto-applied — use "Apply winner" for the explicit
                human step.
              </p>
            )}
            {conclusion.verdict === "inconclusive" && (
              <p className="text-muted-foreground">
                No arm beat control significantly (best p ={" "}
                <span className="font-mono">{fmtP(conclusion.p_value ?? null)}</span>). This is a
                result, not a failure.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {(exp.status === "running" || exp.status === "draft") && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Record arm metrics</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label>Arm</Label>
              <select
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={recordArmId}
                onChange={(e) => setRecordArmId(e.target.value)}
              >
                <option value="">Select an arm…</option>
                {arms.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.arm_type})
                  </option>
                ))}
              </select>
            </div>
            {isCtr ? (
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Impressions</Label>
                  <Input
                    value={mImpressions}
                    onChange={(e) => setMImpressions(e.target.value)}
                    inputMode="numeric"
                    placeholder="2000"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Clicks</Label>
                  <Input
                    value={mClicks}
                    onChange={(e) => setMClicks(e.target.value)}
                    inputMode="numeric"
                    placeholder="140"
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                <div className="grid gap-2">
                  <Label>n (observations)</Label>
                  <Input
                    value={mN}
                    onChange={(e) => setMN(e.target.value)}
                    inputMode="numeric"
                    placeholder="120"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Mean</Label>
                  <Input
                    value={mMean}
                    onChange={(e) => setMMean(e.target.value)}
                    inputMode="decimal"
                    placeholder="48.2"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Variance</Label>
                  <Input
                    value={mVar}
                    onChange={(e) => setMVar(e.target.value)}
                    inputMode="decimal"
                    placeholder="195"
                  />
                </div>
              </div>
            )}
            <div>
              <Button onClick={() => record.mutate()} disabled={!recordArmId || record.isPending}>
                {record.isPending ? "Recording…" : "Record metrics"}
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Recording on a running experiment re-evaluates auto-conclude. Auto-conclude writes
                the conclusion only — it never applies the winner.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply winner to the live video?</DialogTitle>
            <DialogDescription>
              This updates the project's live title and/or thumbnail to the winning arm's content.
              It is a deliberate human action and will be audit-logged. It cannot be undone
              automatically.
            </DialogDescription>
          </DialogHeader>
          {winnerArm && (
            <div className="text-sm">
              <p>
                Winning arm: <span className="font-medium">{winnerArm.name}</span>
              </p>
              <p className="mt-1 text-muted-foreground">
                p = <span className="font-mono">{fmtP(conclusion.p_value ?? null)}</span> · method{" "}
                {conclusion.method}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setApplyOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => apply.mutate()} disabled={apply.isPending}>
              {apply.isPending ? "Applying…" : "Apply winner"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
