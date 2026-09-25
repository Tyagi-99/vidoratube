import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CapCutExportButton } from "@/components/vidora/CapCutExportButton";
import { selectDownloadUrl } from "@/lib/jobs/final-video";

export type FinalVideoPreviewJob = {
  id: string;
  title: string;
  narration: string | null;
  script?: string | null;
  voice?: string | null;
  format?: string | null;
  duration_seconds: number | null;
  audio_url: string | null;
  result_url: string | null;
  thumbnail_url?: string | null;
  assets?: unknown;
  scenes?: unknown;
};

function formatDuration(seconds: number | null) {
  if (!seconds) return "—";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Shared ready-state preview: MP4 player + CapCut export + download.
 * Download is gated on result_url only (never audio fallback).
 */
export function FinalVideoPreview({
  job,
  onMakeAnother,
  onDone,
}: {
  job: FinalVideoPreviewJob;
  onMakeAnother?: () => void;
  onDone?: () => void;
}) {
  const downloadUrl = selectDownloadUrl(job);
  if (!downloadUrl) {
    return (
      <div className="rounded-xl border border-border bg-muted/40 p-10 text-center">
        <p className="text-sm font-medium text-foreground">Your video isn't ready yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The final MP4 hasn't been composed — finish the render first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 py-4">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-muted">
        <video
          src={downloadUrl}
          poster={job.thumbnail_url ?? undefined}
          controls
          className="aspect-video w-full bg-black"
        />
      </div>
      {job.audio_url && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="mb-2 text-sm font-medium text-foreground">Voiceover</p>
          <audio src={job.audio_url} controls className="w-full" />
        </div>
      )}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-foreground">{job.title}</p>
            <p className="text-sm text-muted-foreground">{formatDuration(job.duration_seconds)}</p>
          </div>
          <div className="flex items-center gap-2">
            <CapCutExportButton
              job={{
                id: job.id,
                title: job.title,
                narration: job.narration,
                script: job.script ?? null,
                voice: job.voice ?? null,
                format: job.format ?? null,
                duration_seconds: job.duration_seconds,
                audio_url: job.audio_url,
                result_url: job.result_url,
                assets: job.assets,
                scenes: job.scenes,
              }}
              size="default"
              variant="outline"
              className="gap-2"
            />
            <Button asChild className="gap-2">
              <a href={downloadUrl} target="_blank" rel="noreferrer" download>
                <Download className="h-4 w-4" />
                Download
              </a>
            </Button>
          </div>
        </div>
      </div>

      {job.narration && (
        <div className="max-h-40 overflow-y-auto rounded-xl border border-border bg-muted/50 p-4 text-sm leading-relaxed text-muted-foreground">
          {job.narration}
        </div>
      )}

      {(onMakeAnother || onDone) && (
        <div className="flex gap-3">
          {onMakeAnother && (
            <Button onClick={onMakeAnother} variant="outline" className="flex-1">
              Make another
            </Button>
          )}
          {onDone && (
            <Button onClick={onDone} className="flex-1">
              Done
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
