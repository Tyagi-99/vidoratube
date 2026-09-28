import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FlaskConical, Loader2, Trophy, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listProjects } from "@/lib/studio.functions";
import {
  createTitleExperiment,
  generateAndSaveTitleVariants,
  listTitleVariants,
  setTitleVariantStatus,
  TITLE_STATUS_TRANSITIONS,
  type TitleVariantRow,
  type TitleVariantStatus,
} from "@/lib/creation/titles/titles.functions";
import type { TitleScore } from "@/lib/creation/contracts";
import type { Json } from "@/integrations/supabase/types";
import { getTitleFormat, listTitleFormats } from "@/lib/creation/titles/formats";
import { getTitleWordVectors } from "@/lib/creation/titles/vectors.functions";

export const Route = createFileRoute("/_authenticated/create/titles")({
  component: TitleLab,
});

const FACTOR_LABELS: Record<string, string> = {
  length: "Length",
  keyword: "Keyword",
  curiosity: "Curiosity",
  clarity: "Clarity",
};

function parseScore(raw: Json): TitleScore | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const s = raw as Partial<TitleScore>;
  if (!s.factors || typeof s.total !== "number") return null;
  return s as TitleScore;
}

function VariantCard({
  variant,
  selected,
  onToggleSelect,
  onStatus,
  busy,
}: {
  variant: TitleVariantRow;
  selected: boolean;
  onToggleSelect: () => void;
  onStatus: (status: TitleVariantStatus) => void;
  busy: boolean;
}) {
  const score = parseScore(variant.score);
  const next = TITLE_STATUS_TRANSITIONS[variant.status] ?? [];
  return (
    <Card className={selected ? "border-accent" : undefined}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-medium leading-snug">{variant.title}</CardTitle>
          <Badge variant={variant.status === "winner" ? "default" : "outline"}>
            {variant.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {score ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">Packaging score</span>
              <span className="tabular-nums font-semibold">{score.total}/100</span>
            </div>
            {(Object.entries(score.factors) as [string, number][]).map(([key, value]) => (
              <div key={key} className="flex items-center gap-2 text-xs">
                <span className="w-16 text-muted-foreground">{FACTOR_LABELS[key] ?? key}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${(value / 25) * 100}%` }}
                  />
                </div>
                <span className="w-6 text-right tabular-nums text-muted-foreground">{value}</span>
              </div>
            ))}
            {score.weakEvidence.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-4 pt-1 text-xs text-muted-foreground">
                {score.weakEvidence.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            <p className="pt-1 text-[11px] italic text-muted-foreground">
              Packaging heuristics — not a CTR prediction.
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No score recorded.</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {variant.status === "draft" && (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={selected}
                onChange={onToggleSelect}
                className="size-4 accent-current"
              />
              Experiment
            </label>
          )}
          {next.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={s === "winner" ? "default" : "outline"}
              disabled={busy}
              onClick={() => onStatus(s)}
            >
              {s === "winner" ? (
                <Trophy className="mr-1 size-3" />
              ) : s === "draft" ? (
                <Undo2 className="mr-1 size-3" />
              ) : null}
              {s === "testing"
                ? "Start testing"
                : s === "winner"
                  ? "Mark winner"
                  : s === "retired"
                    ? "Retire"
                    : "Back to draft"}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TitleLab() {
  const queryClient = useQueryClient();
  const listProjectsFn = useServerFn(listProjects);
  const listFn = useServerFn(listTitleVariants);
  const generateFn = useServerFn(generateAndSaveTitleVariants);
  const statusFn = useServerFn(setTitleVariantStatus);
  const experimentFn = useServerFn(createTitleExperiment);

  const [projectId, setProjectId] = useState("");
  const [topic, setTopic] = useState("");
  const [keywords, setKeywords] = useState("");
  const [formatId, setFormatId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [expOpen, setExpOpen] = useState(false);
  const [expName, setExpName] = useState("");
  const [expHypothesis, setExpHypothesis] = useState("");

  const vectorsFn = useServerFn(getTitleWordVectors);
  const vectors = useQuery({
    queryKey: ["title-word-vectors"],
    queryFn: () => vectorsFn({ data: {} }),
  });
  const activeFormat = formatId ? getTitleFormat(formatId) : null;

  const projects = useQuery({ queryKey: ["projects"], queryFn: () => listProjectsFn({}) });
  const variants = useQuery({
    queryKey: ["title-variants", projectId],
    queryFn: () => listFn({ data: { projectId } }),
    enabled: projectId !== "",
  });
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["title-variants", projectId] });
    setSelected([]);
  };

  const generate = useMutation({
    mutationFn: () =>
      generateFn({
        data: {
          projectId,
          topic,
          keywords: keywords
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean),
          formatId: formatId || undefined,
        },
      }),
    onSuccess: (res) => {
      toast.success(`${res.variants.length} variants generated`);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Generation failed"),
  });

  const setStatus = useMutation({
    mutationFn: ({ variantId, status }: { variantId: string; status: TitleVariantStatus }) =>
      statusFn({ data: { variantId, status } }),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Status update failed"),
  });

  const startExperiment = useMutation({
    mutationFn: () =>
      experimentFn({
        data: { projectId, name: expName, hypothesis: expHypothesis, variantIds: selected },
      }),
    onSuccess: () => {
      toast.success("Experiment created — variants are now testing. Phase 4 runs the experiment.");
      setExpOpen(false);
      setExpName("");
      setExpHypothesis("");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Experiment creation failed"),
  });

  const toggleSelect = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold">Title Lab</h1>
        <p className="text-sm text-muted-foreground">
          Deterministic title variants scored on packaging heuristics. Scores are never CTR
          predictions — winners graduate to Phase-4 experiments.
        </p>
      </div>

      <Card className="mb-6">
        <CardContent className="grid gap-3 pt-6 sm:grid-cols-2">
          <div>
            <Label htmlFor="tl-project">Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="tl-project">
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {(projects.data ?? []).map((p: { id: string; title: string | null }) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title ?? p.id.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="tl-keywords">Keywords (comma-separated, optional)</Label>
            <Input
              id="tl-keywords"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="night trains, europe"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="tl-topic">Topic / working title</Label>
            <Input
              id="tl-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="night trains"
            />
          </div>
          {/* P6 Stream E (P2): pinned title format library */}
          <div className="sm:col-span-2">
            <Label htmlFor="tl-format">Title format (optional)</Label>
            <Select
              value={formatId}
              onValueChange={(v) => setFormatId(v === "none" ? "" : v)}
            >
              <SelectTrigger id="tl-format">
                <SelectValue placeholder="Generic templates…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Generic templates…</SelectItem>
                {listTitleFormats().map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name} — {f.lever}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {activeFormat && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                <Badge variant="secondary" className="mr-1.5">
                  {activeFormat.lever}
                </Badge>
                <code className="rounded bg-muted px-1 py-0.5">{activeFormat.template}</code>
                {" — "}
                {activeFormat.note}
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <Button
              disabled={!projectId || !topic.trim() || generate.isPending}
              onClick={() => generate.mutate()}
            >
              {generate.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Generate variants
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* P6 Stream E (P3): viral word vectors from the user's own outlier corpus */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Word vectors</CardTitle>
        </CardHeader>
        <CardContent>
          {vectors.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : vectors.isError ? (
            <p className="text-sm text-destructive">
              Failed to load word vectors:{" "}
              {vectors.error instanceof Error ? vectors.error.message : "unknown error"}
            </p>
          ) : vectors.data?.status === "insufficient_data" ? (
            <p className="text-sm text-muted-foreground">{vectors.data.reason}</p>
          ) : vectors.data?.status === "ok" ? (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Words scored across {vectors.data.videoCount} of your tracked outlier videos —
                packaging heuristics, not CTR predictions. Words need ≥3 videos to be scored.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {vectors.data.vectors.slice(0, 15).map((v) => (
                  <Badge
                    key={v.word}
                    variant="secondary"
                    title={`${v.videos} videos · median ${v.medianOutlier}× outlier`}
                  >
                    {v.word} · {v.lift.toFixed(2)}×
                  </Badge>
                ))}
                {vectors.data.vectors.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No words meet the 3-video floor yet — track more outliers.
                  </p>
                )}
              </div>
              {vectors.data.pairings.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                    Strong pairings in your outliers
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {vectors.data.pairings.slice(0, 8).map((p) => (
                      <Badge
                        key={`${p.wordA}|${p.wordB}`}
                        variant="outline"
                        title={`${p.videos} videos together · median ${p.medianOutlier}× outlier`}
                      >
                        {p.wordA} + {p.wordB}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {!projectId && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Select a project to view its title variants.
          </CardContent>
        </Card>
      )}
      {variants.isPending && projectId && (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      )}
      {variants.isError && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-destructive">
            Failed to load variants:{" "}
            {variants.error instanceof Error ? variants.error.message : "unknown error"}
          </CardContent>
        </Card>
      )}
      {variants.data && variants.data.variants.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-medium">No variants yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Generate a batch from a topic above — scoring is automatic.
            </p>
          </CardContent>
        </Card>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {(variants.data?.variants ?? []).map((v: TitleVariantRow) => (
          <VariantCard
            key={v.id}
            variant={v}
            selected={selected.includes(v.id)}
            onToggleSelect={() => toggleSelect(v.id)}
            onStatus={(status) => setStatus.mutate({ variantId: v.id, status })}
            busy={setStatus.isPending}
          />
        ))}
      </div>

      {selected.length >= 2 && (
        <div className="sticky bottom-4 mt-6 flex justify-center">
          <Dialog open={expOpen} onOpenChange={setExpOpen}>
            <DialogTrigger asChild>
              <Button size="lg" className="shadow-lg">
                <FlaskConical className="mr-2 size-4" />
                Start experiment with {selected.length} variants
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New title experiment</DialogTitle>
                <DialogDescription>
                  Creates the experiment (status: draft) with one arm per variant and moves the
                  variants to “testing”. Phase 4 runs the experiment and reads the results.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="exp-name">Experiment name</Label>
                  <Input
                    id="exp-name"
                    value={expName}
                    onChange={(e) => setExpName(e.target.value)}
                    placeholder="Night trains title test"
                  />
                </div>
                <div>
                  <Label htmlFor="exp-hypothesis">Hypothesis</Label>
                  <Textarea
                    id="exp-hypothesis"
                    value={expHypothesis}
                    onChange={(e) => setExpHypothesis(e.target.value)}
                    placeholder="Curiosity-gap titles outperform descriptive ones…"
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={startExperiment.isPending || !expName.trim()}
                  onClick={() => startExperiment.mutate()}
                >
                  {startExperiment.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Create experiment
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </div>
  );
}
