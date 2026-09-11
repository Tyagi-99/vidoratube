import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Upload } from "lucide-react";
import { CreateSurface } from "@/components/vidora/CreateSurface";
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
import { createVoiceoverProject } from "@/lib/mode2/mode2.functions";
import { COMMENTARY_STYLES, DURATION_PRESETS } from "@/lib/mode2/duration";
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

export function VoiceoverCreateDialog({
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
  const createFn = useServerFn(createVoiceoverProject);
  const fileRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [rights, setRights] = useState("owned");
  const [preset, setPreset] = useState("60");
  const [customSec, setCustomSec] = useState("90");
  const [style, setStyle] = useState<(typeof COMMENTARY_STYLES)[number]>("documentary");
  const [muteOriginal, setMuteOriginal] = useState(true);
  const [metaUrl, setMetaUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const reset = () => {
    setTitle("");
    setNotes("");
    setRights("owned");
    setPreset("60");
    setCustomSec("90");
    setStyle("documentary");
    setMuteOriginal(true);
    setMetaUrl("");
    setFile(null);
  };

  const onSubmit = async () => {
    if (!user) {
      setFormError("Sign in to create a voiceover project.");
      return;
    }
    if (!file && !metaUrl.trim()) {
      setFormError("Upload a video file or paste a URL for metadata only.");
      return;
    }
    if (rights === "do_not_use" || rights === "permission_denied") {
      setFormError("That rights status is blocked — pick a usable clearance.");
      return;
    }

    setFormError(null);
    setBusy(true);
    try {
      let source_video_url: string | undefined;
      let source_storage_path: string | undefined;
      let source_duration_seconds: number | undefined;
      const projectId = crypto.randomUUID();

      if (file) {
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
        source_video_url = signed.signedUrl;
        source_storage_path = path;

        // Best-effort duration probe
        source_duration_seconds = await new Promise<number | undefined>((resolve) => {
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
      }

      const project = await createFn({
        data: {
          title: title || file?.name || "Voiceover project",
          userNotes: notes || undefined,
          rights_status: rights as never,
          source_video_url,
          source_storage_path,
          source_file_name: file?.name,
          source_duration_seconds,
          source_url_metadata: metaUrl.trim() || undefined,
          duration_preset: preset as never,
          custom_duration_seconds: preset === "custom" ? Number(customSec) : undefined,
          commentary_style: style,
          mute_original: muteOriginal,
        },
      });

      toast.success("Voiceover project created");
      onOpenChange(false);
      reset();
      navigate({ to: "/projects/$projectId", params: { projectId: project.id } });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not create project";
      setFormError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <CreateSurface
      asPage={asPage}
      open={open}
      onOpenChange={(v) => {
        if (!busy) onOpenChange(v);
      }}
      title="Voiceover"
      description="Upload footage you own, declare rights, then add commentary and captions. We never scrape or download videos from other platforms."
      className="max-w-xl"
    >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="vo-file">Upload video (primary)</Label>
            <input
              ref={fileRef}
              id="vo-file"
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button
              type="button"
              variant="outline"
              className="min-h-20 w-full justify-start gap-3 border-dashed px-4"
              onClick={() => fileRef.current?.click()}
            >
              {file ? <CheckCircle2 className="h-5 w-5 text-accent" /> : <Upload className="h-5 w-5" />}
              <span className="min-w-0 text-left">
                <span className="block truncate">{file ? file.name : "Choose video file"}</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  {file ? `${(file.size / 1024 / 1024).toFixed(1)} MB selected` : "MP4, MOV, or another browser-supported video"}
                </span>
              </span>
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="vo-meta-url">URL (metadata only, optional)</Label>
            <Input
              id="vo-meta-url"
              placeholder="https://… — stored as reference, not downloaded"
              value={metaUrl}
              onChange={(e) => setMetaUrl(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="vo-title">Title</Label>
            <Input
              id="vo-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Optional — defaults to file name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="vo-notes">Notes for the writer</Label>
            <Textarea
              id="vo-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What should the commentary cover?"
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label>Rights status (required)</Label>
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
            <p className="text-xs text-muted-foreground">
              Final render requires owned, licensed, permission_granted, or public_domain.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
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
                <Label htmlFor="vo-custom">Custom seconds</Label>
                <Input
                  id="vo-custom"
                  type="number"
                  min={5}
                  max={600}
                  value={customSec}
                  onChange={(e) => setCustomSec(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Commentary style</Label>
              <Select value={style} onValueChange={(v) => setStyle(v as typeof style)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMENTARY_STYLES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
            <div>
              <Label htmlFor="vo-mute">Mute original audio</Label>
              <p className="text-xs text-muted-foreground">Recommended when adding commentary VO</p>
            </div>
            <Switch id="vo-mute" checked={muteOriginal} onCheckedChange={setMuteOriginal} />
          </div>

          {formError && (
            <div className="border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
              {formError}
            </div>
          )}
          <Button className="w-full gap-2" disabled={busy} onClick={onSubmit}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? "Uploading and creating…" : "Create voiceover project"}
          </Button>
        </div>
    </CreateSurface>
  );
}
