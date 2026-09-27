import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Plus, Sparkles, FlaskConical, Mic2, Type, Package } from "lucide-react";
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
import { createIdea, listIdeasForHub, scoreIdeaFn } from "@/lib/creation/ideas/ideas.functions";
import { createCampaignFromIdea } from "@/lib/creation/campaigns/campaigns.functions";
import { CAMPAIGN_FORMATS } from "@/lib/creation/campaigns/campaigns";
import { listResearchProjects, useIdea } from "@/lib/research.functions";
import type { IdeaScore } from "@/lib/creation/contracts";

export const Route = createFileRoute("/_authenticated/create/")({
  component: IdeationHub,
});

type IdeaRow = {
  id: string;
  title: string;
  hook: string;
  angle: string;
  format: string;
  difficulty: string;
  safety_flag: string;
  status: string;
  project_ref: string | null;
  score: { computed_at?: string; score?: IdeaScore } | null;
  research_topic: string | null;
};

function cachedScore(row: IdeaRow): IdeaScore | null {
  const s = row.score?.score;
  return s && typeof s.total === "number" ? (s as IdeaScore) : null;
}

function ScoreBadge({ score }: { score: IdeaScore | null }) {
  if (!score) return <Badge variant="outline">Unscored</Badge>;
  const tone =
    score.confidence === "high"
      ? "default"
      : score.confidence === "medium"
        ? "secondary"
        : "outline";
  return (
    <Badge variant={tone} title={score.verdict}>
      {score.total}/100 · {score.confidence} confidence
    </Badge>
  );
}

function ScoreFactors({ score }: { score: IdeaScore }) {
  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      {score.factors.map((f) => (
        <div key={f.key} className="text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-foreground">
              {f.label}{" "}
              <span className="text-muted-foreground">({Math.round(f.weight * 100)}%)</span>
            </span>
            <span className="tabular-nums text-muted-foreground">{Math.round(f.value * 100)}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-accent" style={{ width: `${f.value * 100}%` }} />
          </div>
          <p className="mt-1 text-muted-foreground">{f.evidence}</p>
        </div>
      ))}
      <p className="text-xs italic text-muted-foreground">{score.verdict}</p>
    </div>
  );
}

