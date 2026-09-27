/**
 * F16 — Character System types + validation (Stream C).
 *
 * D89: the generated `types.ts` lags the migrations (and carries a stale
 * pre-Phase-3 characters shape), so local `type` aliases are used here.
 *
 * HONESTY RULE (founder-set): the character-CONSISTENCY marketing claim was
 * REMOVED pending a 6-scene proof render. Nothing in this module claims the
 * system produces consistent characters — a bound character is "reference
 * attached (consistency not yet verified)" until the proof render exists
 * (docs/KNOWN_ISSUES.md).
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Minimal surface of the service-role client used by the character module. */
export type CharacterDb = Pick<SupabaseClient, "from">;

/* ── D89: local table-type aliases ───────────────────────────────────────── */

export type CharacterRow = {
  id: string;
  user_id: string;
  name: string;
  reference_image_url: string | null;
  description: string;
  /** Flat string key/value style guidance (wire-safe; jsonb in the DB). */
  style_notes: Record<string, string>;
  created_at: string;
  updated_at: string;
};

export type SceneRowLite = {
  id: string;
  project_id: string;
  scene_number: number;
  metadata: Record<string, unknown> | null;
};

/* ── Validation ──────────────────────────────────────────────────────────── */

export const CharacterNameSchema = z
  .string()
  .trim()
  .min(1, "Give the character a name.")
  .max(80, "Keep the name under 80 characters.");

export const CharacterDescriptionSchema = z
  .string()
  .trim()
  .max(2000, "Keep the description under 2000 characters.")
  .default("");

export const CharacterStyleNotesSchema = z
  .object({
    art_style: z.string().trim().max(300).default(""),
    palette: z.string().trim().max(300).default(""),
    wardrobe: z.string().trim().max(300).default(""),
  })
  .partial()
  .default({});

export type CharacterStyleNotes = z.infer<typeof CharacterStyleNotesSchema>;

/* ── Reference-image upload validation (SECURITY_MODEL roadmap item 4) ───── */

export const REFERENCE_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export const REFERENCE_IMAGE_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export type ReferenceImageMime = (typeof REFERENCE_IMAGE_ALLOWED_MIME)[number];

const MIME_TO_EXT: Record<ReferenceImageMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Validate a reference-image upload before it touches Storage.
 * Returns a human-readable problem, or null when the upload is acceptable.
 */
export function validateReferenceUpload(input: {
  byteLength: number;
  mimeType: string;
}): string | null {
  if (!REFERENCE_IMAGE_ALLOWED_MIME.includes(input.mimeType as ReferenceImageMime)) {
    return (
      `Unsupported image type "${input.mimeType}". ` +
      `Use ${REFERENCE_IMAGE_ALLOWED_MIME.join(", ")}.`
    );
  }
  if (!Number.isFinite(input.byteLength) || input.byteLength <= 0) {
    return "The image file is empty.";
  }
  if (input.byteLength > REFERENCE_IMAGE_MAX_BYTES) {
    return `Image is ${(input.byteLength / 1024 / 1024).toFixed(1)} MB — the limit is 5 MB.`;
  }
  return null;
}

/** Storage file extension for a validated MIME type. */
export function referenceImageExt(mimeType: ReferenceImageMime): string {
  return MIME_TO_EXT[mimeType];
}

/** Storage path for a character reference image (owner-scoped prefix). */
export function referenceImagePath(
  userId: string,
  characterId: string,
  mimeType: ReferenceImageMime,
): string {
  const safeUser = userId.replace(/[^a-zA-Z0-9-]/g, "");
  const safeChar = characterId.replace(/[^a-zA-Z0-9-]/g, "");
  return `character-refs/${safeUser}/${safeChar}/ref.${MIME_TO_EXT[mimeType]}`;
}

/* ── Character-consistency honesty copy (single source of truth) ─────────── */

/** Shown wherever a character reference is attached to a scene/project. */
export const CHARACTER_CONSISTENCY_DISCLAIMER =
  "Reference attached — visual consistency across scenes is not yet verified. " +
  "A 6-scene proof render is required before any consistency claim is made.";
