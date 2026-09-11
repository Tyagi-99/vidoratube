import { useEffect, useRef, type ChangeEvent, type DragEvent, type RefObject } from "react";
import { Loader2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AUTO_EDIT_CAPTION_STYLES,
  formatEditorClock,
  type AutoEditCaptionStyleId,
  type VoiceoverMode,
} from "@/lib/mode3/studio-ui";
import { computeKeepWindow } from "@/lib/mode3/heuristic";
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

const LANGUAGES = ["Auto", "English", "Hindi", "Spanish", "French", "German", "Portuguese"] as const;

export function AutoEditStudio({
  file,
  previewUrl,
  sourceDuration,
  targetDuration,
  captionStyle,
  voiceoverMode,
  language,
  rights,
  notes,
  busy,
  videoRef,
  currentTime,
  playing,
  onClose,
  onReset,
  onPickFile,
  onTargetDuration,
  onCaptionStyle,
  onVoiceoverMode,
  onLanguage,
  onRights,
  onNotes,
  onTogglePlay,
  onSeek,
  onGenerate,
}: {
  file: File | null;
  previewUrl: string | null;
  sourceDuration: number;
  targetDuration: number;
  captionStyle: AutoEditCaptionStyleId;
  voiceoverMode: VoiceoverMode;
  language: string;
  rights: string;
  notes: string;
  busy: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  currentTime: number;
  playing: boolean;
  onClose: () => void;
  onReset: () => void;
  onPickFile: (file: File) => void;
  onTargetDuration: (seconds: number) => void;
  onCaptionStyle: (id: AutoEditCaptionStyleId) => void;
  onVoiceoverMode: (mode: VoiceoverMode) => void;
  onLanguage: (lang: string) => void;
  onRights: (status: string) => void;
  onNotes: (notes: string) => void;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onGenerate: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const keep = computeKeepWindow(sourceDuration || targetDuration, targetDuration);
  const span = Math.max(0.1, sourceDuration || targetDuration);
  const trimLeft = (keep.trimStart / span) * 100;
  const trimWidth = ((keep.trimEnd - keep.trimStart) / span) * 100;
  const playhead = sourceDuration > 0 ? (currentTime / sourceDuration) * 100 : 0;
  const overlay =
    notes
      .split(/[.!?\n]+/)
      .map((s) => s.trim())
      .find(Boolean) || (file ? "Preview — captions burn on generate" : "");

  const takeFiles = (list: FileList | File[] | null) => {
    if (!list || !list.length) return;
    const next = Array.from(list).find((f) => f.type.startsWith("video/")) ?? list[0];
    if (next) onPickFile(next);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    takeFiles(e.dataTransfer.files);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.code === "Space") {
        e.preventDefault();
        onTogglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onTogglePlay]);

  return (
    <div className="ae-studio fixed inset-0 z-[80] flex flex-col bg-[#101012] text-[#e7e8ec]">
      <header className="flex flex-none flex-wrap items-center justify-between gap-3 border-b border-[#34343a] bg-[#17171a] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-[#d7d9dd]" />
          <p className="text-[15px] font-semibold tracking-tight">Vidora</p>
          <span className="text-[#5f606a]">/</span>
          <p className="text-sm text-[#8b8b94]">Automatic edit</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="border-[#34343a] bg-[#202024] text-[#e7e8ec] hover:bg-[#2a2a30]"
            onClick={onReset}
          >
            New project
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="text-[#8b8b94] hover:text-[#e7e8ec]"
            onClick={onClose}
          >
            Studio
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="flex w-full shrink-0 flex-col gap-5 overflow-y-auto border-b border-[#34343a] bg-[#17171a] p-5 lg:max-w-[360px] lg:border-r lg:border-b-0">
          <div>
            <p className="text-lg font-semibold tracking-tight">Create</p>
            <p className="mt-1 text-sm text-[#8b8b94]">
              Drop a clip, set length and captions, then generate a 1080p MP4.
            </p>
          </div>

          <button
            type="button"
            className={cn(
              "flex min-h-[132px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[#34343a] bg-[#202024] px-4 py-6 text-center transition-colors hover:border-[#8b8b94]",
              file && "border-solid border-[#a0c2b4]/50",
            )}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
          >
            <Upload className="size-5 text-[#8b8b94]" />
            <span className="text-sm font-semibold">
              {file ? file.name : "Drop a video or images"}
            </span>
            <span className="text-xs text-[#5f606a]">MP4, MOV, WebM, or a folder of images</span>
            <input
              ref={inputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                takeFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </button>

          <div className="flex flex-col gap-2">
            <Label htmlFor="ae-duration" className="text-[#8b8b94]">
              Duration
            </Label>
            <div className="relative">
              <Input
                id="ae-duration"
                type="number"
                min={5}
                max={600}
                value={targetDuration}
                onChange={(e) => onTargetDuration(Number(e.target.value) || 60)}
                className="border-[#34343a] bg-[#202024] pr-8 text-[#e7e8ec]"
              />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-[#5f606a]">
                s
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-[#8b8b94]">Caption style</p>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-[#202024] p-1">
              {AUTO_EDIT_CAPTION_STYLES.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => onCaptionStyle(style.id)}
                  className={cn(
                    "rounded-lg px-2 py-2 text-sm font-medium transition-colors",
                    captionStyle === style.id
                      ? "bg-[#f6f7f9] text-[#161618]"
                      : "text-[#8b8b94] hover:text-[#e7e8ec]",
                  )}
                >
                  {style.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-[#8b8b94]">Add voiceover</p>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#202024] p-1">
              {(["generate", "upload"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onVoiceoverMode(voiceoverMode === mode ? "off" : mode)}
                  className={cn(
                    "rounded-lg px-2 py-2 text-sm font-medium capitalize transition-colors",
                    voiceoverMode === mode
                      ? "bg-[#f6f7f9] text-[#161618]"
                      : "text-[#8b8b94] hover:text-[#e7e8ec]",
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-[#8b8b94]">Language</Label>
            <Select value={language} onValueChange={onLanguage}>
              <SelectTrigger className="border-[#34343a] bg-[#202024] text-[#e7e8ec]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((lang) => (
                  <SelectItem key={lang} value={lang}>
                    {lang}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="ae-notes" className="text-[#8b8b94]">
              Caption / VO notes
            </Label>
            <textarea
              id="ae-notes"
              rows={3}
              value={notes}
              onChange={(e) => onNotes(e.target.value)}
              placeholder="Short lines become caption cues…"
              className="min-h-[72px] resize-none rounded-lg border border-[#34343a] bg-[#202024] px-3 py-2 text-sm text-[#e7e8ec] placeholder:text-[#5f606a]"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-[#8b8b94]">Rights</Label>
            <Select value={rights} onValueChange={onRights}>
              <SelectTrigger className="border-[#34343a] bg-[#202024] text-[#e7e8ec]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERMISSION_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {RIGHTS_LABELS[status] ?? status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            type="button"
            disabled={busy}
            onClick={onGenerate}
            className="mt-auto h-11 rounded-xl bg-[#f6f7f9] font-semibold text-[#161618] hover:bg-white"
          >
            {busy ? <Loader2 className="animate-spin" /> : null}
            Generate
          </Button>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col bg-[#101012]">
          <div className="relative flex min-h-0 flex-1 items-center justify-center p-6">
            <div className="relative aspect-video w-full max-w-5xl overflow-hidden rounded-2xl bg-black">
              {previewUrl ? (
                <video
                  ref={videoRef}
                  src={previewUrl}
                  className="size-full object-contain"
                  playsInline
                  onClick={onTogglePlay}
                />
              ) : (
                <div className="flex size-full items-center justify-center text-sm text-[#5f606a]">
                  Drop a clip to preview
                </div>
              )}
              {previewUrl && overlay ? (
                <div
                  className={cn(
                    "pointer-events-none absolute inset-x-8 bottom-10 text-center text-lg font-bold tracking-tight text-white",
                    captionStyle === "box" && "rounded-md bg-black/70 px-3 py-1",
                    captionStyle === "karaoke" && "drop-shadow-[0_2px_0_#000]",
                  )}
                >
                  {captionStyle === "highlight" ? (
                    <span>
                      {overlay.split(" ").slice(0, -2).join(" ")}{" "}
                      <span className="text-[#7dd3c7]">{overlay.split(" ").slice(-2).join(" ")}</span>
                    </span>
                  ) : (
                    overlay
                  )}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-none flex-col gap-3 border-t border-[#34343a] bg-[#17171a] px-5 py-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="flex size-9 items-center justify-center rounded-full bg-[#202024] text-sm"
                onClick={onTogglePlay}
                aria-label={playing ? "Pause" : "Play"}
              >
                {playing ? "❚❚" : "►"}
              </button>
              <p className="font-mono text-sm text-[#8b8b94]">
                <span className="text-[#e7e8ec]">{formatEditorClock(currentTime)}</span>
                <span className="mx-1">/</span>
                {formatEditorClock(sourceDuration || targetDuration)}
              </p>
              {file ? (
                <div className="ml-auto flex gap-2">
                  <span className="rounded-lg border border-[#34343a] px-3 py-1.5 text-xs text-[#8b8b94]">
                    Export after generate
                  </span>
                </div>
              ) : null}
            </div>

            <button
              type="button"
              className="relative h-14 w-full overflow-hidden rounded-lg bg-[#202024]"
              onClick={(e) => {
                if (!sourceDuration) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = (e.clientX - rect.left) / rect.width;
                onSeek(ratio * sourceDuration);
              }}
              aria-label="Timeline"
            >
              <span
                className="absolute inset-y-2 rounded-md bg-[#3a4a6e]"
                style={{ left: `${trimLeft}%`, width: `${trimWidth}%` }}
              />
              {file ? (
                <span className="absolute top-1 left-2 text-[10px] font-medium text-[#e7e8ec]/80">
                  {file.name}
                </span>
              ) : null}
              <span
                className="absolute top-0 bottom-0 w-0.5 bg-[#f6f7f9]"
                style={{ left: `${Math.min(100, Math.max(0, playhead))}%` }}
              />
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