function IdeationHub() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const listFn = useServerFn(listIdeasForHub);
  const createFn = useServerFn(createIdea);
  const scoreFn = useServerFn(scoreIdeaFn);
  const ideaToProjectFn = useServerFn(useIdea);
  const listProjectsFn = useServerFn(listResearchProjects);
  const campaignFn = useServerFn(createCampaignFromIdea);

  const [newOpen, setNewOpen] = useState(false);
  const [campaignFor, setCampaignFor] = useState<IdeaRow | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState({
    researchProjectId: "",
    title: "",
    hook: "",
    angle: "",
    format: "long",
    difficulty: "medium",
  });
  const [formats, setFormats] = useState<string[]>(["longform", "shorts", "titles"]);

  const ideas = useQuery({
    queryKey: ["ideas-hub"],
    queryFn: () => listFn({ data: { limit: 100 } }),
  });
  const researchProjects = useQuery({
    queryKey: ["research-projects"],
    queryFn: () => listProjectsFn({}),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["ideas-hub"] });

  const doCreate = useMutation({
    mutationFn: () => createFn({ data: form }),
    onSuccess: () => {
      toast.success("Idea created");
      setNewOpen(false);
      setForm({
        researchProjectId: "",
        title: "",
        hook: "",
        angle: "",
        format: "long",
        difficulty: "medium",
      });
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to create idea"),
  });

  const doScore = useMutation({
    mutationFn: (ideaId: string) => scoreFn({ data: { ideaId } }),
    onSuccess: (res) => {
      invalidate();
      toast.success(`Scored ${res.score.total}/100 (${res.score.confidence} confidence)`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Scoring failed"),
  });

  const doUse = useMutation({
    mutationFn: (ideaId: string) => ideaToProjectFn({ data: { id: ideaId, mode: "stock" } }),
    onSuccess: (res) => {
      toast.success("Project created from idea");
      invalidate();
      navigate({ to: "/projects/$projectId", params: { projectId: res.projectId } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to create project"),
  });

  const doCampaign = useMutation({
    mutationFn: () =>
      campaignFn({
        data: {
          ideaId: campaignFor!.id,
          formats: formats as ("longform" | "shorts" | "thumbnail_set" | "titles" | "metadata")[],
        },
      }),
    onSuccess: () => {
      toast.success("Campaign created");
      setCampaignFor(null);
      navigate({ to: "/create/campaigns" });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to create campaign"),
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Ideation</h1>
          <p className="text-sm text-muted-foreground">
            Evidence-backed idea scoring, brand voice, titles, and campaigns.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link to="/create/brand-voices">
              <Mic2 className="mr-2 size-4" /> Brand voices
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/create/titles">
              <Type className="mr-2 size-4" /> Title Lab
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/create/campaigns">
              <Package className="mr-2 size-4" /> Campaigns
            </Link>
          </Button>
          <Dialog open={newOpen} onOpenChange={setNewOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 size-4" /> New idea
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New video idea</DialogTitle>
                <DialogDescription>
                  Ideas live on a research project so scoring can use its outlier data.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="idea-project">Research project</Label>
                  <Select
                    value={form.researchProjectId}
                    onValueChange={(v) => setForm({ ...form, researchProjectId: v })}
                  >
                    <SelectTrigger id="idea-project">
                      <SelectValue placeholder="Select a research project" />
                    </SelectTrigger>
                    <SelectContent>
                      {(researchProjects.data ?? []).map(
                        (p: { id: string; topic: string | null }) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.topic ?? p.id.slice(0, 8)}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="idea-title">Title</Label>
                  <Input
                    id="idea-title"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="The untold history of night trains"
                  />
                </div>
                <div>
                  <Label htmlFor="idea-hook">Hook (first 3 seconds)</Label>
                  <Textarea
                    id="idea-hook"
                    value={form.hook}
                    onChange={(e) => setForm({ ...form, hook: e.target.value })}
                    placeholder="Nobody talks about the secret mistake that killed night trains…"
                  />
                </div>
                <div>
                  <Label htmlFor="idea-angle">Angle</Label>
                  <Input
                    id="idea-angle"
                    value={form.angle}
                    onChange={(e) => setForm({ ...form, angle: e.target.value })}
                    placeholder="nostalgia + mystery"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="idea-format">Format</Label>
                    <Select
                      value={form.format}
                      onValueChange={(v) => setForm({ ...form, format: v })}
                    >
                      <SelectTrigger id="idea-format">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="long">Long-form</SelectItem>
                        <SelectItem value="short">Short</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="idea-difficulty">Difficulty</Label>
                    <Select
                      value={form.difficulty}
                      onValueChange={(v) => setForm({ ...form, difficulty: v })}
                    >
                      <SelectTrigger id="idea-difficulty">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="easy">Easy</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="hard">Hard</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button
                  className="w-full"
                  disabled={doCreate.isPending || !form.researchProjectId || !form.title.trim()}
                  onClick={() => doCreate.mutate()}
                >
                  {doCreate.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Create idea
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {ideas.isPending && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      )}
      {ideas.isError && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-destructive">
            Failed to load ideas:{" "}
            {ideas.error instanceof Error ? ideas.error.message : "unknown error"}
          </CardContent>
        </Card>
      )}
      {ideas.data && ideas.data.ideas.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Sparkles className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="font-medium">No ideas yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create your first idea, or generate some from a research project&apos;s outlier
              patterns.
            </p>
          </CardContent>
        </Card>
      )}
      <div className="space-y-3">
        {(ideas.data?.ideas ?? []).map((row: IdeaRow) => {
          const score = cachedScore(row);
          const isOpen = expanded === row.id;
          return (
            <Card key={row.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{row.title}</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {row.research_topic ?? "Research project"} · {row.format} · {row.difficulty} ·
                      status: {row.status}
                    </p>
                  </div>
                  <ScoreBadge score={score} />
                </div>
              </CardHeader>
              <CardContent>
                {row.hook && <p className="text-sm text-muted-foreground">“{row.hook}”</p>}
                {isOpen && score && <ScoreFactors score={score} />}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={doScore.isPending}
                    onClick={() => {
                      setExpanded(row.id);
                      doScore.mutate(row.id);
                    }}
                  >
                    {doScore.isPending ? (
                      <Loader2 className="mr-2 size-3 animate-spin" />
                    ) : (
                      <FlaskConical className="mr-2 size-3" />
                    )}
                    {score ? "Re-score" : "Score"}
                  </Button>
                  {score && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setExpanded(isOpen ? null : row.id)}
                    >
                      {isOpen ? "Hide factors" : "Show factors"}
                    </Button>
                  )}
                  {!row.project_ref ? (
                    <Button
                      size="sm"
                      disabled={doUse.isPending}
                      onClick={() => doUse.mutate(row.id)}
                    >
                      Create project
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" asChild>
                      <Link to="/projects/$projectId" params={{ projectId: row.project_ref }}>
                        Open project
                      </Link>
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setCampaignFor(row)}>
                    New campaign
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={campaignFor !== null} onOpenChange={(o) => !o && setCampaignFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Idea → campaign</DialogTitle>
            <DialogDescription>
              Fan “{campaignFor?.title}” out into a multi-format campaign package.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {CAMPAIGN_FORMATS.map((f) => (
              <label key={f} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={formats.includes(f)}
                  onChange={(e) =>
                    setFormats(e.target.checked ? [...formats, f] : formats.filter((x) => x !== f))
                  }
                  className="size-4 accent-current"
                />
                {f.replace("_", " ")}
              </label>
            ))}
          </div>
          <Button
            disabled={doCampaign.isPending || formats.length === 0}
            onClick={() => doCampaign.mutate()}
          >
            {doCampaign.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Create campaign
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
