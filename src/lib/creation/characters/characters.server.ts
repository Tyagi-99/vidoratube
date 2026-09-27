/**
 * F16 — character server logic (Stream C): CRUD, reference-image upload with
 * MIME/size validation, and binding a character to scenes via
 * `scenes.metadata -> character_id`.
 *
 * SERVER-ONLY. `CharacterDb` is structural (D89). Every op is owner-scoped
 * (user_id filter on every read/write) and returns the `{ ok }` envelope —
 * never throws.
 */
import { z } from "zod";
import {
  CHARACTER_CONSISTENCY_DISCLAIMER,
  CharacterDescriptionSchema,
  CharacterNameSchema,
  CharacterStyleNotesSchema,
  REFERENCE_IMAGE_MAX_BYTES,
  referenceImageExt,
  referenceImagePath,
  validateReferenceUpload,
  type CharacterDb,
  type CharacterRow,
  type CharacterStyleNotes,
  type ReferenceImageMime,
  type SceneRowLite,
} from "./types";
import type { StoragePort } from "../storage";

export type CharacterOpResult<T> =
  { ok: true; data: T } | { ok: false; code: string; message: string };

function fail<T>(code: string, message: string): CharacterOpResult<T> {
  return { ok: false, code, message };
}

/* ── CRUD ────────────────────────────────────────────────────────────────── */

const CreateCharacterSchema = z.object({
  name: CharacterNameSchema,
  description: CharacterDescriptionSchema,
  style_notes: CharacterStyleNotesSchema,
});

export async function createCharacter(
  admin: CharacterDb,
  input: { userId: string; name: string; description?: string; styleNotes?: unknown },
): Promise<CharacterOpResult<CharacterRow>> {
  const parsed = CreateCharacterSchema.safeParse({
    name: input.name,
    description: input.description ?? "",
    style_notes: input.styleNotes ?? {},
  });
  if (!parsed.success) {
    return fail("invalid_input", parsed.error.issues[0]?.message ?? "Invalid character.");
  }
  const { data, error } = await admin
    .from("characters")
    .insert({
      user_id: input.userId,
      name: parsed.data.name,
      description: parsed.data.description,
      style_notes: parsed.data.style_notes as unknown as Record<string, string>,
    })
    .select()
    .single();
  if (error) return fail("db_error", error.message);
  return { ok: true, data: data as CharacterRow };
}

export async function listCharacters(
  admin: CharacterDb,
  input: { userId: string },
): Promise<CharacterOpResult<CharacterRow[]>> {
  const { data, error } = await admin
    .from("characters")
    .select("*")
    .eq("user_id", input.userId)
    .order("updated_at", { ascending: false });
  if (error) return fail("db_error", error.message);
  return { ok: true, data: (data ?? []) as CharacterRow[] };
}

const UpdateCharacterSchema = z.object({
  name: CharacterNameSchema.optional(),
  description: CharacterDescriptionSchema.optional(),
  style_notes: CharacterStyleNotesSchema.optional(),
});

export async function updateCharacter(
  admin: CharacterDb,
  input: {
    userId: string;
    characterId: string;
    patch: Partial<{ name: string; description: string; styleNotes: unknown }>;
  },
): Promise<CharacterOpResult<CharacterRow>> {
  const parsed = UpdateCharacterSchema.safeParse({
    ...(input.patch.name !== undefined ? { name: input.patch.name } : {}),
    ...(input.patch.description !== undefined ? { description: input.patch.description } : {}),
    ...(input.patch.styleNotes !== undefined ? { style_notes: input.patch.styleNotes } : {}),
  });
  if (!parsed.success) {
    return fail("invalid_input", parsed.error.issues[0]?.message ?? "Invalid character update.");
  }
  if (Object.keys(parsed.data).length === 0) {
    return fail("invalid_input", "Nothing to update.");
  }
  const { data, error } = await admin
    .from("characters")
    .update(parsed.data as Record<string, unknown>)
    .eq("id", input.characterId)
    .eq("user_id", input.userId)
    .select()
    .single();
  if (error) return fail("db_error", error.message);
  if (!data) return fail("not_found", "Character not found.");
  return { ok: true, data: data as CharacterRow };
}

export async function deleteCharacter(
  admin: CharacterDb,
  input: { userId: string; characterId: string },
): Promise<CharacterOpResult<{ id: string }>> {
  const { data, error } = await admin
    .from("characters")
    .delete()
    .eq("id", input.characterId)
    .eq("user_id", input.userId)
    .select("id")
    .single();
  if (error) return fail("db_error", error.message);
  if (!data) return fail("not_found", "Character not found.");
  return { ok: true, data: { id: (data as { id: string }).id } };
}

