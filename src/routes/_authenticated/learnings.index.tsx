/**
 * F35 — Learning Engine: evidence-gated learnings, comment-signal drafts,
 * pattern mining.
 * Route: /learnings
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Brain, Plus, MessagesSquare, Sparkles } from "lucide-react";
import {
  archiveLearning,
  createLearning,
  draftFromCommentSignals,
  listLearnings,
  minePatterns,
  promoteLearning,
  refuteLearning,
} from "@/lib/learnings/learnings.functions";
import { LEARNING_KINDS, LEARNING_STATUSES } from "@/lib/learnings/learnings.server";
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

export const Route = createFileRoute("/_authenticated/learnings/")({
  component: LearningsIndex,
});

function SourceBadge({ source }: { source: string }) {
  if (source === "ai_analysis") {
    return (
      <Badge className="bg-violet-500/15 text-violet-600 dark:text-violet-400" variant="secondary">
        <Sparkles className="mr-1 size-3" aria-hidden="true" /> AI analysis
      </Badge>
    );
  }
  if (source === "system") {
    return <Badge variant="outline">system</Badge>;
  }
  return <Badge variant="outline">human</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    proposed: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    validated: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    refuted: "bg-red-500/15 text-red-600 dark:text-red-400",
    archived: "bg-muted text-muted-foreground",
  };
  return (
    <Badge className={map[status] ?? ""} variant="secondary">
      {status}
    </Badge>
  );
}

function statementOf(l: { payload: Record<string, unknown> }): string {
  const s = l.payload["statement"];
  return typeof s === "string" ? s : "(no statement)";
}

function LearningsIndex() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("proposed");
  const [dialogOpen, setDialogOpen] = useState(false);

  const listFn = useServerFn(listLearnings);
  const promoteFn = useServerFn(promoteLearning);
  const refuteFn = useServerFn(refuteLearning);
  const archiveFn = useServerFn(archiveLearning);
  const draftSignalsFn = useServerFn(draftFromCommentSignals);
  const mineFn = useServerFn(minePatterns);

  const learnings = useQuery({
    queryKey: ["learnings", statusFilter],
    queryFn: () =>
      listFn({
        data: {
          status:
            statusFilter === "all"
              ? undefined
              : (statusFilter as (typeof LEARNING_STATUSES)[number]),
          limit: 100,
        },
      }),
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["learnings"] });

  const promote = useMutation({
    mutationFn: (id: string) => promoteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Learning validated.");
      invalidate();
    },
    onError: (e) => toast.error(`Cannot validate: ${(e as Error).message}`),
  });
  const refute = useMutation({
    mutationFn: (id: string) => refuteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Learning refuted.");
      invalidate();
    },
    onError: (e) => toast.error(`Refute failed: ${(e as Error).message}`),
  });
  const archive = useMutation({
    mutationFn: (id: string) => archiveFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Learning archived.");
      invalidate();
    },
    onError: (e) => toast.error(`Archive failed: ${(e as Error).message}`),
  });
  const draftSignals = useMutation({
    mutationFn: () => draftSignalsFn({ data: {} }),
    onSuccess: (r) => {
      toast.success(
        r.inserted.length > 0
          ? `Drafted ${r.inserted.length} comment-signal learning(s).`
          : "No new recurring comment signals found.",
      );
      invalidate();
    },
    onError: (e) => toast.error(`Draft failed: ${(e as Error).message}`),
  });
  const mine = useMutation({
    mutationFn: () => mineFn({ data: {} }),
    onSuccess: (r) => {
      toast.success(
        r.inserted.length > 0
          ? `Mined ${r.inserted.length} pattern brief(s) — review before trusting.`
          : "No validated learnings to aggregate yet.",
      );
      invalidate();
    },
    onError: (e) => toast.error(`Mining failed: ${(e as Error).message}`),
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Brain className="size-6" aria-hidden="true" />
            Learning Engine
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Evidence-gated learnings: nothing leaves <span className="font-medium">proposed</span>{" "}
            without evidence and confidence. Only validated learnings feed pattern advice.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => draftSignals.mutate()}
            disabled={draftSignals.isPending}
          >
            <MessagesSquare className="mr-2 size-4" aria-hidden="true" />
            {draftSignals.isPending ? "Scanning…" : "Draft from comment signals"}
          </Button>
          <Button variant="outline" onClick={() => mine.mutate()} disabled={mine.isPending}>
            <Sparkles className="mr-2 size-4" aria-hidden="true" />
            {mine.isPending ? "Mining…" : "Mine patterns"}
          </Button>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 size-4" aria-hidden="true" /> New learning
          </Button>
        </div>
      </div>

      <Tabs value={statusFilter} onValueChange={setStatusFilter} className="mt-6">
        <TabsList>
          {["all", ...LEARNING_STATUSES].map((s) => (
            <TabsTrigger key={s} value={s} className="capitalize">
              {s}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="mt-4 grid gap-4">
        {learnings.isLoading &&
          [0, 1].map((i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}
        {learnings.data?.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No learnings with this status yet.
            </CardContent>
          </Card>
        )}
        {learnings.data?.map((l) => {
          const ev = l.evidence as {
            type?: string;
            refs?: string[];
            sample?: number;
            metrics?: Record<string, unknown>;
          };
          return (
            <Card key={l.id}>
              <CardHeader className="flex flex-row flex-wrap items-center gap-2 pb-2">
                <StatusBadge status={l.status} />
                <SourceBadge source={l.source} />
                <Badge variant="outline">{l.kind}</Badge>
                <Badge variant="outline">{l.topic}</Badge>
                {typeof l.confidence === "number" && (
                  <Badge variant="outline">confidence {(l.confidence * 100).toFixed(0)}%</Badge>
                )}
              </CardHeader>
              <CardContent>
                <CardTitle className="text-base font-medium">{statementOf(l)}</CardTitle>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Evidence: {ev.type ?? "none"}</span>
                  {typeof ev.sample === "number" && (
                    <span>Sample: {ev.sample.toLocaleString()}</span>
                  )}
                  {Array.isArray(ev.refs) && <span>Refs: {ev.refs.length}</span>}
                  {l.experiment_id && <span>Experiment: {l.experiment_id.slice(0, 8)}…</span>}
                </div>
                {l.source === "ai_analysis" && Array.isArray(ev.refs) && ev.refs.length > 0 && (
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer text-muted-foreground">
                      Cited learnings ({ev.refs.length})
                    </summary>
                    <ul className="mt-1 list-disc pl-5 font-mono text-muted-foreground">
                      {ev.refs.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {l.status === "proposed" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => promote.mutate(l.id)}
                      disabled={promote.isPending}
                    >
                      Validate
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => refute.mutate(l.id)}
                      disabled={refute.isPending}
                    >
                      Refute
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => archive.mutate(l.id)}
                      disabled={archive.isPending}
                    >
                      Archive
                    </Button>
                  </div>
                )}
                {l.status === "validated" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => refute.mutate(l.id)}
                      disabled={refute.isPending}
                    >
                      Refute
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => archive.mutate(l.id)}
                      disabled={archive.isPending}
                    >
                      Archive
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <CreateLearningDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={() => {
          setDialogOpen(false);
          invalidate();
        }}
      />
    </div>
  );
}

function CreateLearningDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const createFn = useServerFn(createLearning);
  const [kind, setKind] = useState<string>("pattern");
  const [topic, setTopic] = useState("general");
  const [statement, setStatement] = useState("");
  const [confidence, setConfidence] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          kind: kind as (typeof LEARNING_KINDS)[number],
          topic: topic.trim() || "general",
          statement: statement.trim(),
          confidence: confidence.trim() === "" ? null : parseFloat(confidence),
        },
      }),
    onSuccess: () => {
      toast.success("Learning recorded as proposed.");
      onCreated();
      setStatement("");
      setConfidence("");
    },
    onError: (err) => toast.error(`Create failed: ${(err as Error).message}`),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New manual learning</DialogTitle>
          <DialogDescription>
            Manual learnings start as <span className="font-medium">proposed</span>. Attach evidence
            and confidence before validating.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Kind</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEARNING_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="learn-topic">Topic</Label>
              <Input
                id="learn-topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="title, thumbnail, hook…"
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="learn-stmt">Statement</Label>
            <Textarea
              id="learn-stmt"
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              rows={3}
              placeholder="What did you learn, stated plainly?"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="learn-conf">Confidence (0–1, optional)</Label>
            <Input
              id="learn-conf"
              value={confidence}
              onChange={(e) => setConfidence(e.target.value)}
              inputMode="decimal"
              placeholder="0.7"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || statement.trim().length < 10}
          >
            {mutation.isPending ? "Saving…" : "Save as proposed"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
