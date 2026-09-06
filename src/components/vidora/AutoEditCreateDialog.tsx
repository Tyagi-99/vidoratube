import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { createAutoEditProject } from "@/lib/mode3/mode3.functions";
import { DURATION_PRESETS } from "@/lib/mode2/duration";
import { PERMISSION_STATUSES } from "@/lib/content/stages";

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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
  const [busy, setBusy] = useState(false);

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

      const source_duration_seconds = await new Promise<number | undefined>((resolve) => {
        const url = URL.createObjectURL(file);
        const el = document.createElement("video");
        el.preload = "metadata";
        el.onloadedmetadata = () => {
          const d = Number.isFinite(el.duration) ? el.duration : undefined;
          URL.revokeObjectURL(url);
          resolve(d);
        };
        el.onerror = () => {
          URL.revokeObjectURL(url);
          resolve(undefined);
        };
        el.src = url;
      });

      const { project } = await createFn({
        data: {
          title: title || file.name || "Automatic edit",
          userNotes: notes || undefined,
          rights_status: rights as never,
          source_video_url: signed.signedUrl,
          source_storage_path: path,
          source_file_name: file.name,
          source_duration_seconds,
          duration_preset: preset as never,
          custom_duration_seconds: preset === "custom" ? Number(customSec) : undefined,
          aspect_ratio: aspect,
          burn_captions: burnCaptions,
          enable_voiceover: enableVo,
          mute_original: enableVo ? true : muteOriginal,
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

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!busy) onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Automatic Edit</DialogTitle>
          <DialogDescription>
            Upload footage, pick target duration and aspect. Vidora plans a keep-window trim and
            optional captions/VO — no AutoEditor code is embedded (see docs/PHASE3-AUTOEDITOR.md).
          </DialogDescription>
        </DialogHeader>

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
            <div className="space-y-2">
              <Label>Aspect ratio</Label>
              <Select
                value={aspect}
                onValueChange={(v) => setAspect(v as "16:9" | "9:16" | "1:1")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="16:9">16:9</SelectItem>
                  <SelectItem value="9:16">9:16</SelectItem>
                  <SelectItem value="1:1">1:1</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
      </DialogContent>
    </Dialog>
  );
}
