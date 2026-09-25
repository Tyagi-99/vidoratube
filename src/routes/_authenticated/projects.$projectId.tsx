import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import JSZip from "jszip";
import { advanceProject, deleteScene, getProject, regenerateScene, updateScene } from "@/lib/studio.functions";
import { VISUAL_TYPES } from "@/lib/studio-config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Download, ImageIcon, Loader2, Play, RefreshCw, Trash2, Wand2, User, Mic } from "lucide-react";
import { RenderPanel } from "@/components/vidora/RenderPanel";
import { StudioV2Panel } from "@/components/vidora/StudioV2Panel";
import { VoicePicker } from "@/components/vidora/VoicePicker";
import { ProvenanceDrawer } from "@/components/vidora/ProvenanceDrawer";
import { useI18n } from "@/lib/i18n";
import { VoiceoverEditorPanel } from "@/components/vidora/VoiceoverEditorPanel";
import { AutoEditEditorPanel } from "@/components/vidora/AutoEditEditorPanel";
import { projectCreationMode } from "@/lib/mode2/settings";
import { formatSrtTimecode } from "@/lib/srt";


export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  head: () => ({
    meta: [
      { title: "Project editor — Vidora AI" },
      { name: "description", content: "Review scenes, swap visuals, regenerate voice and export your Vidora AI video package." },
      { property: "og:title", content: "Project editor — Vidora AI" },
      { property: "og:description", content: "Scene-by-scene control over your AI video." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProjectEditor,
});

const STAGES = ["created", "visuals", "voice", "captions", "ready", "done"] as const;
const STAGE_LABEL: Record<string, string> = {
  created: "Writing the script",
  script: "Writing the script",
  visuals: "Finding visuals",
  voice: "Recording voiceover",
  captions: "Syncing captions",
  ready: "Finishing up",
  done: "Ready to export",
  failed: "Failed",
};

function ProjectEditor() {
  const { projectId } = Route.useParams();
  const queryClient = useQueryClient();
  const getFn = useServerFn(getProject);
  const advanceFn = useServerFn(advanceProject);

  const data = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getFn({ data: { id: projectId } }),
  });

  const project = data.data?.project;
  const scenes = data.data?.scenes ?? [];
  const captions = data.data?.captions ?? [];
  const voiceovers = data.data?.voiceovers ?? [];

  const [running, setRunning] = useState(false);
  const busy = useRef(false);

  // Drives the pipeline one step at a time and refreshes the view after each step.
  useEffect(() => {
    if (!running || !project) return;
    if (project.status === "completed" || project.status === "failed") {
      setRunning(false);
      if (project.status === "failed") toast.error(project.error ?? "Generation failed");
      else toast.success("Your video package is ready");
      return;
    }
    if (busy.current) return;

    busy.current = true;
    let cancelled = false;
    advanceFn({ data: { id: projectId } })
      .then(() => {
        if (!cancelled) queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setRunning(false);
          toast.error(error.message);
        }
      })
      .finally(() => {
        busy.current = false;
      });

    return () => {
      cancelled = true;
    };
  }, [running, project, projectId, advanceFn, queryClient]);

  if (data.isLoading || !project) {
    if (data.isError) {
      return (
        <main className="mx-auto max-w-5xl px-4 py-20">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Couldn&apos;t load this project
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {(data.error as Error)?.message ?? "Something went wrong."}
          </p>
          <div className="mt-6 flex gap-3">
            <Button onClick={() => data.refetch()}>Try again</Button>
            <Button asChild variant="outline">
              <Link to="/projects">All projects</Link>
            </Button>
          </div>
        </main>
      );
    }
    return (
      <main className="mx-auto max-w-5xl px-4 py-20">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="mt-6 h-72 w-full rounded-2xl" />
      </main>
    );
  }

  const creationMode = projectCreationMode(project);
  if (creationMode === "voiceover" || creationMode === "auto_edit") {
    return (
      <main className="min-h-screen bg-background px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild variant="ghost" size="sm" className="gap-2">
              <Link to="/projects">
                <ArrowLeft className="h-4 w-4" />
                Projects
              </Link>
            </Button>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{project.title}</h1>
          </div>
          {creationMode === "auto_edit" ? (
            <AutoEditEditorPanel project={project} captions={captions} />
          ) : (
            <VoiceoverEditorPanel project={project} captions={captions} />
          )}
        </div>
      </main>
    );
  }

    const stageIndex = Math.max(0, STAGES.indexOf(project.stage as (typeof STAGES)[number]));
  const readyScenes = scenes.filter((s) => s.asset_url).length;
  const progress =
    project.status === "completed"
      ? 100
      : Math.min(95, Math.round(((stageIndex + (scenes.length ? readyScenes / scenes.length : 0)) / STAGES.length) * 100));

  const [exporting, setExporting] = useState(false);

  const exportPackage = async (): Promise<number> => {
    // -1: already running (button is disabled, this is a belt-and-braces guard)
    if (exporting) return -1;
    setExporting(true);
    try {
      const zip = new JSZip();
      const safe = project.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 60) || "vidora-project";

      zip.file("narration.txt", scenes.map((s, i) => `SCENE ${i + 1}\n${s.narration}`).join("\n\n"));
      zip.file(
        "shot-list.txt",
        scenes
          .map(
            (s, i) =>
              `SCENE ${i + 1} — ${s.visual_type} — ${Number(s.duration).toFixed(1)}s\nMotion: ${s.motion_type} | Transition: ${s.transition}\nVisual: ${s.asset_url ?? "missing"}\n`,
          )
          .join("\n"),
      );

      let offset = 0;
      const srt: string[] = [];
      let index = 1;
      for (const scene of scenes) {
        const cap = captions.find((c) => c.scene_id === scene.id);
        const cues = (cap?.cues ?? []) as { start: number; end: number; text: string }[];
        for (const cue of cues) {
          srt.push(
            `${index++}\n${formatSrtTimecode(offset + cue.start)} --> ${formatSrtTimecode(offset + cue.end)}\n${cue.text}\n`,
          );
        }
        offset += Number(scene.duration);
      }
      zip.file("captions.srt", srt.join("\n"));

      const missing: string[] = [];
      const fetchChecked = async (url: string, what: string) => {
        const res = await fetch(url);
        if (!res.ok) {
          missing.push(`${what} (HTTP ${res.status})`);
          return null;
        }
        return res.blob();
      };

      await Promise.all(
        scenes.map(async (scene, i) => {
          const num = String(i + 1).padStart(2, "0");
          if (scene.asset_url) {
            try {
              const blob = await fetchChecked(scene.asset_url, `visuals/scene-${num}`);
              if (blob) {
                const ext = scene.visual_type === "STOCK_VIDEO" ? "mp4" : "png";
                zip.file(`visuals/scene-${num}.${ext}`, blob);
              }
            } catch {
              missing.push(`visuals/scene-${num} (download failed)`);
            }
          }
          const voice = voiceovers.find((v) => v.scene_id === scene.id);
          if (voice?.audio_url) {
            try {
              const blob = await fetchChecked(voice.audio_url, `audio/scene-${num}.mp3`);
              if (blob) zip.file(`audio/scene-${num}.mp3`, blob);
            } catch {
              missing.push(`audio/scene-${num}.mp3 (download failed)`);
            }
          }
        }),
      );

      if (missing.length > 0) {
        zip.file(
          "MISSING-ASSETS.txt",
          ["The following assets could not be downloaded and are missing from this package:", ""]
            .concat(missing.map((m) => `- ${m}`))
            .join("\n"),
        );
      }
      zip.file(
        "README.txt",
        [
          `${project.title}`,
          "",
          "1. Import every file in /visuals onto the timeline in order.",
          "2. Import /audio clips in the same order on the audio track.",
          "3. Match each visual to its audio clip length (see shot-list.txt).",
          "4. Import captions.srt for synced subtitles.",
          "5. Add the motion + transition listed per scene in shot-list.txt.",
        ].join("\n"),
      );

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safe}-package.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke on a later tick: revoking synchronously can cancel the
      // download in Firefox when the anchor is detached.
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);

      return missing.length;
    } finally {
      setExporting(false);
    }
  };

  return (
    <main className="min-h-screen bg-background px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <Link
          to="/projects"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          All projects
        </Link>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{project.title}</h1>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <Badge variant="secondary" className="capitalize">
                {project.mode} mode
              </Badge>
              <Badge variant="secondary" className="capitalize">
                {project.preset.replace("_", " ")}
              </Badge>
              <Badge variant="secondary">{project.aspect_ratio}</Badge>
              <Badge variant="secondary">{project.language}</Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {project.status !== "completed" && (
              <Button onClick={() => setRunning(true)} disabled={running} className="gap-2">
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                {running ? STAGE_LABEL[project.stage] ?? "Working" : project.status === "failed" ? "Retry" : "Generate"}
              </Button>
            )}
            <Button
              variant="outline"
              className="gap-2"
              onClick={() =>
                toast.promise(exportPackage(), {
                  loading: "Packaging assets…",
                  success: (missingCount: number) =>
                    missingCount > 0
                      ? `Package downloaded — ${missingCount} asset${missingCount === 1 ? "" : "s"} missing (see MISSING-ASSETS.txt)`
                      : missingCount === 0
                        ? "Package downloaded"
                        : "Export already running",
                  error: "Export failed",
                })
              }
              disabled={scenes.length === 0 || exporting}
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Export package
            </Button>
          </div>
        </div>

        {(running || project.status === "running" || project.status === "failed") && (
          <div className="surface-card mt-6 p-5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-foreground">
                {project.status === "failed" ? "Generation stopped" : STAGE_LABEL[project.stage] ?? project.step}
              </span>
              <span className="text-muted-foreground">{progress}%</span>
            </div>
            <Progress value={progress} className="mt-3" />
            {project.error && <p className="mt-3 text-sm text-destructive">{project.error}</p>}
          </div>
        )}

        <h2 className="mt-10 text-xl font-bold tracking-tight text-foreground">
          Scenes {scenes.length > 0 && <span className="text-muted-foreground">({scenes.length})</span>}
        </h2>

        {/* P4: Studio v2 creative controls */}
        <div className="mt-4">
          <StudioV2Panel project={project} />
        </div>

        {scenes.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Hit Generate and Vidora will write the script, break it into scenes and fill each one.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {scenes.map((scene) => (
              <SceneCard
                key={scene.id}
                scene={scene}
                audioUrl={voiceovers.find((v) => v.scene_id === scene.id)?.audio_url ?? null}
                projectId={projectId}
              />
            ))}
          </div>
        )}

        <RenderPanel
          project={project}
          scenes={scenes}
          voiceovers={voiceovers}
          captions={captions}
        />
      </div>

    </main>
  );
}

