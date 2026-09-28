import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import { CreateSurface } from "@/components/vidora/CreateSurface";
import { AspectRatioSelect } from "@/components/vidora/aspect-ratio-select";
import { AutoEditStudio } from "@/components/vidora/AutoEditStudio";
import { Button } from "@/components/ui/button";
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
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { probeVideoDuration } from "@/lib/probe-video";
import { createAutoEditProject } from "@/lib/mode3/mode3.functions";
import { DURATION_PRESETS } from "@/lib/mode2/duration";
import { PERMISSION_STATUSES } from "@/lib/content/stages";
import {
  type AutoEditCaptionStyleId,
  type VoiceoverMode,
  voiceoverFlags,
} from "@/lib/mode3/studio-ui";

const RIGHTS_LABELS: Record<string, string> = {
  unknown: "Unknown (cannot render final)",
  permission_required: "Permission required",
  permission_requested: "Permission requested",
  permission_granted: "Permission granted",
  permission_denied: "Permission denied (blocked)",
  licensed: "Licensed",
  owned: "I own this footage",
  public_domain: "Public domain",
  do_not_use: "Do not use (blocked)",
};

export function AutoEditCreateDialog({
  open,
  onOpenChange,
  asPage = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asPage?: boolean;
}) {
  const { user } = useSession();
  const navigate = useNavigate();
  const createFn = useServerFn(createAutoEditProject);
  const fileRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [rights, setRights] = useState("owned");
  const [preset, setPreset] = useState("60");
  const [customSec, setCustomSec] = useState("90");
  const [aspect, setAspect] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [burnCaptions, setBurnCaptions] = useState(true);
  const [enableVo, setEnableVo] = useState(false);
  const [muteOriginal, setMuteOriginal] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [captionStyle, setCaptionStyle] = useState<AutoEditCaptionStyleId>("karaoke");
  const [voiceoverMode, setVoiceoverMode] = useState<VoiceoverMode>("off");
  const [language, setLanguage] = useState("Auto");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sourceDuration, setSourceDuration] = useState(0);
  const [, setCurrentTime] = useState(0);
  const [, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const pickFile = (next: File) => {
    setFile(next);
    setTitle((t) => t || next.name.replace(/\.[^.]+$/, ""));
  };

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      setSourceDuration(0);
      setCurrentTime(0);
      setPlaying(false);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !previewUrl) return;
    const onMeta = () => setSourceDuration(Number.isFinite(el.duration) ? el.duration : 0);
    const onTime = () => setCurrentTime(el.currentTime);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    return () => {
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, [previewUrl]);

  const reset = () => {
    setTitle("");
    setNotes("");
    setRights("owned");
    setPreset("60");
    setCustomSec("90");
    setAspect("16:9");
    setBurnCaptions(true);
    setEnableVo(false);
    setMuteOriginal(false);
    setFile(null);
    setAudioFile(null);
    setCaptionStyle("karaoke");
    setVoiceoverMode("off");
    setLanguage("Auto");
    setCurrentTime(0);
    setPlaying(false);
  };

  const onSubmit = async () => {
    if (!user) {
      toast.error("Sign in to create an automatic edit.");
      return;
    }
    if (!file) {
      toast.error("Upload a video file to auto-edit.");
      return;
    }
    if (rights === "do_not_use" || rights === "permission_denied") {
      toast.error("That rights status is blocked — pick a usable clearance.");
      return;
    }

    setBusy(true);
    try {
      const projectId = crypto.randomUUID();
      const ext = (file.name.split(".").pop() || "mp4").toLowerCase();
      const path = `${user.id}/uploads/${projectId}/source.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("generated-videos")
        .upload(path, file, { contentType: file.type || "video/mp4", upsert: true });
      if (upErr) throw new Error(upErr.message);
      const { data: signed, error: signErr } = await supabase.storage
        .from("generated-videos")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      if (signErr || !signed) throw new Error(signErr?.message || "Could not sign upload URL");

      const source_duration_seconds = await probeVideoDuration(file);

      const { project } = await createFn({
        data: {
          title: title || file.name || "Automatic edit",
          userNotes: notes || undefined,
          rights_status: rights as never,
          source_video_url: signed.signedUrl,
          source_storage_path: path,
          source_file_name: file.name,
          source_duration_seconds: sourceDuration || source_duration_seconds,
          duration_preset: preset as never,
          custom_duration_seconds:
            preset === "custom" ? Number(customSec) : undefined,
          aspect_ratio: aspect,
          language: language === "Auto" ? "English" : language,
          burn_captions: burnCaptions,
          enable_voiceover: asPage ? voiceoverFlags(voiceoverMode).enable_voiceover : enableVo,
          mute_original: asPage
            ? voiceoverFlags(voiceoverMode).mute_original
            : enableVo
              ? true
              : muteOriginal,
          caption_style: captionStyle,
        },
      });

      toast.success("Automatic edit project created");
      onOpenChange(false);
      reset();
      navigate({ to: "/projects/$projectId", params: { projectId: project.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create project");
    } finally {
      setBusy(false);
    }
  };

  if (asPage) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
        <section aria-label="Edit settings" className="rounded-xl border bg-card p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ae-page-target">Target duration</Label>
              <Select value={preset} onValueChange={setPreset}>
                <SelectTrigger id="ae-page-target">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATION_PRESETS.map((s) => (
                    <SelectItem key={s} value={String(s)}>
                      {s}s
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <AspectRatioSelect value={aspect} onValueChange={(v) => setAspect(v)} />
          </div>
          {preset === "custom" && (
            <div className="mt-4 max-w-xs space-y-2">
              <Label htmlFor="ae-page-custom">Custom seconds</Label>
              <Input
                id="ae-page-custom"
                type="number"
                min={5}
                max={600}
                value={customSec}
                onChange={(e) => setCustomSec(e.target.value)}
              />
            </div>
          )}
        </section>
        <AutoEditStudio
          file={file}
          audioName={audioFile?.name ?? null}
          busy={busy}
          onClose={() => onOpenChange(false)}
          onReset={reset}
          onPickFile={pickFile}
          onPickAudio={(next) => {
            setAudioFile(next);
            setVoiceoverMode("upload");
          }}
          onGenerate={() => void onSubmit()}
        />
      </div>
    );
  }

  return (
    <CreateSurface
      asPage={asPage}
      open={open}
      onOpenChange={(v) => {
        if (!busy) onOpenChange(v);
      }}
      title="Automatic edit"
      description="Upload a raw take, pick a target length and aspect, and Vidora trims a keep window with optional captions and voiceover."
      className="max-w-xl"
    >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ae-file">Upload video</Label>
            <input
              ref={fileRef}
              id="ae-file"
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-4 w-4" />
              {file ? file.name : "Choose video file"}
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ae-title">Title</Label>
            <Input
              id="ae-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Optional title"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ae-notes">Notes (seed captions / optional VO script)</Label>
            <Textarea
              id="ae-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Short lines become caption cues…"
            />
          </div>

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
                      {RIGHTS_LABELS[s] ?? s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <AspectRatioSelect value={aspect} onValueChange={(v) => setAspect(v)} />
            <div className="space-y-2">
              <Label>Target duration</Label>
              <Select value={preset} onValueChange={setPreset}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATION_PRESETS.map((s) => (
                    <SelectItem key={s} value={String(s)}>
                      {s}s
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {preset === "custom" && (
              <div className="space-y-2">
                <Label htmlFor="ae-custom">Custom seconds</Label>
                <Input
                  id="ae-custom"
                  type="number"
                  min={5}
                  max={600}
                  value={customSec}
                  onChange={(e) => setCustomSec(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-xl border border-border p-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="ae-caps">Burn captions</Label>
              <Switch id="ae-caps" checked={burnCaptions} onCheckedChange={setBurnCaptions} />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="ae-vo">Optional voiceover (ElevenLabs)</Label>
              <Switch
                id="ae-vo"
                checked={enableVo}
                onCheckedChange={(v) => {
                  setEnableVo(v);
                  if (v) setMuteOriginal(true);
                }}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="ae-mute">Mute original audio</Label>
              <Switch
                id="ae-mute"
                checked={muteOriginal}
                onCheckedChange={setMuteOriginal}
                disabled={enableVo}
              />
            </div>
          </div>

          <Button className="w-full gap-2" disabled={busy} onClick={onSubmit}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Create automatic edit
          </Button>
        </div>
    </CreateSurface>
  );
}
