import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, RefreshCw, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FinalVideoPreview } from "@/components/vidora/FinalVideoPreview";
import { useRenderGuard } from "@/lib/render/useRenderGuard";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import {
  completeAutoEditRender,
  replanAutoEdit,
} from "@/lib/mode3/mode3.functions";
import { readMode3Settings } from "@/lib/mode3/settings";
import type { AutoEditPlan } from "@/lib/mode3/provider";
import {
  generateVoiceoverCaptions,
  generateVoiceoverScript,
  synthesizeVoiceoverAudio,
} from "@/lib/mode2/mode2.functions";
import { canRenderFinal, PERMISSION_STATUSES, type PermissionStatus } from "@/lib/content/stages";
import { selectDownloadUrl } from "@/lib/jobs/final-video";
import type { RenderCue, RenderProgress } from "@/lib/render/browser-render";

type ProjectRow = {
  id: string;
  title: string;
  script: string | null;
  narration: string | null;
  audio_url: string | null;
  result_url: string | null;
  status: string;
  stage: string;
  step: string;
  settings: unknown;
  aspect_ratio: string;
  duration_minutes: number;
};

export function AutoEditEditorPanel({
  project,
  captions,
}: {
  project: ProjectRow;
  captions: { cues: unknown }[];
}) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const settings = readMode3Settings(project.settings);
  const plan = (settings.auto_edit_plan as AutoEditPlan | undefined) ?? null;

  const replanFn = useServerFn(replanAutoEdit);
  const completeFn = useServerFn(completeAutoEditRender);
  const scriptFn = useServerFn(generateVoiceoverScript);
  const voiceFn = useServerFn(synthesizeVoiceoverAudio);
  const capsFn = useServerFn(generateVoiceoverCaptions);

  const [script, setScript] = useState(project.script || project.narration || "");
  const [targetDur, setTargetDur] = useState(String(settings.target_duration_seconds ?? 60));
  const [burnCaptions, setBurnCaptions] = useState(settings.burn_captions !== false);
  const [enableVo, setEnableVo] = useState(Boolean(settings.enable_voiceover));
  const [muteOriginal, setMuteOriginal] = useState(
    settings.mute_original ?? Boolean(settings.enable_voiceover),
  );
  const [rights, setRights] = useState(String(settings.rights_status || "unknown"));
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<RenderProgress | null>(null);

  // Keep the tab alive and warn before closing while the compose is running.
  useRenderGuard(busy === "render");
  const abortRef = useRef<AbortController | null>(null);

  const cues: RenderCue[] = useMemo(() => {
    const raw = captions[0]?.cues;
    if (Array.isArray(raw) && raw.length) return raw as RenderCue[];
    return (plan?.cues ?? []) as RenderCue[];
  }, [captions, plan]);

  const gate = canRenderFinal(rights as PermissionStatus);
  const downloadUrl = selectDownloadUrl(project);
  const sourceUrl = settings.source_video_url || null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["project", project.id] });

  const runReplan = async () => {
    setBusy("replan");
    try {
      const res = await replanFn({
        data: {
          id: project.id,
          target_duration_seconds: Number(targetDur) || 60,
          burn_captions: burnCaptions,
          enable_voiceover: enableVo,
          mute_original: muteOriginal,
          rights_status: rights as never,
          script,
        },
      });
      toast.success("Plan refreshed", { description: res.plan.summary });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Replan failed");
    } finally {
      setBusy(null);
    }
  };

  const runScript = async () => {
    if (!enableVo) {
      toast.message("Enable voiceover to generate commentary.");
      return;
    }
    setBusy("script");
    try {
      await replanFn({
        data: {
          id: project.id,
          enable_voiceover: true,
          rights_status: rights as never,
          script,
        },
      });
      const res = await scriptFn({ data: { id: project.id } });
      setScript(res.project.script || "");
      toast.success("Commentary draft ready");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Script generation failed");
    } finally {
      setBusy(null);
    }
  };

  const runVoice = async () => {
    if (!enableVo) {
      toast.message("Enable voiceover first.");
      return;
    }
    setBusy("voice");
    try {
      await replanFn({ data: { id: project.id, script, enable_voiceover: true } });
      await voiceFn({ data: { id: project.id } });
      toast.success("ElevenLabs voiceover ready");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Voice synthesis failed");
    } finally {
      setBusy(null);
    }
  };

  const runCaptions = async () => {
    setBusy("captions");
    try {
      if (enableVo && (script || project.script)) {
        await replanFn({ data: { id: project.id, script, burn_captions: true } });
        await capsFn({ data: { id: project.id } });
      } else {
        await replanFn({
          data: {
            id: project.id,
            script,
            burn_captions: true,
            target_duration_seconds: Number(targetDur) || 60,
          },
        });
      }
      toast.success("Captions ready");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Caption generation failed");
    } finally {
      setBusy(null);
    }
  };

  const runRender = async () => {
    if (!user) return;
    if (!gate.ok) {
      toast.error(gate.reason);
      return;
    }
    if (!sourceUrl) {
      toast.error("Source footage missing.");
      return;
    }
    if (enableVo && !project.audio_url) {
      toast.error("Generate the voiceover before rendering, or turn VO off.");
      return;
    }

    setBusy("render");
    setProgress({ stage: "init", label: "Starting MP4 compose in this tab", progress: 0 });
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const replanned = await replanFn({
        data: {
          id: project.id,
          script,
          rights_status: rights as never,
          target_duration_seconds: Number(targetDur) || 60,
          burn_captions: burnCaptions,
          enable_voiceover: enableVo,
          mute_original: muteOriginal,
        },
      });

      const localTrimStart = Number(replanned.plan.trimStart) || 0;
      const localTrimEnd =
        Number(replanned.plan.trimEnd) > localTrimStart
          ? Number(replanned.plan.trimEnd)
          : null;
      const renderCues = burnCaptions
        ? ((replanned.plan.cues?.length ? replanned.plan.cues : cues) as RenderCue[])
        : [];

      const { composeVoiceoverVideo } = await import("@/lib/render/voiceover-compose");
      const output = await composeVoiceoverVideo({
        title: project.title,
        sourceVideoUrl: sourceUrl,
        voiceoverUrl: enableVo ? project.audio_url : null,
        cues: renderCues,
        trimStart: localTrimStart,
        trimEnd: localTrimEnd,
        muteOriginal: enableVo ? true : muteOriginal,
        burnCaptions,
        captionStyle: "classic",
        aspect: project.aspect_ratio,
        signal: controller.signal,
        onProgress: setProgress,
      });

      const path = `${user.id}/${project.id}/final-auto-edit.mp4`;
      const { error: upErr } = await supabase.storage
        .from("generated-videos")
        .upload(path, output.blob, { contentType: "video/mp4", upsert: true });
      if (upErr) throw new Error(upErr.message);

      await completeFn({
        data: {
          id: project.id,
          path,
          file_size: output.blob.size,
          duration: output.duration,
        },
      });
      toast.success("Final MP4 ready");
      refresh();
    } catch (e) {
      if ((e as Error)?.name === "RenderCancelled") toast.message("Render cancelled");
      else toast.error(e instanceof Error ? e.message : "Render failed");
    } finally {
      setBusy(null);
      setProgress(null);
      abortRef.current = null;
    }
  };

  if (project.status === "completed" && downloadUrl) {
    return (
      <div className="space-y-6">
        <FinalVideoPreview
          job={{
            id: project.id,
            title: project.title,
            narration: project.narration,
            script: project.script,
            duration_seconds: settings.target_duration_seconds ?? project.duration_minutes * 60,
            audio_url: project.audio_url,
            result_url: project.result_url,
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">Automatic Edit</Badge>
        <Badge variant="outline">{project.step}</Badge>
        {!gate.ok && <Badge variant="destructive">Render gated</Badge>}
        {plan?.stubs.silenceDetection && (
          <Badge variant="outline">Silence detection: stub</Badge>
        )}
      </div>

      {plan?.summary && (
        <p className="rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          {plan.summary}
          {plan.segments[0]
            ? ` Trim ${plan.segments[0].start.toFixed(1)}s → ${plan.segments[0].end.toFixed(1)}s.`
            : ""}
        </p>
      )}

      {sourceUrl ? (
        <video src={sourceUrl} controls className="aspect-video w-full rounded-2xl bg-black" />
      ) : (
        <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          No source footage on this project.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Rights status</Label>
          <Select value={rights} onValueChange={setRights}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERMISSION_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!gate.ok && <p className="text-xs text-destructive">{gate.reason}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="ae-target">Target duration (seconds)</Label>
          <Input
            id="ae-target"
            type="number"
            min={5}
            max={600}
            value={targetDur}
            onChange={(e) => setTargetDur(e.target.value)}
          />
        </div>
        <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
          <Label htmlFor="ae-burn">Burn captions</Label>
          <Switch id="ae-burn" checked={burnCaptions} onCheckedChange={setBurnCaptions} />
        </div>
        <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
          <Label htmlFor="ae-enable-vo">Optional voiceover</Label>
          <Switch
            id="ae-enable-vo"
            checked={enableVo}
            onCheckedChange={(v) => {
              setEnableVo(v);
              if (v) setMuteOriginal(true);
            }}
          />
        </div>
        <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2 sm:col-span-2">
          <Label htmlFor="ae-mute-ed">Mute original audio</Label>
          <Switch
            id="ae-mute-ed"
            checked={muteOriginal}
            onCheckedChange={setMuteOriginal}
            disabled={enableVo}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="gap-2"
          disabled={!!busy}
          onClick={runReplan}
        >
          {busy === "replan" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh plan
        </Button>
        <Button variant="outline" className="gap-2" disabled={!!busy} onClick={runCaptions}>
          {busy === "captions" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Refresh captions
        </Button>
      </div>

      {enableVo && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="ae-script">Voiceover script</Label>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="gap-2" disabled={!!busy} onClick={runScript}>
                {busy === "script" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4" />
                )}
                Generate script
              </Button>
              <Button size="sm" variant="outline" disabled={!!busy} onClick={runVoice}>
                {busy === "voice" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Synthesize VO
              </Button>
            </div>
          </div>
          <Textarea
            id="ae-script"
            rows={8}
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder="Optional commentary for ElevenLabs…"
          />
          {project.audio_url && (
            <audio src={project.audio_url} controls className="w-full" />
          )}
        </div>
      )}

      {progress && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>{progress.label}</span>
            <span>{Math.round(progress.progress)}%</span>
          </div>
          <Progress value={progress.progress} />
          {progress.detail && (
            <p className="text-xs text-muted-foreground">{progress.detail}</p>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => abortRef.current?.abort()}
          >
            Cancel render
          </Button>
        </div>
      )}

      <Button className="w-full gap-2" disabled={!!busy || !gate.ok} onClick={runRender}>
        {busy === "render" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Render final MP4
      </Button>
    </div>
  );
}
