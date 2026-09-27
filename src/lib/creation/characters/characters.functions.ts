/**
 * F16 — Character System server functions (Stream C).
 *
 * Thin wrappers over `characters.server.ts` + `types.ts`: auth + zod
 * validation + rate limits here, business logic in the server module.
 * Reference images arrive as data URLs, are validated server-side
 * (MIME/size per SECURITY_MODEL roadmap item 4), and land in the private
 * `generated-videos` bucket — never hotlinked.
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireAppUser } from "../../server-auth";
import { CREATION_BUCKET, type StoragePort } from "../storage";
import { REFERENCE_IMAGE_ALLOWED_MIME, validateReferenceUpload } from "./types";
import {
  bindCharacterToScene,
  createCharacter,
  deleteCharacter,
  listCharacters,
  scenesUsingCharacter,
  updateCharacter,
  uploadReferenceImage,
} from "./characters.server";
import type { Database } from "@/integrations/supabase/types";

function realStoragePort(admin: SupabaseClient<Database>): StoragePort {
  return {
    uploadImage: async (path, bytes, contentType) => {
      const { error } = await admin.storage
        .from(CREATION_BUCKET)
        .upload(path, bytes, { contentType, upsert: true });
      if (error) throw new Error(`Reference image upload failed: ${error.message}`);
    },
    signImage: async (path, expiresInSeconds = 3600) => {
      const { data } = await admin.storage
        .from(CREATION_BUCKET)
        .createSignedUrl(path, expiresInSeconds);
      return data?.signedUrl ?? null;
    },
  };
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function uploadRateLimit(userId: string, adminClient: SupabaseClient<Database>) {
  const { enforcePostgresRateLimit } = await import("@/lib/rate-limit");
  await enforcePostgresRateLimit(
    adminClient,
    `characters:upload-ref:${userId}`,
    { max: 20, windowSeconds: 3600 },
    "You're uploading reference images too fast. Please wait a bit.",
  );
}

/* ── CRUD ────────────────────────────────────────────────────────────── */

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(2000).default(""),
  style_notes: z
    .object({
      art_style: z.string().trim().max(300).default(""),
      palette: z.string().trim().max(300).default(""),
      wardrobe: z.string().trim().max(300).default(""),
    })
    .partial()
    .default({}),
});

export const createCharacterFn = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((input: unknown) => createSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const result = await createCharacter(await admin(), {
      userId,
      name: data.name,
      description: data.description,
      styleNotes: data.style_notes,
    });
    if (!result.ok) throw new Error(result.message);
    return result;
  });

export const listCharactersFn = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((input: unknown) => z.object({}).parse(input))
  .handler(async ({ context }) => {
    const { userId } = context;
    const result = await listCharacters(await admin(), { userId });
    if (!result.ok) throw new Error(result.message);
    return result;
  });

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(2000).optional(),
  style_notes: z
    .object({
      art_style: z.string().trim().max(300).default(""),
      palette: z.string().trim().max(300).default(""),
      wardrobe: z.string().trim().max(300).default(""),
    })
    .partial()
    .optional(),
});

export const updateCharacterFn = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((input: unknown) => updateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const result = await updateCharacter(await admin(), {
      userId,
      characterId: data.id,
      patch: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.style_notes !== undefined ? { styleNotes: data.style_notes } : {}),
      },
    });
    if (!result.ok) throw new Error(result.message);
    return result;
  });

const deleteSchema = z.object({ id: z.string().uuid() });

export const deleteCharacterFn = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((input: unknown) => deleteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const result = await deleteCharacter(await admin(), { userId, characterId: data.id });
    if (!result.ok) throw new Error(result.message);
    return result;
  });

/* ── Reference image ─────────────────────────────────────────────────── */

const uploadRefSchema = z.object({
  id: z.string().uuid(),
  /** data:image/<jpeg|png|webp>;base64,… (≤5 MB decoded) */
  image_data_url: z
    .string()
    .min(1)
    .max(8 * 1024 * 1024),
});

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; mimeType: string } {
  const match = /^data:([a-z]+\/[a-z0-9+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!match) throw new Error("Expected a base64 image data URL.");
  const mimeType = match[1]!;
  const bytes = new Uint8Array(Buffer.from(match[2]!, "base64"));
  return { bytes, mimeType };
}

export const uploadCharacterReference = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((input: unknown) => uploadRefSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const adminClient = await admin();
    await uploadRateLimit(userId, adminClient);
    const { bytes, mimeType } = decodeDataUrl(data.image_data_url);
    if (
      !REFERENCE_IMAGE_ALLOWED_MIME.includes(
        mimeType as (typeof REFERENCE_IMAGE_ALLOWED_MIME)[number],
      )
    ) {
      throw new Error(
        `Unsupported image type "${mimeType}". Use ${REFERENCE_IMAGE_ALLOWED_MIME.join(", ")}.`,
      );
    }
    const problem = validateReferenceUpload({ byteLength: bytes.byteLength, mimeType });
    if (problem) throw new Error(problem);
    const result = await uploadReferenceImage(adminClient, realStoragePort(adminClient), {
      userId,
      characterId: data.id,
      bytes,
      mimeType,
    });
    if (!result.ok) throw new Error(result.message);
    return result;
  });

const viewRefSchema = z.object({ id: z.string().uuid() });

/** Character row + signed reference-image URL (null when no reference). */
export const getCharacterWithViewUrl = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((input: unknown) => viewRefSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const adminClient = await admin();
    const { data: row, error } = await adminClient
      .from("characters")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Character not found.");
    const refPath = (row as { reference_image_url: string | null }).reference_image_url;
    const { data: signed } = await adminClient.storage
      .from(CREATION_BUCKET)
      .createSignedUrl(refPath ?? "", 3600);
    return { character: row, viewUrl: refPath ? (signed?.signedUrl ?? null) : null };
  });

/* ── Scene binding ───────────────────────────────────────────────────── */

const bindSchema = z.object({
  scene_id: z.string().uuid(),
  character_id: z.string().uuid().nullable(),
});

export const bindCharacterToSceneFn = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((input: unknown) => bindSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const result = await bindCharacterToScene(await admin(), {
      userId,
      sceneId: data.scene_id,
      characterId: data.character_id,
    });
    // not_found outcomes are normal UI states (stale pickers), returned not thrown.
    return result;
  });

const scenesUsingSchema = z.object({ character_id: z.string().uuid() });

export const scenesUsingCharacterFn = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((input: unknown) => scenesUsingSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const result = await scenesUsingCharacter(await admin(), {
      userId,
      characterId: data.character_id,
    });
    if (!result.ok) throw new Error(result.message);
    return result;
  });

const unbindSchema = z.object({ scene_id: z.string().uuid() });

/** Detach a character reference from a scene (bind with character_id: null). */
export const unbindCharacterFromSceneFn = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((input: unknown) => unbindSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    // Detach is a normal UI outcome (idempotent), so the envelope is returned.
    return bindCharacterToScene(await admin(), {
      userId,
      sceneId: data.scene_id,
      characterId: null,
    });
  });

/** Honesty copy — single source of truth (see characters/types.ts). */
export { CHARACTER_CONSISTENCY_DISCLAIMER } from "./types";
