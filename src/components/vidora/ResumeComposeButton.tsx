import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Loader2, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/hooks/useSession";
import { supabase } from "@/integrations/supabase/client";
import { finalizeVideoJob, failVideoJobCompose } from "@/lib/jobs.functions";
import { needsClientCompose } from "@/lib/jobs/final-video";

type JobLike = {
  id: string;
  title: string;
  status: string;
  stage: string;
  result_url: string | null;
  audio_url: string | null;
  duration_seconds: number | null;
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
  const { user } = useSession();
  const queryClient = useQueryClient();
  const finalize = useServerFn(finalizeVideoJob);
  const failCompose = useServerFn(failVideoJobCompose);
  const [label, setLabel] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sign in to finish rendering.");
      const images = (Array.isArray(job.assets) ? job.assets : []).filter(
        (u): u is string => typeof u === "string" && u.length > 0,
      );
      if (!job.audio_url || images.length === 0) {
        throw new Error("Voiceover or scene visuals are missing — cannot compose the MP4.");
      }
      const scenes = (Array.isArray(job.scenes) ? job.scenes : []) as { caption?: string }[];
      const captions = scenes.map((s, i) => s.caption?.trim() || `Scene ${i + 1}`);

      const controller = new AbortController();
      abortRef.current = controller;
      setLabel("Starting");

      const { composeQuickJobMp4 } = await import("@/lib/render/quick-job-compose");
      const output = await composeQuickJobMp4({
        title: job.title || "Vidora video",
        images,
        audioUrl: job.audio_url,
        captions,
        durationSeconds: job.duration_seconds ?? Math.max(15, images.length * 6),
        signal: controller.signal,
        onProgress: (p) => setLabel(p.label),
      });

      setLabel("Saving");
      const storagePath = `${user.id}/${job.id}/video.mp4`;
      const upload = await supabase.storage
        .from("generated-videos")
        .upload(storagePath, output.blob, { contentType: "video/mp4", upsert: true });
      if (upload.error) throw new Error(`Saving the MP4 failed: ${upload.error.message}`);

      return await finalize({
        data: {
          id: job.id,
          path: storagePath,
          file_size: output.blob.size,
          duration: output.duration,
          width: output.width,
          height: output.height,
        },
      });
    },
    onSuccess: () => {
      setLabel(null);
      toast.success("Your MP4 is ready");
      queryClient.invalidateQueries();
    },
    onError: async (error: Error) => {
      setLabel(null);
      const message = error.message || "Compose failed";
      try {
        await failCompose({ data: { id: job.id, error: message } });
      } catch {
        /* keep the original error visible */
      }
      queryClient.invalidateQueries();
      toast.error(message);
    },
  });

  return (
    <Button
      size="sm"
      variant="secondary"
      className={className}
      onClick={() => run.mutate()}
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
