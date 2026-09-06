import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, Loader2, Wand2 } from "lucide-react";
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
import { CapCutExportButton } from "@/components/vidora/CapCutExportButton";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import {
  completeVoiceoverRender,
  generateVoiceoverCaptions,
  generateVoiceoverScript,
  synthesizeVoiceoverAudio,
  updateVoiceoverDraft,
} from "@/lib/mode2/mode2.functions";
import { readMode2Settings } from "@/lib/mode2/settings";
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

export function VoiceoverEditorPanel({
  project,
  captions,
}: {
  project: ProjectRow;
  captions: { cues: unknown }[];
}) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const settings = readMode2Settings(project.settings);

  const updateFn = useServerFn(updateVoiceoverDraft);
  const scriptFn = useServerFn(generateVoiceoverScript);
  const voiceFn = useServerFn(synthesizeVoiceoverAudio);
  const capsFn = useServerFn(generateVoiceoverCaptions);
  const completeFn = useServerFn(completeVoiceoverRender);

  const [script, setScript] = useState(project.script || project.narration || "");
  const [trimStart, setTrimStart] = useState(String(settings.trim_start ?? 0));
  const [trimEnd, setTrimEnd] = useState(
    settings.trim_end == null ? "" : String(settings.trim_end),
  );
  const [muteOriginal, setMuteOriginal] = useState(settings.mute_original !== false);
  const [rights, setRights] = useState(String(settings.rights_status || "unknown"));
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<RenderProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cues: RenderCue[] = useMemo(() => {
    const raw = captions[0]?.cues;
    return Array.isArray(raw) ? (raw as RenderCue[]) : [];
  }, [captions]);

  const gate = canRenderFinal(rights as PermissionStatus);
  const downloadUrl = selectDownloadUrl(project);
  const sourceUrl = settings.source_video_url || null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["project", project.id] });

  const saveDraft = async () => {
    setBusy("save");
    try {
      await updateFn({
        data: {
          id: project.id,
          script,
          rights_status: rights as never,
          trim_start: Number(trimStart) || 0,
          trim_end: trimEnd.trim() === "" ? null : Number(trimEnd),
          mute_original: muteOriginal,
        },
      });
      toast.success("Draft saved");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  };

  const runScript = async () => {
    setBusy("script");
    try {
      await updateFn({
        data: {
          id: project.id,
          rights_status: rights as never,
          mute_original: muteOriginal,
        },
      });
      const res = await scriptFn({ data: { id: project.id } });
      setScript(res.project.script || "");
      toast.success("Commentary draft ready", {
        description: res.uncertainty,
      });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Script generation failed");
    } finally {
      setBusy(null);
    }
  };

  const runVoice = async () => {
    setBusy("voice");
    try {
      await updateFn({ data: { id: project.id, script } });
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
      await capsFn({ data: { id: project.id } });
      toast.success("Captions generated");
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
      toast.error("Upload source footage before rendering. URL metadata alone cannot be fetched.");
      return;
    }
    if (!project.audio_url) {
      toast.error("Generate the voiceover before rendering.");
      return;
    }

    setBusy("render");
    setProgress({ stage: "init", label: "Starting", progress: 0 });
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await updateFn({
        data: {
          id: project.id,
          script,
          rights_status: rights as never,
          trim_start: Number(trimStart) || 0,
          trim_end: trimEnd.trim() === "" ? null : Number(trimEnd),
          mute_original: muteOriginal,
        },
      });

      const { composeVoiceoverVideo } = await import("@/lib/render/voiceover-compose");
      const output = await composeVoiceoverVideo({
        title: project.title,
        sourceVideoUrl: sourceUrl,
        voiceoverUrl: project.audio_url,
        cues,
        trimStart: Number(trimStart) || 0,
        trimEnd: trimEnd.trim() === "" ? null : Number(trimEnd),
        muteOriginal,
        burnCaptions: settings.burn_captions !== false,
        captionStyle: String(settings.commentary_style || "documentary"),
        aspect: project.aspect_ratio,
        signal: controller.signal,
        onProgress: setProgress,
      });

      const path = `${user.id}/${project.id}/final-voiceover.mp4`;
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
        <Badge variant="secondary">Voiceover Mode</Badge>
        <Badge variant="outline">{project.step}</Badge>
        {!gate.ok && <Badge variant="destructive">Render gated</Badge>}
      </div>

      {settings.analysis_uncertainty && (
        <p className="rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          Analysis note: {settings.analysis_uncertainty}
        </p>
      )}

      {sourceUrl ? (
        <video src={sourceUrl} controls className="aspect-video w-full rounded-2xl bg-black" />
      ) : (
        <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          No uploaded footage. Metadata URL only — final compose is unavailable until you upload a
          file.
          {settings.source_url_metadata ? ` Ref: ${settings.source_url_metadata}` : ""}
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
        <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
          <Label htmlFor="mute-orig">Mute original audio</Label>
          <Switch id="mute-orig" checked={muteOriginal} onCheckedChange={setMuteOriginal} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="trim-start">Trim start (seconds)</Label>
          <Input
            id="trim-start"
            type="number"
            min={0}
            step={0.1}
            value={trimStart}
            onChange={(e) => setTrimStart(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="trim-end">Trim end (seconds, blank = full)</Label>
          <Input
            id="trim-end"
            type="number"
            min={0}
            step={0.1}
            value={trimEnd}
            onChange={(e) => setTrimEnd(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor="vo-script">Commentary script</Label>
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            disabled={!!busy}
            onClick={runScript}
          >
            {busy === "script" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4" />
            )}
            Generate with AI
          </Button>
        </div>
        <Textarea
          id="vo-script"
          rows={10}
          value={script}
          onChange={(e) => setScript(e.target.value)}
          placeholder="Editable commentary…"
        />
      </div>

      {project.audio_url && (
        <div className="rounded-xl border border-border p-4">
          <p className="mb-2 text-sm font-medium">Voiceover preview</p>
          <audio src={project.audio_url} controls className="w-full" />
        </div>
      )}

      {progress && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>{progress.label}</span>
            <span>{Math.round(progress.progress)}%</span>
          </div>
          <Progress value={progress.progress} />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!!busy} onClick={saveDraft}>
          {busy === "save" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save draft
        </Button>
        <Button variant="outline" disabled={!!busy || !script.trim()} onClick={runVoice}>
          {busy === "voice" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Generate VO
        </Button>
        <Button variant="outline" disabled={!!busy || !script.trim()} onClick={runCaptions}>
          {busy === "captions" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Generate captions
        </Button>
        <Button disabled={!!busy || !gate.ok} onClick={runRender}>
          {busy === "render" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Render final MP4
        </Button>
        {busy === "render" && (
          <Button
            variant="ghost"
            onClick={() => abortRef.current?.abort()}
          >
            Cancel
          </Button>
        )}
        {downloadUrl && (
          <>
            <Button asChild variant="secondary" className="gap-2">
              <a href={downloadUrl} download target="_blank" rel="noreferrer">
                <Download className="h-4 w-4" />
                Download
              </a>
            </Button>
            <CapCutExportButton
              job={{
                id: project.id,
                title: project.title,
                narration: project.narration,
                script: project.script,
                voice: null,
                format: null,
                duration_seconds: settings.target_duration_seconds ?? null,
                audio_url: project.audio_url,
                result_url: project.result_url,
                assets: null,
                scenes: null,
              }}
            />
          </>
        )}
      </div>

      {cues.length > 0 && (
        <div className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
          <p className="mb-2 font-medium text-foreground">{cues.length} caption cues</p>
          <ul className="max-h-40 space-y-1 overflow-y-auto">
            {cues.slice(0, 20).map((c, i) => (
              <li key={i}>
                {c.start.toFixed(1)}–{c.end.toFixed(1)}s: {c.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
