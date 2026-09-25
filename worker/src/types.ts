import { z } from "zod";

/** Word-level caption cue (seconds). */
export const WordCueSchema = z.object({
  word: z.string(),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
});
export type WordCue = z.infer<typeof WordCueSchema>;

/** One scene of the timeline. URLs are Supabase storage paths or https URLs. */
export const SceneInputSchema = z.object({
  id: z.string(),
  number: z.number().int().nonnegative(),
  narration: z.string().default(""),
  image: z.string().nullable().default(null),
  audio: z.string().nullable().default(null),
  duration: z.number().positive(),
  cues: z.array(WordCueSchema).default([]),
});
export type SceneInput = z.infer<typeof SceneInputSchema>;

/** Validated render job payload stored in renders.meta. */
export const RenderJobMetaSchema = z.object({
  scenes: z.array(SceneInputSchema).min(1).max(200),
  title: z.string().max(200).default("Untitled video"),
  aspect: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
  fps: z.number().int().min(24).max(60).default(30),
  burnCaptions: z.boolean().default(true),
  musicUrl: z.string().nullable().default(null),
  musicVolume: z.number().min(0).max(1).default(0.15),
  musicDucking: z.boolean().default(true),
  voiceoverUrl: z.string().nullable().default(null),
});
export type RenderJobMeta = z.infer<typeof RenderJobMetaSchema>;

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type RenderJob = {
  id: string;
  user_id: string;
  project_id: string | null;
  engine: string;
  status: string;
  stage: string;
  progress: number;
  aspect_ratio: string | null;
  attempts: number;
  max_attempts: number;
  claimed_at: string | null;
  claimed_by: string | null;
  checkpoint: Record<string, unknown>;
  cancel_requested: boolean;
  meta: unknown;
  error: string | null;
};

export type StageId =
  | "claimed"
  | "assets"
  | "segments"
  | "combine"
  | "audio"
  | "captions"
  | "finalize"
  | "upload"
  | "done";
