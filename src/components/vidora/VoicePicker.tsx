import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Play, Loader2 } from "lucide-react";
import { previewVoice } from "@/lib/studio-v2.functions";
import { sortedVoices, voiceById, type CatalogVoice } from "@/lib/voices";
import { userSelectableVoices } from "@/lib/languages";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** P4 voice picker — English-first ordering, cached TTS previews. */
export function VoicePicker({
  value,
  onChange,
  allowProjectDefault = false,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  /** When true, shows a "use project voice" option (per-scene override). */
  allowProjectDefault?: boolean;
}) {
  const { t } = useI18n();
  const previewFn = useServerFn(previewVoice);
  const [playing, setPlaying] = useState<string | null>(null);
  // UI offers verified voices only: BETA placeholders (selectable: false)
  // never reach the picker.
  const voices = sortedVoices(userSelectableVoices());

  const preview = useMutation({
    mutationFn: (voiceId: string) =>
      previewFn({ data: { voiceId, text: "Namaste! This is how I sound." } }),
    onSuccess: (res, voiceId) => {
      if (res.url) {
        setPlaying(voiceId);
        const el = new Audio(res.url);
        el.onended = () => setPlaying(null);
        el.onerror = () => {
          setPlaying(null);
          toast.error("Preview failed");
        };
        el.play().catch(() => setPlaying(null));
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Preview failed"),
  });

  return (
    <div className="space-y-2">
      <Select value={value ?? "__project"} onValueChange={(v) => onChange(v === "__project" ? null : v)}>
        <SelectTrigger>
          <SelectValue placeholder={t("voices")} />
        </SelectTrigger>
        <SelectContent>
          {allowProjectDefault && (
            <SelectItem value="__project">{t("use_project_voice")}</SelectItem>
          )}
          {voices.map((v) => (
            <SelectItem key={v.id} value={v.id}>
              {v.name} · {v.language}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value && voiceById(value) && (
        <VoicePreviewRow
          voice={voiceById(value)!}
          playing={playing === value}
          onPreview={() => preview.mutate(value)}
        />
      )}
    </div>
  );
}

function VoicePreviewRow({
  voice,
  playing,
  onPreview,
}: {
  voice: CatalogVoice;
  playing: boolean;
  onPreview: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className={cn("flex items-center gap-2 rounded-lg border p-2")}>
      <div className="flex-1">
        <div className="text-sm font-medium">{voice.name}</div>
        <div className="text-xs text-muted-foreground">{voice.description}</div>
      </div>
      <Button size="sm" variant="outline" onClick={onPreview} disabled={playing || !voice.providerVoiceId}>
        {playing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        <span className="ml-1">{playing ? t("previewing") : t("preview_voice")}</span>
      </Button>
    </div>
  );
}