/* ── Reference-image upload ──────────────────────────────────────────────── */

/**
 * Validate + store a character reference image in Supabase Storage and record
 * its path on the character row. The stored value is a STORAGE PATH
 * (view via signed URL), never a hotlinked remote URL.
 */
export async function uploadReferenceImage(
  admin: CharacterDb,
  storage: StoragePort,
  input: { userId: string; characterId: string; bytes: Uint8Array; mimeType: string },
): Promise<CharacterOpResult<{ storagePath: string }>> {
  const problem = validateReferenceUpload({
    byteLength: input.bytes.byteLength,
    mimeType: input.mimeType,
  });
  if (problem) return fail("invalid_upload", problem);

  const { data: character, error: readError } = await admin
    .from("characters")
    .select("id")
    .eq("id", input.characterId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (readError) return fail("db_error", readError.message);
  if (!character) return fail("not_found", "Character not found.");

  const mime = input.mimeType as ReferenceImageMime;
  const path = referenceImagePath(input.userId, input.characterId, mime);
  try {
    await storage.uploadImage(path, input.bytes, mime);
  } catch (e) {
    return fail("storage_error", e instanceof Error ? e.message : "Reference image upload failed.");
  }
  const { error } = await admin
    .from("characters")
    .update({ reference_image_url: path })
    .eq("id", input.characterId)
    .eq("user_id", input.userId);
  if (error) return fail("db_error", error.message);
  return { ok: true, data: { storagePath: path } };
}

/* ── Scene binding ───────────────────────────────────────────────────────── */

/**
 * Bind (or unbind with `characterId: null`) a character to a scene by writing
 * `character_id` into `scenes.metadata`. Both the scene and the character
 * must belong to the caller. The result carries the consistency disclaimer —
 * binding is a reference attachment, not a consistency guarantee.
 */
export async function bindCharacterToScene(
  admin: CharacterDb,
  input: { userId: string; sceneId: string; characterId: string | null },
): Promise<CharacterOpResult<{ sceneId: string; characterId: string | null; disclaimer: string }>> {
  const { data: scene, error: sceneError } = await admin
    .from("scenes")
    .select("id, project_id, scene_number, metadata")
    .eq("id", input.sceneId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (sceneError) return fail("db_error", sceneError.message);
  if (!scene) return fail("scene_not_found", "Scene not found.");

  if (input.characterId !== null) {
    const { data: character, error: charError } = await admin
      .from("characters")
      .select("id")
      .eq("id", input.characterId)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (charError) return fail("db_error", charError.message);
    if (!character) return fail("character_not_found", "Character not found.");
  }

  const current = ((scene as SceneRowLite).metadata ?? {}) as Record<string, unknown>;
  const metadata = { ...current, character_id: input.characterId };
  const { error } = await admin
    .from("scenes")
    .update({ metadata })
    .eq("id", input.sceneId)
    .eq("user_id", input.userId);
  if (error) return fail("db_error", error.message);
  return {
    ok: true,
    data: {
      sceneId: input.sceneId,
      characterId: input.characterId,
      disclaimer: CHARACTER_CONSISTENCY_DISCLAIMER,
    },
  };
}

/** Scenes a character is currently bound to (for the "used in N scenes" UI). */
export async function scenesUsingCharacter(
  admin: CharacterDb,
  input: { userId: string; characterId: string },
): Promise<CharacterOpResult<{ sceneId: string; projectId: string; sceneNumber: number }[]>> {
  const { data, error } = await admin
    .from("scenes")
    .select("id, project_id, scene_number, metadata")
    .eq("user_id", input.userId);
  if (error) return fail("db_error", error.message);
  const rows = ((data ?? []) as SceneRowLite[]).filter(
    (s) => (s.metadata as Record<string, unknown> | null)?.["character_id"] === input.characterId,
  );
  return {
    ok: true,
    data: rows.map((s) => ({
      sceneId: s.id,
      projectId: s.project_id,
      sceneNumber: s.scene_number,
    })),
  };
}

export { CHARACTER_CONSISTENCY_DISCLAIMER, REFERENCE_IMAGE_MAX_BYTES, referenceImageExt };
export type { CharacterDb } from "./types";
export type { CharacterStyleNotes };
