import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  createProject,
  deleteProject,
  duplicateProject,
  listCategories,
  listProjects,
} from "@/lib/studio.functions";
import {
  ASPECT_RATIOS,
  DURATIONS,
  IMAGE_STYLES,
  LANGUAGES,
  MODES,
  PRESETS,
} from "@/lib/studio-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Copy, Film, Loader2, Plus, Trash2 } from "lucide-react";
import { ModeChooser } from "@/components/vidora/ModeChooser";
import { VoiceoverCreateDialog } from "@/components/vidora/VoiceoverCreateDialog";
import { AutoEditCreateDialog } from "@/components/vidora/AutoEditCreateDialog";
import { projectCreationMode } from "@/lib/mode2/settings";

export const Route = createFileRoute("/_authenticated/projects/")({
  head: () => ({
    meta: [
      { title: "Projects — Vidora AI" },
      {
        name: "description",
        content: "Plan, generate and manage every faceless video project in your Vidora AI studio.",
      },
      { property: "og:title", content: "Projects — Vidora AI" },
      { property: "og:description", content: "Your Vidora AI video projects." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProjectsPage,
});

const statusStyles: Record<string, string> = {
  completed: "bg-primary/15 text-primary",
  running: "bg-accent text-accent-foreground",
  draft: "bg-muted text-muted-foreground",
  failed: "bg-destructive/15 text-destructive",
};

function ProjectsPage() {
  const [open, setOpen] = useState(false);
  const [modeChooserOpen, setModeChooserOpen] = useState(false);
  const [voiceoverOpen, setVoiceoverOpen] = useState(false);
  const [autoEditOpen, setAutoEditOpen] = useState(false);
  const queryClient = useQueryClient();
  const listFn = useServerFn(listProjects);
  const removeFn = useServerFn(deleteProject);
  const copyFn = useServerFn(duplicateProject);

  const projects = useQuery({ queryKey: ["projects"], queryFn: () => listFn({}) });

  const remove = useMutation({
    mutationFn: (id: string) => removeFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Project deleted");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const duplicate = useMutation({
    mutationFn: (id: string) => copyFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Project duplicated");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <main className="min-h-screen bg-background px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Projects
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Every video starts as a project: script, scenes, visuals, voice and captions.
            </p>
          </div>
          <Button onClick={() => setModeChooserOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            New project
          </Button>
        </div>

        {projects.isLoading ? (
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-48 rounded-2xl" />
            ))}
          </div>
        ) : projects.isError ? (
          <div className="mt-10 border border-destructive/30 bg-destructive/5 p-8" role="alert">
            <p className="font-semibold text-foreground">We couldn't load your projects</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {(projects.error as Error)?.message ?? "Something went wrong."}
            </p>
            <Button variant="outline" className="mt-5" onClick={() => projects.refetch()}>
              Try again
            </Button>
          </div>
        ) : (projects.data ?? []).length === 0 ? (
          <Card className="mt-10 border-dashed border-border bg-card">
            <CardContent className="flex flex-col items-center gap-4 p-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Film className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-foreground">No projects yet</p>
                <p className="text-sm text-muted-foreground">
                  Pick a topic and Vidora writes the script, finds the visuals and records the
                  voice.
                </p>
              </div>
              <Button onClick={() => setModeChooserOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                Create your first project
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(projects.data ?? []).map((project) => (
              <div key={project.id} className="surface-card flex flex-col overflow-hidden">
                <div className="relative aspect-video w-full bg-muted">
                  {project.thumbnail_url && (
                    <img
                      src={project.thumbnail_url}
                      alt={`Thumbnail for ${project.title}`}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  )}
                  <span
                    className={`absolute left-3 top-3 rounded-md px-2.5 py-1 text-xs font-semibold capitalize ${
                      statusStyles[project.status] ?? "bg-muted"
                    }`}
                  >
                    {project.status === "running" ? project.step : project.status}
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-3 p-4">
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId: project.id }}
                    className="line-clamp-2 font-semibold text-foreground hover:text-primary"
                  >
                    {project.title}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary" className="capitalize">
                      {(() => {
                        const cm = projectCreationMode(project);
                        if (cm === "voiceover") return "voiceover";
                        if (cm === "auto_edit") return "auto edit";
                        return `${project.mode} mode`;
                      })()}
                    </Badge>
                    <Badge variant="secondary">{project.duration_minutes} min</Badge>
                    <span>{new Date(project.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="mt-auto flex gap-2">
                    <Button asChild size="sm" variant="outline" className="flex-1">
                      <Link to="/projects/$projectId" params={{ projectId: project.id }}>
                        Open
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => duplicate.mutate(project.id)}
                      aria-label={`Duplicate ${project.title}`}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => remove.mutate(project.id)}
                      aria-label={`Delete ${project.title}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ModeChooser
        open={modeChooserOpen}
        onOpenChange={setModeChooserOpen}
        title="New project"
        description="Pick Script to Video, Voiceover, or Automatic Edit."
        onChoose={(mode) => {
          setModeChooserOpen(false);
          if (mode === "voiceover") setVoiceoverOpen(true);
          else if (mode === "auto_edit") setAutoEditOpen(true);
          else setOpen(true);
        }}
      />
      <NewProjectDialog open={open} onOpenChange={setOpen} />
      <VoiceoverCreateDialog open={voiceoverOpen} onOpenChange={setVoiceoverOpen} />
      <AutoEditCreateDialog open={autoEditOpen} onOpenChange={setAutoEditOpen} />
    </main>
  );
}

function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const createFn = useServerFn(createProject);
  const categoriesFn = useServerFn(listCategories);
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => categoriesFn({}),
    enabled: open,
  });

  const [topic, setTopic] = useState("");
  const [script, setScript] = useState("");
  const [sourceKind, setSourceKind] = useState<"topic" | "draft" | "transcript" | "article" | "url">("topic");
  const [sourceText, setSourceText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [mode, setMode] = useState<"stock" | "image" | "video">("stock");
  const [preset, setPreset] = useState<"sleep" | "documentary" | "war_history">("documentary");
  const [style, setStyle] = useState(IMAGE_STYLES[0]!.id);
  const [language, setLanguage] = useState<string>("English");
  const [duration, setDuration] = useState<number>(5);
  const [aspect, setAspect] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [category, setCategory] = useState<string>("");

  const create = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          topic,
          ...(script.trim() ? { script } : {}),
          source_kind: sourceKind,
          ...(sourceText.trim() ? { source_text: sourceText } : {}),
          ...(sourceUrl.trim() ? { source_url: sourceUrl } : {}),
          mode,
          preset,
          visual_style: style,
          language,
          duration_minutes: duration,
          aspect_ratio: aspect,
          ...(category ? { category } : {}),
        },
      }),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      onOpenChange(false);
      setTopic("");
      setScript("");
      setSourceKind("topic");
      setSourceText("");
      setSourceUrl("");
      toast.success("Project created — open it to start generating.", {
        description: project.title,
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Give Vidora a topic, paste your own script, or start from a transcript, article, or
            reference link.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* P6 Stream E (P5): multi-source ingestion */}
          <div className="space-y-2">
            <Label>Start from</Label>
            <Select value={sourceKind} onValueChange={(v) => setSourceKind(v as typeof sourceKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="topic">Topic</SelectItem>
                <SelectItem value="draft">Draft / script</SelectItem>
                <SelectItem value="transcript">Transcript (pasted)</SelectItem>
                <SelectItem value="article">Article (pasted)</SelectItem>
                <SelectItem value="url">Reference link</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="topic">Topic</Label>
            <Input
              id="topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={
                sourceKind === "topic"
                  ? "The fall of the Roman Republic"
                  : "Short label (auto-filled from source if left empty)"
              }
              maxLength={300}
            />
          </div>

          {sourceKind === "draft" && (
            <div className="space-y-2">
              <Label htmlFor="script">Your script</Label>
              <Textarea
                id="script"
                value={script}
                onChange={(e) => setScript(e.target.value)}
                placeholder="Paste a finished script — Vidora will only handle the visuals and voice."
                rows={4}
              />
            </div>
          )}

          {(sourceKind === "transcript" || sourceKind === "article") && (
            <div className="space-y-2">
              <Label htmlFor="source-text">
                Paste the {sourceKind === "transcript" ? "transcript" : "article text"} (min 50
                characters)
              </Label>
              <Textarea
                id="source-text"
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
                placeholder={
                  sourceKind === "transcript"
                    ? "0:00 welcome back — today we…"
                    : "Paste the article Vidora should plan from…"
                }
                rows={6}
                maxLength={100000}
              />
            </div>
          )}

          {sourceKind === "url" && (
            <div className="space-y-2">
              <Label htmlFor="source-url">Reference link (stored only — Vidora never fetches it)</Label>
              <Input
                id="source-url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://…"
                inputMode="url"
                maxLength={2048}
              />
              <div className="space-y-2">
                <Label htmlFor="source-text-url">Paste the content to work from (optional)</Label>
                <Textarea
                  id="source-text-url"
                  value={sourceText}
                  onChange={(e) => setSourceText(e.target.value)}
                  placeholder="Paste the text Vidora should plan from…"
                  rows={4}
                  maxLength={100000}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                The link is kept as provenance. Vidora does not open or fetch it — paste any
                content you want planned from.
              </p>
            </div>
          )}

          {sourceKind === "topic" && (
            <div className="space-y-2">
              <Label htmlFor="script">Your script (optional)</Label>
              <Textarea
                id="script"
                value={script}
                onChange={(e) => setScript(e.target.value)}
                placeholder="Paste a finished script to skip AI writing."
                rows={4}
              />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Video mode">
              <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODES.map((m) => (
                    <SelectItem key={m.id} value={m.id} disabled={!m.enabled}>
                      {m.label}
                      {!m.enabled ? " (coming soon)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Preset">
              <Select value={preset} onValueChange={(v) => setPreset(v as typeof preset)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRESETS).map(([id, p]) => (
                    <SelectItem key={id} value={id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Visual style">
              <Select value={style} onValueChange={setStyle}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {IMAGE_STYLES.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Category">
              <Select
                value={category || "none"}
                onValueChange={(v) => setCategory(v === "none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="none">No category</SelectItem>
                  {(categories.data ?? []).map((c) => (
                    <SelectItem key={c.slug} value={c.name}>
                      {c.group_name} — {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Language">
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Target length">
              <Select value={String(duration)} onValueChange={(v) => setDuration(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATIONS.map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d} minutes
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Aspect ratio">
              <Select value={aspect} onValueChange={(v) => setAspect(v as typeof aspect)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASPECT_RATIOS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Button
            className="w-full gap-2"
            onClick={() => create.mutate()}
            disabled={create.isPending || (!topic.trim() && !script.trim())}
          >
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create project
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
