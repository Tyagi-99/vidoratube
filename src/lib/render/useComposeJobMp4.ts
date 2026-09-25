import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useSession } from "@/hooks/useSession";
import { supabase } from "@/integrations/supabase/client";
import { finalizeVideoJob, failVideoJobCompose } from "@/lib/jobs.functions";

export type ComposableJob = {
  id: string;
  title: string;
  result_url: string | null;
  audio_url: string | null;
  duration_seconds: number | null;
  narration?: string | null;
  script?: string | null;
  assets?: unknown;
  scenes?: unknown;
};

/**
 * Shared browser compose pipeline: ffmpeg.wasm -> storage upload -> finalize.
 * Used by both the "Finish video" button and the Play dialog.
 */
export function useComposeJobMp4(options?: { silent?: boolean }) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const finalize = useServerFn(finalizeVideoJob);
  const failCompose = useServerFn(failVideoJobCompose);
  const [label, setLabel] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const composeActiveRef = useRef(false);

  // Free the ffmpeg worker + 32 MB wasm when this hook unmounts with no
  // compose in flight. (Skipped while active so a concurrent render elsewhere
  // in the tab is never torn down from under itself.)
  useEffect(
    () => () => {
      if (!composeActiveRef.current) {
        void import("@/lib/render/browser-render").then((m) => m.releaseFfmpeg());
      }
    },
    [],
  );

  const run = useMutation({
    mutationFn: async (job: ComposableJob) => {
      if (!user) throw new Error("Sign in to finish rendering.");
      const images = (Array.isArray(job.assets) ? job.assets : []).filter(
        (u): u is string => typeof u === "string" && u.length > 0,
      );
      if (!job.audio_url || images.length === 0) {
        throw new Error("Voiceover or scene visuals are missing — cannot compose the MP4.");
      }
      const scenes = (Array.isArray(job.scenes) ? job.scenes : []) as { caption?: string }[];
      const captions = scenes.map((s) => (s.caption ?? "").trim());

      const controller = new AbortController();
      abortRef.current = controller;
      composeActiveRef.current = true;
      setLabel("Composing final MP4…");

      const { composeQuickJobMp4 } = await import("@/lib/render/quick-job-compose");
      const output = await composeQuickJobMp4({
        title: job.title || "Vidora video",
        images,
        audioUrl: job.audio_url,
        captions,
        narration: job.narration || job.script || "",
        durationSeconds: job.duration_seconds ?? Math.max(15, images.length * 6),
        runKey: `job:${job.id}`,
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
      composeActiveRef.current = false;
      setLabel(null);
      if (!options?.silent) toast.success("Your MP4 is ready");
      queryClient.invalidateQueries({ queryKey: ["my-jobs"] });
    },
    onError: async (error: Error, job) => {
      composeActiveRef.current = false;
      setLabel(null);
      const message = error.message || "Compose failed";
      try {
        await failCompose({ data: { id: job.id, error: message } });
      } catch {
        /* keep the original error visible */
      }
      queryClient.invalidateQueries({ queryKey: ["my-jobs"] });
      if (!options?.silent) toast.error(message);
    },
  });

  const cancel = () => {
    abortRef.current?.abort();
  };

  return { run, label, cancel };
}
