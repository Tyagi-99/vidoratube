import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, Circle, Loader2, Play, SkipForward, XCircle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  getQuickCreateRun,
  listQuickCreateRuns,
  runQuickCreateStage,
  startQuickCreate,
} from "@/lib/creation/quick-create/quick-create.functions";
import { enqueueServerRender } from "@/lib/server-renders.functions";
import type { QuickCreateStage, QuickCreateStageStatus } from "@/lib/creation/contracts";

export const Route = createFileRoute("/_authenticated/create/quick-create")({
  component: QuickCreate,
});

const STAGE_ORDER = [
  "idea",
  "research",
  "script",
  "scenes",
  "voiceover",
  "visuals",
  "assemble",
  "qc",
  "captions",
  "music",
  "render",
] as const;

const STAGE_LABELS: Record<string, string> = {
  idea: "Idea",
  research: "Research & sources",
  script: "Script",
  scenes: "Scenes",
  voiceover: "Voiceover",
  visuals: "Stock visuals",
  assemble: "Assemble",
  qc: "QC",
  captions: "Captions",
  music: "Music",
  render: "Render",
};

function StatusIcon({ status }: { status: QuickCreateStageStatus }) {
  if (status === "done") return <CheckCircle2 className="size-5 text-green-600" />;
  if (status === "failed") return <XCircle className="size-5 text-red-600" />;
  if (status === "running") return <Loader2 className="size-5 animate-spin text-blue-600" />;
  if (status === "skipped_unconfigured" || status === "skipped_needs_spend_approval")
    return <SkipForward className="size-5 text-amber-600" />;
  return <Circle className="size-5 text-muted-foreground" />;
}

function statusBadge(status: QuickCreateStageStatus) {
  const map: Record<QuickCreateStageStatus, string> = {
    pending: "Pending",
    running: "Running",
    done: "Done",
    failed: "Failed",
    skipped_unconfigured: "Skipped — not configured",
    skipped_needs_spend_approval: "Skipped — needs spend approval",
  };
  return <Badge variant={status === "done" ? "default" : "outline"}>{map[status]}</Badge>;
}

type FactInput = { text: string; title: string; url: string };

