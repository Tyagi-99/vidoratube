import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Check, Download, Film, Loader2, RotateCcw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { PRESETS } from "@/lib/studio-config";
import {
  completeRender,
  failRender,
  listRenders,
  startRender,
  updateRenderProgress,
} from "@/lib/renders.functions";
import type {
  RenderProgress,
  RenderResult,
  RenderScene,
  RenderStageId,
} from "@/lib/render/browser-render";

const STAGES: { id: RenderStageId; label: string }[] = [
  { id: "init", label: "Starting renderer" },
  { id: "assets", label: "Loading scene assets" },
  { id: "segments", label: "Rendering scenes with motion + captions" },
  { id: "combine", label: "Combining scenes" },
  { id: "music", label: "Mixing music with voice ducking" },
  { id: "finalize", label: "Finalising MP4" },
  { id: "validate", label: "Validating playback" },
];

const STAGE_ORDER: RenderStageId[] = [
  "init",
  "assets",
  "normalize",
  "segments",
  "combine",
  "narration",
  "music",
  "captions",
  "finalize",
  "validate",
];

type Project = {
  id: string;
  title: string;
  preset: string;
  aspect_ratio: string;
  settings: unknown;
};

type SceneRow = {
  id: string;
  scene_number: number;
  narration: string;
  visual_type: string;
  asset_url: string | null;
  duration: number;
  motion_type?: string | null;
  transition?: string | null;
};