type Scene = {
  id: string;
  scene_number: number;
  narration: string;
  visual_type: string;
  visual_prompt: string | null;
  search_query: string | null;
  asset_url: string | null;
  asset_thumb_url: string | null;
  duration: number;
  status: string;
  error: string | null;
  style_override: string | null;
  character_id: string | null;
  voice_id: string | null;
};

function SceneCard({
  scene,
  audioUrl,
  projectId,
}: {
  scene: Scene;
  audioUrl: string | null;
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const updateFn = useServerFn(updateScene);
  const regenFn = useServerFn(regenerateScene);
  const deleteFn = useServerFn(deleteScene);

  const [narration, setNarration] = useState(scene.narration);
  const [query, setQuery] = useState(scene.search_query ?? "");
  const [visualType, setVisualType] = useState(scene.visual_type);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [provenanceOpen, setProvenanceOpen] = useState(false);
  const [sceneVoice, setSceneVoice] = useState<string | null>(scene.voice_id);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["project", projectId] });

  // Resync the form when the server row changes (regenerate/refetch);
  // local edits only change state, never the props, so typing is not clobbered.
  useEffect(() => {
    setNarration(scene.narration);
  }, [scene.narration]);
  useEffect(() => {
    setQuery(scene.search_query ?? "");
  }, [scene.search_query]);
  useEffect(() => {
    setVisualType(scene.visual_type);
  }, [scene.visual_type]);

  const save = useMutation({
    mutationFn: () =>
      updateFn({
        data: { id: scene.id, narration, search_query: query, visual_type: visualType as never },
      }),
    onSuccess: () => {
      toast.success(`Scene ${scene.scene_number} saved`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const regenerate = useMutation({
    mutationFn: (what: "visual" | "voice" | "both") => regenFn({ data: { id: scene.id, what } }),
    onSuccess: () => {
      toast.success(`Scene ${scene.scene_number} regenerated`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => deleteFn({ data: { id: scene.id } }),
    onSuccess: () => {
      toast.success("Scene removed");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="surface-card grid gap-4 p-4 md:grid-cols-[220px_1fr]">
      <div className="relative aspect-video overflow-hidden rounded-xl bg-muted">
        {scene.asset_thumb_url ? (
          <img
            src={scene.asset_thumb_url}
            alt={`Scene ${scene.scene_number} visual`}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <ImageIcon className="h-6 w-6" />
          </div>
        )}
        <span className="absolute left-2 top-2 rounded-full bg-background/85 px-2 py-0.5 text-xs font-semibold">
          #{scene.scene_number}
        </span>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">{Number(scene.duration).toFixed(1)}s</Badge>
          <Badge variant="secondary" className="capitalize">
            {scene.status}
          </Badge>
          {/* P4: style / character / voice badges */}
          {scene.style_override && (
            <Badge variant="outline" title="Scene style override">
              {scene.style_override}
            </Badge>
          )}
          {scene.character_id && (
            <Badge variant="outline" title="Character in this scene">
              <User className="mr-1 h-3 w-3" /> character
            </Badge>
          )}
          {scene.voice_id && (
            <Badge variant="outline" title="Per-scene voice override">
              <Mic className="mr-1 h-3 w-3" /> {scene.voice_id}
            </Badge>
          )}
          <button
            type="button"
            className="text-xs text-primary underline"
            onClick={() => setProvenanceOpen(true)}
          >
            {t("provenance")}
          </button>
          {scene.error && <span className="text-destructive">{scene.error}</span>}
        </div>

        <Textarea value={narration} onChange={(e) => setNarration(e.target.value)} rows={3} />

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Visual type</Label>
            <Select value={visualType} onValueChange={setVisualType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VISUAL_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t.replace("_", " ").toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Stock search terms</Label>
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ancient ruins | desert" />
          </div>
        </div>

        {/* P4: per-scene voice override */}
        <div className="space-y-1.5">
          <Label className="text-xs">{t("per_scene_voice")}</Label>
          <VoicePicker
            value={sceneVoice}
            onChange={(id) => {
              setSceneVoice(id);
              updateFn({ data: { id: scene.id, voice_id: id } } as never)
                .then(() => invalidate())
                .catch((e: Error) => toast.error(e.message));
            }}
            allowProjectDefault
          />
        </div>

        {audioUrl && (
          <audio controls src={audioUrl} className="w-full" preload="none">
            <track kind="captions" />
          </audio>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
            Save
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={() => regenerate.mutate("visual")}
            disabled={regenerate.isPending}
          >
            {regenerate.isPending && regenerate.variables === "visual" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Visual
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={() => regenerate.mutate("voice")}
            disabled={regenerate.isPending}
          >
            {regenerate.isPending && regenerate.variables === "voice" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Voice
          </Button>
          <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Delete scene ${scene.scene_number}`}
                disabled={remove.isPending}
              >
                {remove.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete scene {scene.scene_number}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the scene, its visual and its voiceover. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep scene</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => remove.mutate()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete scene
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      <ProvenanceDrawer
        sceneId={scene.id}
        open={provenanceOpen}
        onOpenChange={setProvenanceOpen}
      />
    </div>
  );
}
