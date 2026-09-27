/**
 * F9 Visual Research — shared types.
 *
 * D89: local table-type declarations are `type` aliases (not interfaces) until
 * the generated supabase types catch up.
 */
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";

export const RESEARCH_SOURCE_TYPES = [
  "web",
  "video",
  "paper",
  "transcript",
  "upload",
  "other",
] as const;

export const ResearchSourceTypeSchema = z.enum(RESEARCH_SOURCE_TYPES);
export type ResearchSourceType = z.infer<typeof ResearchSourceTypeSchema>;

/** Row shape mirroring public.research_sources (+ Phase-3 `position`). */
export type ResearchSourceRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  research_project_id: string | null;
  source_type: ResearchSourceType;
  url: string | null;
  title: string;
  excerpt: string;
  content: string | null;
  published_at: string | null;
  credibility: Json;
  metadata: Json;
  position: number;
  created_at: string;
  updated_at: string;
};

/** Canvas card presented to the UI (row + derived presentation facts). */
export type CanvasSource = ResearchSourceRow & {
  /** Claim rows linked to this source (for citation display). */
  claimCount: number;
};

/** Source-type badge copy. Never invents a type the table can't hold. */
export const SOURCE_TYPE_BADGES: Record<ResearchSourceType, { label: string; hint: string }> = {
  web: { label: "Web", hint: "Web article or page" },
  video: { label: "Video", hint: "Video source / clip reference" },
  paper: { label: "Paper", hint: "Paper, study, or report" },
  transcript: { label: "Transcript", hint: "Transcript excerpt" },
  upload: { label: "Upload", hint: "User-uploaded file or reference image" },
  other: { label: "Other", hint: "Other source kind" },
};

export const CreateSourceSchema = z.object({
  projectId: z.string().uuid(),
  sourceType: ResearchSourceTypeSchema,
  url: z.string().url().max(2000).optional().or(z.literal("")),
  title: z.string().trim().min(1).max(200),
  excerpt: z.string().max(2000).default(""),
  publishedAt: z.string().datetime().optional().nullable(),
});
export type CreateSourceInput = z.infer<typeof CreateSourceSchema>;

export const UpdateSourceSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  excerpt: z.string().max(2000).optional(),
  publishedAt: z.string().datetime().optional().nullable(),
});
export type UpdateSourceInput = z.infer<typeof UpdateSourceSchema>;

export const ReorderSourcesSchema = z.object({
  projectId: z.string().uuid(),
  /** Desired order, first = position 0. Must match the project's source set exactly. */
  orderedIds: z.array(z.string().uuid()).min(1).max(500),
});
export type ReorderSourcesInput = z.infer<typeof ReorderSourcesSchema>;
