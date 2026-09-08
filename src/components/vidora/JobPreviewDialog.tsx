import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Play, ChevronLeft, ChevronRight } from "lucide-react";

type PreviewJob = {
  id: string;
  title: string;
  result_url: string | null;
  audio_url: string | null;
  thumbnail_url?: string | null;
  narration?: string | null;
  assets?: unknown;
  scenes?: unknown;
};

/** Plays the final MP4 when it exists, otherwise a stills + voiceover preview. */
export function JobPreviewDialog({
  job,
  className,
}: {
  job: PreviewJob;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const images = (Array.isArray(job.assets) ? job.assets : []).filter(
    (u): u is string => typeof u === "string" && u.length > 0,
  );
  const captions = (Array.isArray(job.scenes) ? job.scenes : []) as { caption?: string }[];
  const current = images[Math.min(index, Math.max(0, images.length - 1))];

  return (
    <Dialog>
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

        {job.result_url ? (
          <video
            src={job.result_url}
            poster={job.thumbnail_url ?? undefined}
            controls
            autoPlay
            className="aspect-video w-full rounded-xl bg-black"
          />
        ) : (
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-xl bg-muted">
              {current ? (
                <img
                  src={current}
                  alt={`${job.title} — scene ${index + 1}`}
                  className="aspect-video w-full object-cover"
                />
              ) : (
                <div className="flex aspect-video w-full items-center justify-center text-sm text-muted-foreground">
                  No scene images yet
                </div>
              )}
              {captions[index]?.caption && (
                <p className="absolute inset-x-0 bottom-0 bg-background/80 p-3 text-center text-sm text-foreground">
                  {captions[index]?.caption}
                </p>
              )}
            </div>
            {images.length > 1 && (
              <div className="flex items-center justify-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIndex((i) => Math.max(0, i - 1))}
                  disabled={index === 0}
                  aria-label="Previous scene"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-muted-foreground">
                  Scene {index + 1} of {images.length}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIndex((i) => Math.min(images.length - 1, i + 1))}
                  disabled={index >= images.length - 1}
                  aria-label="Next scene"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
            {job.audio_url && (
              <div className="rounded-xl border border-border bg-card p-3">
                <p className="mb-2 text-sm font-medium text-foreground">Voiceover</p>
                <audio src={job.audio_url} controls className="w-full" />
              </div>
            )}
          </div>
        )}

        {job.narration && (
          <div className="max-h-32 overflow-y-auto rounded-xl border border-border bg-muted/50 p-3 text-sm leading-relaxed text-muted-foreground">
            {job.narration}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