function QuickCreate() {
  const queryClient = useQueryClient();
  const [runId, setRunId] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [hook, setHook] = useState("");
  const [facts, setFacts] = useState<FactInput[]>([
    { text: "", title: "", url: "" },
    { text: "", title: "", url: "" },
  ]);
  const [spendApproved, setSpendApproved] = useState(false);

  const startFn = useServerFn(startQuickCreate);
  const getFn = useServerFn(getQuickCreateRun);
  const listFn = useServerFn(listQuickCreateRuns);
  const stageFn = useServerFn(runQuickCreateStage);
  const enqueueFn = useServerFn(enqueueServerRender);

  const runsQuery = useQuery({ queryKey: ["qc-runs"], queryFn: () => listFn() });
  const runQuery = useQuery({
    queryKey: ["qc-run", runId],
    queryFn: () => getFn({ data: { runId: runId! } }),
    enabled: !!runId,
    refetchInterval: 3000,
  });

  const startMutation = useMutation({
    mutationFn: () =>
      startFn({
        data: {
          topic: topic.trim(),
          hook: hook.trim(),
          facts: facts
            .filter((f) => f.text.trim())
            .map((f) => ({
              text: f.text.trim(),
              title: f.title.trim(),
              url: f.url.trim() || undefined,
            })),
          spendApproved,
        },
      }),
    onSuccess: (res) => {
      setRunId(res.runId);
      queryClient.invalidateQueries({ queryKey: ["qc-runs"] });
      toast.success("Quick-create run started.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not start the run."),
  });

  const stageMutation = useMutation({
    mutationFn: (stage: (typeof STAGE_ORDER)[number]) =>
      stageFn({ data: { runId: runId!, stage, spendApproved } }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["qc-run", runId] });
      const s = res.stage as QuickCreateStage;
      if (s.status === "failed") toast.error(`Stage ${s.stage} failed: ${s.detail}`);
      else if (s.status.startsWith("skipped"))
        toast.warning(`Stage ${s.stage} skipped: ${s.detail}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Stage failed."),
  });

  const enqueueMutation = useMutation({
    mutationFn: (payload: {
      projectId: string;
      scenes: Array<Record<string, unknown>>;
      title: string;
    }) =>
      enqueueFn({
        data: {
          projectId: payload.projectId,
          title: payload.title,
          scenes: payload.scenes as never,
          aspects: ["9:16"],
          burnCaptions: true,
          musicDucking: true,
        },
      }),
    onSuccess: () => toast.success("Render enqueued — track it in Renders."),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not enqueue the render."),
  });

  const run = runQuery.data?.run as unknown as
    | {
        id: string;
        topic: string;
        project_id: string;
        stage_states: Record<string, QuickCreateStage>;
        artifacts: Record<string, unknown>;
      }
    | undefined;

  const enqueuePayload = run?.artifacts?.["assemble"] as
    { enqueuePayload?: { scenes: Array<Record<string, unknown>> } } | undefined;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">30-second Quick Create</h1>
        <p className="text-sm text-muted-foreground">
          One screen, whole pipeline: idea → research → script → scenes → voiceover → visuals →
          assemble → QC → captions → music → render. Free stages run fully; paid stages never fake
          completion — they skip honestly until a provider is configured and spend is approved.
        </p>
      </div>

      {!runId && (
        <Card>
          <CardHeader>
            <CardTitle>New quick-create run</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="qc-topic">Topic</Label>
              <Input
                id="qc-topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Why do airplane windows have a tiny hole?"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="qc-hook">Hook (one line)</Label>
              <Input
                id="qc-hook"
                value={hook}
                onChange={(e) => setHook(e.target.value)}
                placeholder="See that tiny hole at the bottom of your airplane window?"
              />
            </div>
            <div className="space-y-3">
              <Label>Verified facts + sources (≥2 distinct source URLs required)</Label>
              {facts.map((f, i) => (
                <div key={i} className="space-y-2 rounded-md border p-3">
                  <Textarea
                    value={f.text}
                    onChange={(e) =>
                      setFacts((prev) =>
                        prev.map((p, j) => (j === i ? { ...p, text: e.target.value } : p)),
                      )
                    }
                    placeholder={`Fact ${i + 1} — paste the source-verified wording`}
                    rows={2}
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      value={f.title}
                      onChange={(e) =>
                        setFacts((prev) =>
                          prev.map((p, j) => (j === i ? { ...p, title: e.target.value } : p)),
                        )
                      }
                      placeholder="Source title"
                    />
                    <Input
                      value={f.url}
                      onChange={(e) =>
                        setFacts((prev) =>
                          prev.map((p, j) => (j === i ? { ...p, url: e.target.value } : p)),
                        )
                      }
                      placeholder="https:// source URL"
                    />
                  </div>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFacts((p) => [...p, { text: "", title: "", url: "" }])}
              >
                Add fact
              </Button>
            </div>
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
              <Checkbox
                id="qc-spend"
                checked={spendApproved}
                onCheckedChange={(v) => setSpendApproved(v === true)}
              />
              <Label htmlFor="qc-spend" className="text-sm">
                I approve paid spend for this run (voiceover, visuals, render). Without this, paid
                stages are skipped with their exact ESTIMATE — nothing is charged.
              </Label>
            </div>
            <Button
              onClick={() => startMutation.mutate()}
              disabled={
                startMutation.isPending ||
                !topic.trim() ||
                facts.filter((f) => f.text.trim()).length < 1
              }
            >
              {startMutation.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Zap className="mr-2 size-4" />
              )}
              Start quick create
            </Button>
          </CardContent>
        </Card>
      )}

      {runId && (
        <>
          {runQuery.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : run ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>{run.topic}</span>
                    {statusBadge(
                      (Object.values(run.stage_states).every(
                        (s) => s.status === "done" || s.status.startsWith("skipped"),
                      )
                        ? "done"
                        : "pending") as QuickCreateStageStatus,
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {STAGE_ORDER.map((key) => {
                    const s = run.stage_states[key];
                    if (!s) return null;
                    return (
                      <div key={key} className="flex items-start gap-3 rounded-md border p-3">
                        <StatusIcon status={s.status} />
                        <div className="flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{STAGE_LABELS[key]}</span>
                            {statusBadge(s.status)}
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">{s.detail}</p>
                          {s.costEstimateCredits !== null && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              ESTIMATE: {s.costEstimateCredits} credit(s) for the real call.
                            </p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={s.status === "running" || stageMutation.isPending}
                          onClick={() => stageMutation.mutate(key)}
                        >
                          {s.status === "running" ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Play className="size-4" />
                          )}
                          <span className="ml-1">Run</span>
                        </Button>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              {enqueuePayload?.enqueuePayload && (
                <Card>
                  <CardHeader>
                    <CardTitle>Render</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      The render package is ready. Enqueueing starts the real server render
                      (existing render path with its own credit preflight) — nothing renders until
                      you press this button.
                    </p>
                    <Button
                      onClick={() =>
                        enqueueMutation.mutate({
                          projectId: run.project_id,
                          title: run.topic.slice(0, 120),
                          scenes: enqueuePayload.enqueuePayload!.scenes,
                        })
                      }
                      disabled={enqueueMutation.isPending}
                    >
                      {enqueueMutation.isPending ? (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      ) : (
                        <Play className="mr-2 size-4" />
                      )}
                      Enqueue real render (9:16)
                    </Button>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle>Artifacts</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">
                    {JSON.stringify(run.artifacts, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Run not found.</p>
          )}
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent runs</CardTitle>
        </CardHeader>
        <CardContent>
          {runsQuery.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (runsQuery.data?.runs?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No quick-create runs yet.</p>
          ) : (
            <div className="space-y-2">
              {runsQuery.data!.runs.map((r: { id: string; topic: string }) => (
                <Button
                  key={r.id}
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => setRunId(r.id)}
                >
                  {r.topic}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
