import { Button } from "@/components/ui/button";
import { Loader2, PlayCircle } from "lucide-react";
import { needsClientCompose } from "@/lib/jobs/final-video";
import { useComposeJobMp4 } from "@/lib/render/useComposeJobMp4";

type JobLike = {
  id: string;
  title: string;
  status: string;
  stage: string;
  result_url: string | null;
  audio_url: string | null;
  duration_seconds: number | null;
  narration?: string | null;
  script?: string | null;
  assets?: unknown;
  scenes?: unknown;
};

/** True when a job's stills + voiceover exist but the MP4 was never composed. */
export function isStalledCompose(job: JobLike) {
  return job.status === "running" && needsClientCompose(job);
}

export function ResumeComposeButton({
  job,
  className,
}: {
  job: JobLike;
  className?: string;
}) {
  const { run, label } = useComposeJobMp4();

  return (
    <Button
      size="sm"
      variant="secondary"
      className={className}
      onClick={() => run.mutate(job)}
      disabled={run.isPending}
    >
      {run.isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <PlayCircle className="h-4 w-4" />
      )}
      {run.isPending ? (label ?? "Finishing") : "Finish video"}
    </Button>
  );
}
