import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Play, Loader2, AlertTriangle } from "lucide-react";
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
 * Plays the finished MP4. When it doesn't exist yet, it is composed in the
 * browser automatically (images + voiceover in sync), then played.
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
  const started = useRef(false);
  const { run, label } = useComposeJobMp4({ silent: true });

  useEffect(() => {
    setResultUrl(job.result_url);
  }, [job.result_url]);

  const hasSource =
    Boolean(job.audio_url) &&
    Array.isArray(job.assets) &&
    job.assets.some((u) => typeof u === "string" && u.length > 0);

  useEffect(() => {
    if (!open || resultUrl || started.current || !hasSource) return;
    started.current = true;
    run.mutate(
      {
        id: job.id,
        title: job.title,
        result_url: job.result_url,
        audio_url: job.audio_url,
        duration_seconds: job.duration_seconds ?? null,
        narration: job.narration ?? null,
        script: job.script ?? null,
        assets: job.assets,
        scenes: job.scenes,
      },
      {
        onSuccess: (finished) => {
          const url = (finished as { result_url?: string | null })?.result_url ?? null;
          if (url) setResultUrl(url);
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resultUrl, hasSource]);

  const retry = () => {
    started.current = false;
    run.reset();
    setResultUrl(null);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
        ) : run.isError ? (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-muted/40 p-8 text-center">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            <p className="text-sm text-muted-foreground">
              {run.error instanceof Error ? run.error.message : "Building the video failed."}
            </p>
            <Button onClick={retry}>Try again</Button>
          </div>
        ) : hasSource ? (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-muted/40 p-10 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm font-medium text-foreground">
              {label ?? "Building your video…"}
            </p>
            <p className="text-xs text-muted-foreground">
              Keep this tab open — this usually takes a minute or two.
            </p>
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
