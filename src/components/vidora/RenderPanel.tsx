import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Check, Download, Film, Loader2, RotateCcw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { useRenderGuard } from "@/lib/render/useRenderGuard";
import { track } from "@/lib/analytics";
import { captureError } from "@/lib/sentry";
import { PRESETS } from "@/lib/studio-config";
import { resolveEffectiveEngine } from "@/lib/engine-select";
import { formatRenderCost, quoteMultiAspectRender } from "@/lib/billing/per-minute";
import {
  completeRender,
  failRender,
  listRenders,
  startRender,
  updateRenderProgress,
} from "@/lib/renders.functions";
import { enqueueServerRender, getServerWorkerStatus, ALL_ASPECTS } from "@/lib/server-renders.functions";
import type { AspectRatio } from "@/lib/server-renders.functions";
import { ServerRenderQueue } from "./ServerRenderQueue";
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
  const [confirmPartial, setConfirmPartial] = useState(false);
  const [engine, setEngine] = useState<"browser" | "server">("browser");
  const [serverEnqueuing, setServerEnqueuing] = useState(false);
  /** Story Mode treatment (five-beat template). On by default. */
  const [storyMode, setStoryMode] = useState(true);
  /** 2.5D parallax treatment on stills. Off by default; +0.25 credits/min on server. */
  const [parallax25d, setParallax25d] = useState(false);
  // Multi-aspect selection: one project outputs up to three formats
  // (16:9, 9:16, 1:1) — one server render row each. Default: all three.
  const [aspects, setAspects] = useState<AspectRatio[]>([...ALL_ASPECTS]);
  const abortRef = useRef<AbortController | null>(null);
  const lastPushRef = useRef(0);

  // Keep the tab alive and warn before closing while a render is running.
  useRenderGuard(rendering);

  const renders = useQuery({
    queryKey: ["renders", project.id],
    queryFn: () => listFn({ data: { projectId: project.id } }),
  });

  // Feature-detection: the server engine is offered only while a worker is
  // actually alive. Until the worker is deployed, this stays false and the
  // browser FFmpeg.wasm path is used automatically.
  const workerStatusFn = useServerFn(getServerWorkerStatus);
  const { data: workerStatus } = useQuery({
    queryKey: ["server-worker-status"],
    queryFn: () => workerStatusFn(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const workerAvailable = workerStatus?.available === true;
  // Pure, unit-tested fallback rule: "server" with an offline worker runs
  // on the browser engine instead.
  const effectiveEngine = resolveEffectiveEngine(engine, workerAvailable);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const readyScenes = scenes.filter((s) => s.asset_url);
  const missing = scenes.length - readyScenes.length;

  // Exact cost quote for the server engine: the same quoteMultiAspectRender
  // the server uses to reserve credits — the number shown here is the
  // number charged. Parallax flows into the quote; Story Mode bills at the
  // standard 1.0 rate.
  const durationSeconds = readyScenes.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
  const quote = quoteMultiAspectRender({
    durationSeconds,
    mode: "story",
    aspectCount: aspects.length,
    parallax25d,
  });

  const toggleAspect = (aspect: AspectRatio) => {
    setAspects((prev) =>
      prev.includes(aspect) ? prev.filter((a) => a !== aspect) : [...prev, aspect],
    );
  };

  // The explicit partial-render confirmation only applies while scenes are
  // actually missing.
  useEffect(() => {
    if (missing === 0) setConfirmPartial(false);
  }, [missing]);

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
    // Bound inside try: a chunk/CDN failure while loading the renderer must
    // land in the catch below (resetting state) instead of leaving the UI
    // stuck in "rendering" forever on an unhandled rejection.
    let RenderCancelled: (new () => Error) | null = null;
    let releaseFfmpeg: (() => Promise<void>) | null = null;

    try {
      const mod = await import("@/lib/render/browser-render");
      const { renderProject, resolutionFor } = mod;
      RenderCancelled = mod.RenderCancelled;
      releaseFfmpeg = mod.releaseFfmpeg;
      const { width, height } = resolutionFor(project.aspect_ratio);
      const row = await startFn({
        data: {
          projectId: project.id,
          type: "full",
          aspect_ratio: project.aspect_ratio,
          resolution: `${width}x${height}`,
        },
      });
      renderId = row.id;
      track("render_started", { job_id: renderId, mode: "project" });

      const output = await renderProject(buildTimeline(), {
        title: project.title,
        aspect: project.aspect_ratio,
        runKey: `project:${project.id}`,
        motion: preset.motion,
        transition: preset.transition,
        captionStyle: preset.captionStyle,
        burnCaptions,
        musicUrl: settings.music_url ?? null,
        musicVolume: preset.musicVolume,
        ...(storyMode ? { creationMode: "story" } : {}),
        parallax25d,
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

      // Cancel also stops the upload and the finalize call — they must not
      // run to completion after the user aborted the render.
      const throwIfCancelled = () => {
        if (!controller.signal.aborted) return;
        if (RenderCancelled) throw new RenderCancelled();
        throw new Error("Render cancelled");
      };

      setProgress({ stage: "finalize", label: "Saving to your library", progress: 99 });
      throwIfCancelled();
      const path = `${user.id}/renders/${renderId}.mp4`;
      const upload = await supabase.storage
        .from("generated-videos")
        .upload(path, output.blob, { contentType: "video/mp4", upsert: true });
      if (upload.error) throw new Error(`Saving to your library failed: ${upload.error.message}`);

      throwIfCancelled();
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
      track("render_succeeded", { job_id: renderId!, mode: "project" });
      void renders.refetch();
      queryClient.invalidateQueries({ queryKey: ["project", project.id] });
    } catch (err) {
      const cancelled =
        (RenderCancelled != null && err instanceof RenderCancelled) || controller.signal.aborted;
      const message = cancelled ? "Render cancelled" : (err as Error).message;
      if (!cancelled) setError(message);
      if (renderId) {
        void failFn({ data: { id: renderId, error: message, cancelled } }).catch(() => undefined);
        if (!cancelled) {
          track("render_failed", { job_id: renderId, mode: "project" });
          captureError(err, { job_id: renderId });
        }
      }
      if (cancelled) {
        toast.message("Render cancelled");
      } else {
        toast.error(message);
      }
      void renders.refetch();
    } finally {
      abortRef.current = null;
      setRendering(false);
      // Always free the ffmpeg worker when the render settles — the cancel
      // path is no longer the only way out.
      if (releaseFfmpeg) {
        try {
          await releaseFfmpeg();
        } catch {
          /* best effort */
        }
      }
    }
  };

  const enqueueFn = useServerFn(enqueueServerRender);

  /** Enqueue a server-side render (native FFmpeg worker). */
  const runServer = async () => {
    if (!user) return;
    if (readyScenes.length === 0) {
      toast.error("Generate the scene visuals before rendering.");
      return;
    }
    if (aspects.length === 0) {
      toast.error("Select at least one output format.");
      return;
    }
    setError(null);
    setServerEnqueuing(true);
    try {
      const timeline = buildTimeline();
      const settings = (project.settings ?? {}) as { music_url?: string | null };
      const voiceover = voiceovers.find((v) => v.scene_id === null)?.audio_url ?? null;
      const queued = await enqueueFn({
        data: {
          projectId: project.id,
          title: project.title ?? "Untitled video",
          scenes: timeline.map((s) => ({
            id: s.id,
            number: s.number,
            narration: s.narration,
            image: s.assetUrl,
            audio: s.audioUrl,
            duration: s.duration,
            cues: s.cues.map((c) => ({ word: c.text, start: c.start, end: c.end })),
          })),
          aspects,
          burnCaptions,
          musicUrl: settings.music_url ?? null,
          voiceoverUrl: voiceover,
          storyMode,
          parallax25d,
        },
      });
      const count = queued.rows?.length ?? aspects.length;
      track("server_render_queued", {
        project_id: project.id,
        aspects: count,
        credits: quote.grandTotal,
      });
      toast.success(
        `Server render queued (${count} format${count === 1 ? "" : "s"}, ${quote.grandTotal} credits) — you can close this tab.`,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not queue the server render.";
      setError(message);
      toast.error(message);
      captureError(e, { extra: { projectId: project.id } });
    } finally {
      setServerEnqueuing(false);
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
            {engine === "server"
              ? "High-quality server render with native FFmpeg — multi-aspect, word-level captions, and resumable. You can close this tab; progress updates live."
              : "Stitches every scene, motion, voiceover and caption into a finished MP4 right here in your browser — no render service, no extra cost. Keep this tab open while it works."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2" role="group" aria-label="Render engine">
            <Button
              size="sm"
              variant={engine === "browser" ? "default" : "outline"}
              onClick={() => setEngine("browser")}
              disabled={rendering || serverEnqueuing}
            >
              Fast (browser)
            </Button>
            <Button
              size="sm"
              variant={engine === "server" ? "default" : "outline"}
              onClick={() => setEngine("server")}
              disabled={rendering || serverEnqueuing}
              title={
                workerAvailable
                  ? "High-quality server render — works with the tab closed"
                  : "Server renderer is offline — selecting this falls back to the browser engine"
              }
            >
              High quality (server){!workerAvailable && " · offline"}
            </Button>
          </div>
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
          ) : effectiveEngine === "server" ? (
            <Button
              className="gap-2"
              onClick={runServer}
              disabled={
                readyScenes.length === 0 ||
                serverEnqueuing ||
                aspects.length === 0 ||
                (missing > 0 && !confirmPartial)
              }
              title={
                aspects.length === 0
                  ? "Select at least one output format"
                  : missing > 0 && !confirmPartial
                    ? "Some scenes are missing visuals — confirm a partial draft below to render anyway"
                    : `Queue a server render (${aspects.length} format${aspects.length === 1 ? "" : "s"}, ${quote.grandTotal} credits)`
              }
            >
              {serverEnqueuing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Film className="h-4 w-4" />
              )}
              {serverEnqueuing ? "Queueing…" : "Queue server render"}
            </Button>
          ) : (
            <Button
              className="gap-2"
              onClick={run}
              disabled={readyScenes.length === 0 || (missing > 0 && !confirmPartial)}
              title={
                missing > 0 && !confirmPartial
                  ? "Some scenes are missing visuals — confirm a partial draft below to render anyway"
                  : undefined
              }
            >
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

      <div className="mt-4 rounded-xl border border-border bg-muted/30 p-4">
        <p className="text-sm font-semibold text-foreground">Render treatment</p>
        <div className="mt-3 space-y-3">
          <div className="flex items-start gap-3">
            <Switch
              id="story-mode"
              checked={storyMode}
              onCheckedChange={setStoryMode}
              disabled={rendering || serverEnqueuing}
            />
            <div>
              <Label htmlFor="story-mode" className="text-sm font-medium text-foreground">
                Story Mode
              </Label>
              <p className="text-xs text-muted-foreground">
                Hook → setup → rising tension → payoff → loop. Pacing, caption
                emphasis and music ducking follow the five beats. Same price as
                a standard render.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Switch
              id="parallax"
              checked={parallax25d}
              onCheckedChange={setParallax25d}
              disabled={rendering || serverEnqueuing}
            />
            <div>
              <Label htmlFor="parallax" className="text-sm font-medium text-foreground">
                2.5D parallax
              </Label>
              <p className="text-xs text-muted-foreground">
                Subtle depth motion on stills. Server renders cost an extra
                0.25 credits per minute; the browser preview is free.
              </p>
            </div>
          </div>
        </div>
      </div>

      {effectiveEngine === "server" && (
        <div className="mt-4 rounded-xl border border-border bg-muted/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Output formats</p>
              <p className="text-xs text-muted-foreground">
                One server render per format — one project outputs up to three formats.
              </p>
            </div>
            <div className="flex items-center gap-4" role="group" aria-label="Output formats">
              {ALL_ASPECTS.map((a) => (
                <label
                  key={a}
                  className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
                >
                  <Checkbox
                    checked={aspects.includes(a)}
                    onCheckedChange={() => toggleAspect(a)}
                    aria-label={`${a} format`}
                    disabled={rendering || serverEnqueuing}
                  />
                  {a}
                </label>
              ))}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <p className="text-sm text-muted-foreground">
              {aspects.length === 0
                ? "Select at least one format to see the cost."
                : `${formatRenderCost({ durationSeconds, mode: "story", parallax25d })} × ${aspects.length} format${aspects.length === 1 ? "" : "s"}`}
            </p>
            <p className="text-sm font-bold text-foreground">
              Exact cost: {quote.grandTotal} credit{quote.grandTotal === 1 ? "" : "s"}
            </p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            This exact amount is reserved from your credits when you queue — no surprises later.
            You can close the tab; the render continues on the server and progress updates live
            here when you come back.
          </p>
        </div>
      )}

      {missing > 0 && !rendering && (
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <Switch
            checked={confirmPartial}
            onCheckedChange={setConfirmPartial}
            aria-label="Render a partial draft from ready scenes only"
          />
          Render a partial draft from the {readyScenes.length} ready scene
          {readyScenes.length === 1 ? "" : "s"} only
        </label>
      )}

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
                target="_blank"
                rel="noreferrer"
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

      {effectiveEngine === "server" && (
        <div className="mt-6">
          <ServerRenderQueue projectId={project.id} />
        </div>
      )}
      {engine === "server" && !workerAvailable && (
        <p className="mt-4 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          The high-quality server renderer isn't online right now, so this render
          will use the fast browser engine instead — same MP4, no extra cost.
        </p>
      )}
    </section>
  );
}
