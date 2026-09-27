/**
 * F12 Script Studio — shared types.
 *
 * Section-based scripts with full version history. Every save writes a new
 * `script_versions` row (history is append-only; restore = new version).
 * Status flow: draft → in_review → approved → locked (locked = read-only,
 * enforced server-side). D89: type aliases, not interfaces.
 */
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import { jsonValueSchema } from "../json";

export const ScriptSectionSchema = z.object({
  id: z.string().uuid(),
  heading: z.string().trim().min(1).max(120),
  body: z.string().max(20000),
  /** ESTIMATE seconds (words ÷ wpm), computed at save time; never a promise. */
  estSeconds: z.number().nonnegative().optional(),
});
export type ScriptSection = z.infer<typeof ScriptSectionSchema>;

export const ScriptSectionsSchema = z.array(ScriptSectionSchema).min(1).max(200);

export const SCRIPT_STATUSES = ["draft", "in_review", "approved", "locked"] as const;
export const ScriptStatusSchema = z.enum(SCRIPT_STATUSES);
export type ScriptStatus = z.infer<typeof ScriptStatusSchema>;

/**
 * Allowed status transitions. locked → in_review is the explicit unlock
 * (a reviewer re-opens); nothing else may leave locked, and no edit may
 * land while locked (server-enforced).
 */
export const ALLOWED_TRANSITIONS: Record<ScriptStatus, ScriptStatus[]> = {
  draft: ["in_review"],
  in_review: ["draft", "approved"],
  approved: ["in_review", "locked"],
  locked: ["in_review"],
};

export function validateStatusTransition(from: ScriptStatus, to: ScriptStatus): void {
  if (from === to) return;
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new Error(`Cannot move script from "${from}" to "${to}"`);
  }
}

/** Row shape mirroring public.scripts. */
export type ScriptRow = {
  id: string;
  user_id: string;
  project_id: string;
  title: string;
  status: ScriptStatus;
  current_version_id: string | null;
  word_count: number;
  brand_profile_id: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
};

/** Row shape mirroring public.script_versions. */
export type ScriptVersionRow = {
  id: string;
  script_id: string;
  version_number: number;
  sections: ScriptSection[];
  full_text: string;
  word_count: number;
  /** Per-section timing: { [sectionId]: estSeconds } + total. ESTIMATEs. */
  timing: { sections: Record<string, number>; totalSeconds: number; wpm: number };
  created_by: string | null;
  change_note: string | null;
  created_at: string;
};

/** Brand-voice fields this module READS (Stream A owns brand_profiles CRUD). */
export const BrandVoiceContextSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  tone: z.string(),
  vocabulary: jsonValueSchema,
  persona: z.string(),
  do_list: z.array(z.string()),
  dont_list: z.array(z.string()),
  sample_text: z.string(),
});
export type BrandVoiceContext = z.infer<typeof BrandVoiceContextSchema>;

export const STATUS_COPY: Record<ScriptStatus, { label: string; hint: string }> = {
  draft: { label: "Draft", hint: "Editable work in progress." },
  in_review: { label: "In review", hint: "Waiting for a human review." },
  approved: { label: "Approved", hint: "Signed off — ready to lock or produce." },
  locked: { label: "Locked", hint: "Read-only. Unlock returns it to review." },
};
