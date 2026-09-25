import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Play, Loader2, AlertTriangle, Film, X } from "lucide-react";
import { FinalVideoPreview } from "@/components/vidora/FinalVideoPreview";
import { useComposeJobMp4 } from "@/lib/render/useComposeJobMp4";

type PreviewJob = {
  id: string;
  title: string;
  result_url: string | null;
  audio_url: string | null;
  duration_seconds?: number | null;
  thumbnail_url?: string | null;
  narration?: string | null;
  script?: string | null;
  voice?: string | null;
  format?: string | null;
  assets?: unknown;
  scenes?: unknown;
};

/**
 * Plays the finished MP4. When it doesn't exist yet, the user can compose it
 * in the browser explicitly (images + voiceover in sync) — opening the dialog
 * alone never starts a multi-minute render.
 */
export function JobPreviewDialog({
  job,
  className,
}: {
  job: PreviewJob;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(job.result_url);
  const { run, label, cancel } = useComposeJobMp4({ silent: true });

  useEffect(() => {
    setResultUrl(job.result_url);
  }, [job.result_url]);

  const hasSource =
    Boolean(job.audio_url) &&
    Array.isArray(job.assets) &&
    job.assets.some((u) => typeof u === "string" && u.length > 0);

  const compose = () => {
    run.mutate({
      id: job.id,
      title: job.title,
      result_url: job.result_url,
      audio_url: job.audio_url,
      duration_seconds: job.duration_seconds ?? null,
      narration: job.narration ?? null,
      script: job.script ?? null,
      assets: job.assets,
      scenes: job.scenes,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && run.isPending) cancel();
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className={className}>
          <Play className="h-4 w-4" />
          Play
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-left">{job.title}</DialogTitle>
        </DialogHeader>

        {resultUrl ? (
          <FinalVideoPreview
            job={{
              id: job.id,
              title: job.title,
              narration: job.narration ?? null,
              script: job.script ?? null,
              voice: job.voice ?? null,
              format: job.format ?? null,
              duration_seconds: job.duration_seconds ?? null,
              audio_url: job.audio_url,
              result_url: resultUrl,
              thumbnail_url: job.thumbnail_url ?? null,
              assets: job.assets,
              scenes: job.scenes,
            }}
          />
        ) : run.isPending ? (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-muted/40 p-10 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm font-medium text-foreground">
              {label ?? "Building your video…"}
            </p>
            <p className="text-xs text-muted-foreground">
              Keep this tab open — this usually takes a minute or two.
            </p>
            <Button variant="outline" size="sm" className="gap-2" onClick={cancel}>
              <X className="h-4 w-4" />
              Cancel
            </Button>
          </div>
        ) : run.isError ? (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-muted/40 p-8 text-center">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            <p className="text-sm text-muted-foreground">
              {run.error instanceof Error ? run.error.message : "Building the video failed."}
            </p>
            <Button onClick={compose}>Try again</Button>
          </div>
        ) : hasSource ? (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-muted/40 p-10 text-center">
            <Film className="h-6 w-6 text-primary" />
            <p className="text-sm font-medium text-foreground">
              The final MP4 hasn't been built yet
            </p>
            <p className="text-xs text-muted-foreground">
              Compose it here in your browser from the voiceover and scene stills — usually a
              minute or two. Keep this tab open.
            </p>
            <Button onClick={compose} className="gap-2">
              <Play className="h-4 w-4" />
              Compose final MP4
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-muted/40 p-10 text-center text-sm text-muted-foreground">
            This video isn&apos;t ready yet — the voiceover or scene images are still missing.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
