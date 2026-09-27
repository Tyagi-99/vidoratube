/**
 * F34 — Experiments list + creation.
 * Route: /experiments
 */
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, FlaskConical, Trash2 } from "lucide-react";
import { createExperiment, listExperiments } from "@/lib/experiments/experiments.functions";
import { PRIMARY_METRICS } from "@/lib/experiments/experiments.server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/experiments/")({
  component: ExperimentsIndex,
});

const STATUS_FILTERS = ["all", "draft", "running", "completed", "archived"] as const;

function statusBadge(status: string) {
  const map: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    running: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    completed: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    archived: "bg-muted text-muted-foreground",
  };
  return (
    <Badge className={map[status] ?? ""} variant="secondary">
      {status}
    </Badge>
  );
}

interface ArmDraft {
  name: string;
  arm_type: "control" | "variant";
  title_variant_id: string;
  thumbnail_id: string;
  traffic_split: string;
}

function emptyArm(type: "control" | "variant", name: string): ArmDraft {
  return { name, arm_type: type, title_variant_id: "", thumbnail_id: "", traffic_split: "" };
}

function ExperimentsIndex() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [dialogOpen, setDialogOpen] = useState(false);

  const listFn = useServerFn(listExperiments);
  const experiments = useQuery({
    queryKey: ["experiments", filter],
    queryFn: () => listFn({ data: { status: filter === "all" ? undefined : filter, limit: 50 } }),
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <FlaskConical className="size-6" aria-hidden="true" />
            Packaging Experiments
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A/B test titles and thumbnails with stats discipline: min 100 impressions per arm, 24h
            minimum, p &lt; 0.05. Winners are never auto-applied.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 size-4" aria-hidden="true" /> New experiment
        </Button>
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)} className="mt-6">
        <TabsList>
          {STATUS_FILTERS.map((s) => (
            <TabsTrigger key={s} value={s} className="capitalize">
              {s}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="mt-4 grid gap-4">
        {experiments.isLoading &&
          [0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        {experiments.isError && (
          <Card>
            <CardContent className="py-8 text-sm text-destructive">
              Failed to load experiments: {(experiments.error as Error).message}
            </CardContent>
          </Card>
        )}
        {experiments.data?.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No experiments yet. Create one to start A/B testing titles and thumbnails.
            </CardContent>
          </Card>
        )}
        {experiments.data?.map((e) => (
          <Link
            key={e.id}
            to="/experiments/$experimentId"
            params={{ experimentId: e.id }}
            className="block"
          >
            <Card className="transition-colors hover:border-accent">
              <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
                <CardTitle className="text-base">{e.name}</CardTitle>
                {statusBadge(e.status)}
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {e.hypothesis && <p className="line-clamp-2">{e.hypothesis}</p>}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span>
                    Metric: <span className="font-medium text-foreground">{e.primary_metric}</span>
                  </span>
                  <span>
                    Min sample/arm:{" "}
                    <span className="font-medium text-foreground">{e.min_sample_size}</span>
                  </span>
                  <span>
                    Min duration:{" "}
                    <span className="font-medium text-foreground">{e.min_duration_hours}h</span>
                  </span>
                  {e.status === "completed" && e.conclusion && (
                    <span>
                      Verdict:{" "}
                      <span className="font-medium text-foreground">
                        {(e.conclusion as { verdict?: string }).verdict ?? "—"}
                      </span>
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <CreateExperimentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={() => {
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["experiments"] });
        }}
      />
    </div>
  );
}

function CreateExperimentDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const createFn = useServerFn(createExperiment);
  const [name, setName] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [primaryMetric, setPrimaryMetric] = useState<string>("ctr");
  const [projectId, setProjectId] = useState("");
  const [arms, setArms] = useState<ArmDraft[]>([
    emptyArm("control", "Control"),
    emptyArm("variant", "Variant B"),
  ]);

  const splitSum = arms.reduce((s, a) => s + (parseFloat(a.traffic_split) || 0), 0);

  const mutation = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          name: name.trim(),
          hypothesis: hypothesis.trim(),
          project_id: projectId.trim() || null,
          primary_metric: primaryMetric as (typeof PRIMARY_METRICS)[number],
          arms: arms.map((a) => ({
            name: a.name.trim() || "Arm",
            arm_type: a.arm_type,
            title_variant_id: a.title_variant_id.trim() || null,
            thumbnail_id: a.thumbnail_id.trim() || null,
            traffic_split: parseFloat(a.traffic_split) || 0,
          })),
        },
      }),
    onSuccess: () => {
      toast.success("Experiment created as draft.");
      onCreated();
      setName("");
      setHypothesis("");
      setProjectId("");
      setArms([emptyArm("control", "Control"), emptyArm("variant", "Variant B")]);
    },
    onError: (err) => toast.error(`Create failed: ${(err as Error).message}`),
  });

  const setArm = (i: number, patch: Partial<ArmDraft>) =>
    setArms((prev) => prev.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New packaging experiment</DialogTitle>
          <DialogDescription>
            Arms link to existing Title Lab / Thumbnail Studio variants by ID — variants are not
            duplicated. Exactly one control arm; traffic splits must sum to 1.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="exp-name">Name</Label>
            <Input
              id="exp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Curiosity-gap title vs direct title"
              maxLength={120}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="exp-hyp">Hypothesis</Label>
            <Textarea
              id="exp-hyp"
              value={hypothesis}
              onChange={(e) => setHypothesis(e.target.value)}
              placeholder="What do you expect to win, and why?"
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Primary metric</Label>
              <Select value={primaryMetric} onValueChange={setPrimaryMetric}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIMARY_METRICS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="exp-proj">Project ID (optional)</Label>
              <Input
                id="exp-proj"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                placeholder="uuid of the project"
              />
            </div>
          </div>

          <div className="grid gap-3">
            <div className="flex items-center justify-between">
              <Label>Arms</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setArms((p) => [
                      ...p,
                      emptyArm("variant", `Variant ${String.fromCharCode(65 + p.length)}`),
                    ])
                  }
                >
                  <Plus className="mr-1 size-3" aria-hidden="true" /> Arm
                </Button>
              </div>
            </div>
            {arms.map((a, i) => (
              <Card key={i} className="p-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label>Arm name</Label>
                    <Input value={a.name} onChange={(e) => setArm(i, { name: e.target.value })} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Type</Label>
                    <Select
                      value={a.arm_type}
                      onValueChange={(v) => setArm(i, { arm_type: v as "control" | "variant" })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="control">control</SelectItem>
                        <SelectItem value="variant">variant</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Title variant ID</Label>
                    <Input
                      value={a.title_variant_id}
                      onChange={(e) => setArm(i, { title_variant_id: e.target.value })}
                      placeholder="from Title Lab"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Thumbnail ID</Label>
                    <Input
                      value={a.thumbnail_id}
                      onChange={(e) => setArm(i, { thumbnail_id: e.target.value })}
                      placeholder="from Thumbnail Studio"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Traffic split (0–1)</Label>
                    <Input
                      value={a.traffic_split}
                      onChange={(e) => setArm(i, { traffic_split: e.target.value })}
                      placeholder="0.5"
                      inputMode="decimal"
                    />
                  </div>
                  <div className="flex items-end">
                    {arms.length > 2 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setArms((p) => p.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="mr-1 size-3" aria-hidden="true" /> Remove
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
            <p
              className={`text-xs ${Math.abs(splitSum - 1) > 0.001 ? "text-destructive" : "text-muted-foreground"}`}
            >
              Traffic split total: {splitSum.toFixed(3)} (must equal 1.000)
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !name.trim()}>
            {mutation.isPending ? "Creating…" : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
