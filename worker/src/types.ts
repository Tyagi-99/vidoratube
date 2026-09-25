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

/**
 * Continuity brief (Sprint 3-4): generated once per chapter-mode render and
 * passed to EVERY chapter render so voice, pacing, and visual style stay
 * consistent. Mirrors src/lib/chapters/brief.ts (duplicated to keep the
 * worker dependency-free, like ASPECTS in pipeline.ts).
 */
export const ContinuityBriefSchema = z.object({
  version: z.literal(1),
  voice: z.object({
    id: z.string(),
    languageCode: z.string(),
    model: z.string(),
  }),
  pacing: z.object({
    wordsPerMinute: z.number().positive(),
  }),
  visuals: z.object({
    background: z.object({
      type: z.literal("solid"),
      color: z.string(),
    }),
    captionStyle: z.object({
      font: z.string(),
      fontSize: z.number().positive(),
      primaryColor: z.string(),
    }),
  }),
  tone: z.string(),
});
export type ContinuityBrief = z.infer<typeof ContinuityBriefSchema>;

/** Validated render job payload stored in renders.meta. */
export const RenderJobMetaSchema = z.object({
  scenes: z.array(SceneInputSchema).min(1).max(200),
  title: z.string().max(200).default("Untitled video"),
  aspect: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
  fps: z.number().int().min(24).max(60).default(30),
  burnCaptions: z.boolean().default(true),
  /** BCP-47-ish code into the `languages` table; drives caption font, RTL, line length. */
  languageCode: z.string().max(16).default("en"),
  musicUrl: z.string().nullable().default(null),
  musicVolume: z.number().min(0).max(1).default(0.15),
  musicDucking: z.boolean().default(true),
  voiceoverUrl: z.string().nullable().default(null),
  /**
   * Chapter mode (Sprint 3-4): the render is split into render_chapters
   * rows; the worker renders chapters (possibly in parallel) and stitches
   * them. meta.scenes carries a single synthetic scene with the total
   * duration so quote math and legacy billing paths keep working; the real
   * media plan lives in render_chapters.
   */
  chapterMode: z.boolean().default(false),
  /** Identical brief object handed to every chapter render. */
  continuityBrief: ContinuityBriefSchema.nullable().default(null),
  /** 2.5D parallax treatment on stills (premium add-on, +0.25 credits/min). */
  parallax25d: z.boolean().default(false),
  /** Creation mode: "story" applies the Story Mode narrative template. */
  creationMode: z.enum(["script", "voiceover", "auto_edit", "story"]).default("script"),
  /**
   * Agency tier (Sprint 7-8): white-label gating. The app resolves this from
   * the workspace's plan_tier (resolveExportMeta) — true on the free tier
   * (Vidora bug burned in), false on paid tiers (clean export). The worker
   * never decides billing on its own; the default keeps the watermark.
   */
  watermark: z.boolean().default(true),
  /**
   * Agency tier: brand kit overlay threaded from brand_kits at enqueue time.
   * logoPath is a storage path in the brand-logos bucket (signed at render).
   */
  brandOverlay: z
    .object({
      primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
      secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
      logoPath: z.string().max(500).nullable(),
      fontFamily: z.string().max(60),
    })
    .nullable()
    .default(null),
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