export function RenderPanel({
  project,
  scenes,
  voiceovers,
  captions,
}: {
  project: Project;
  scenes: SceneRow[];
  voiceovers: { scene_id: string | null; audio_url: string | null }[];
  captions: { scene_id: string | null; cues: unknown }[];
}) {
  const { user } = useSession();
  const queryClient = useQueryClient();

  const startFn = useServerFn(startRender);
  const progressFn = useServerFn(updateRenderProgress);
  const completeFn = useServerFn(completeRender);
  const failFn = useServerFn(failRender);
  const listFn = useServerFn(listRenders);

  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState<RenderProgress | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [burnCaptions, setBurnCaptions] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const lastPushRef = useRef(0);

  const renders = useQuery({
    queryKey: ["renders", project.id],
    queryFn: () => listFn({ data: { projectId: project.id } }),
  });

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const readyScenes = scenes.filter((s) => s.asset_url);
  const missing = scenes.length - readyScenes.length;

  const buildTimeline = useCallback((): RenderScene[] => {
    return readyScenes.map((scene) => {
      const cues = (captions.find((c) => c.scene_id === scene.id)?.cues ?? []) as {
        start: number;
        end: number;
        text: string;
      }[];
      return {
        id: scene.id,
        number: scene.scene_number,
        narration: scene.narration,
        visualType: scene.visual_type,
        assetUrl: scene.asset_url,
        duration: Number(scene.duration) || 6,
        audioUrl: voiceovers.find((v) => v.scene_id === scene.id)?.audio_url ?? null,
        cues: Array.isArray(cues) ? cues : [],
      };
    });
  }, [readyScenes, captions, voiceovers]);

  const run = async () => {
    if (!user) return;
    if (readyScenes.length === 0) {
      toast.error("Generate the scene visuals before rendering.");
      return;
    }

    setError(null);
    setResult(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setRendering(true);
    setProgress({ stage: "init", label: "Starting the renderer", progress: 0 });

    const controller = new AbortController();
    abortRef.current = controller;

    const preset = PRESETS[project.preset as keyof typeof PRESETS] ?? PRESETS.documentary;
    const settings = (project.settings ?? {}) as { music_url?: string | null };

    let renderId: string | null = null;
    const { renderProject, resolutionFor, RenderCancelled, releaseFfmpeg } = await import(
      "@/lib/render/browser-render"
    );
    const { width, height } = resolutionFor(project.aspect_ratio);

    try {
      const row = await startFn({
        data: {
          projectId: project.id,
          type: "full",
          aspect_ratio: project.aspect_ratio,
          resolution: `${width}x${height}`,
        },
      });
      renderId = row.id;

      const output = await renderProject(buildTimeline(), {
        title: project.title,
        aspect: project.aspect_ratio,
        motion: preset.motion,
        transition: preset.transition,
        captionStyle: preset.captionStyle,
        burnCaptions,
        musicUrl: settings.music_url ?? null,
        musicVolume: preset.musicVolume,
        signal: controller.signal,
        onProgress: (p) => {
          setProgress(p);
          const now = Date.now();
          if (renderId && now - lastPushRef.current > 3000) {
            lastPushRef.current = now;
            void progressFn({ data: { id: renderId, stage: p.stage, progress: p.progress } }).catch(
              () => undefined,
            );
          }
        },
      });

      setResult(output);
      setPreviewUrl(URL.createObjectURL(output.blob));

      setProgress({ stage: "finalize", label: "Saving to your library", progress: 99 });
      const path = `${user.id}/renders/${renderId}.mp4`;
      const upload = await supabase.storage
        .from("generated-videos")
        .upload(path, output.blob, { contentType: "video/mp4", upsert: true });
      if (upload.error) throw new Error(`Saving to your library failed: ${upload.error.message}`);

      await completeFn({
        data: {
          id: renderId!,
          path,
          file_size: output.blob.size,
          duration: Math.round(output.duration),
          resolution: `${output.width}x${output.height}`,
        },
      });

      setProgress({ stage: "validate", label: "Done", progress: 100 });
      toast.success("Your MP4 is ready");
      void renders.refetch();
      queryClient.invalidateQueries({ queryKey: ["project", project.id] });
    } catch (err) {
      const cancelled = err instanceof RenderCancelled || controller.signal.aborted;
      const message = cancelled ? "Render cancelled" : (err as Error).message;
      if (!cancelled) setError(message);
      if (renderId) {
        void failFn({ data: { id: renderId, error: message, cancelled } }).catch(() => undefined);
      }
      if (cancelled) {
        await releaseFfmpeg();
        toast.message("Render cancelled");
      } else {
        toast.error(message);
      }
      void renders.refetch();
    } finally {
      abortRef.current = null;
      setRendering(false);
    }
  };

  const activeIndex = progress ? STAGE_ORDER.indexOf(progress.stage) : -1;
  const completed = renders.data?.filter((r) => r.status === "completed" && r.file_url) ?? [];

  return (
    <section className="surface-card mt-10 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground">
            <Film className="h-5 w-5 text-primary" />
            Render MP4
          </h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Stitches every scene, motion, voiceover and caption into a finished MP4 right here in your
            browser — no render service, no extra cost. Keep this tab open while it works.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch id="burn" checked={burnCaptions} onCheckedChange={setBurnCaptions} disabled={rendering} />
            <Label htmlFor="burn" className="text-sm text-muted-foreground">
              Burn captions
            </Label>
          </div>
          {rendering ? (
            <Button variant="outline" className="gap-2" onClick={() => abortRef.current?.abort()}>
              <X className="h-4 w-4" />
              Cancel
            </Button>
          ) : (
            <Button className="gap-2" onClick={run} disabled={readyScenes.length === 0}>
              <Film className="h-4 w-4" />
              {result || completed.length > 0 ? "Render again" : "Render MP4"}
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        <Badge variant="secondary">{readyScenes.length} scenes ready</Badge>
        <Badge variant="secondary">{project.aspect_ratio}</Badge>
        {missing > 0 && (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" />
            {missing} scene{missing > 1 ? "s" : ""} missing a visual
          </Badge>
        )}
      </div>

      {(rendering || progress) && (
        <div className="mt-6">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-foreground">{progress?.label}</span>
            <span className="text-muted-foreground">{progress?.progress ?? 0}%</span>
          </div>
          <Progress value={progress?.progress ?? 0} className="mt-3" />
          {progress?.detail && <p className="mt-2 text-xs text-muted-foreground">{progress.detail}</p>}

          <ul className="mt-4 space-y-2">
            {STAGES.map((stage) => {
              const index = STAGE_ORDER.indexOf(stage.id);
              const done = activeIndex > index || progress?.progress === 100;
              const active = activeIndex === index;
              return (
                <li
                  key={stage.id}
                  className={cn(
                    "flex items-center gap-3 text-sm",
                    done ? "text-foreground" : active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 items-center justify-center rounded-full border",
                      done
                        ? "border-primary bg-primary text-primary-foreground"
                        : active
                          ? "border-primary"
                          : "border-border",
                    )}
                  >
                    {done ? (
                      <Check className="h-3 w-3" />
                    ) : active ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : null}
                  </span>
                  {stage.label}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-xl border border-destructive/40 bg-destructive/10 p-4">
          <p className="text-sm font-medium text-destructive">{error}</p>
          <Button variant="outline" size="sm" className="mt-3 gap-2" onClick={run}>
            <RotateCcw className="h-4 w-4" />
            Retry render
          </Button>
        </div>
      )}

      {(previewUrl || completed.length > 0) && (
        <div className="mt-6 space-y-4">
          <video
            src={previewUrl ?? completed[0]?.file_url ?? undefined}
            controls
            className="aspect-video w-full rounded-2xl border border-border bg-black"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild className="gap-2">
              <a
                href={previewUrl ?? completed[0]?.file_url ?? "#"}
                download={`${project.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.mp4`}
              >
                <Download className="h-4 w-4" />
                Download MP4
              </a>
            </Button>
            {result && (
              <span className="text-sm text-muted-foreground">
                {(result.blob.size / 1024 / 1024).toFixed(1)} MB · {Math.round(result.duration)}s ·{" "}
                {result.width}×{result.height}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
