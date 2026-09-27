/**
 * F15 — Thumbnail Studio server functions (Stream C).
 *
 * Thin wrappers over `projects.server.ts`: auth + zod validation + rate
 * limits here, all business logic (preflight, provider, DB) in the server
 * module. Business outcomes return the `{ ok }` envelope (never thrown);
 * unexpected failures throw like the rest of the codebase.
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireAppUser } from "../../server-auth";
import { CREATION_BUCKET, type StoragePort } from "../storage";
import { CanvasAspectSchema, emptyCanvas } from "./canvas";
import {
  ExperimentArmTypeSchema,
  ThumbnailProjectStatusSchema,
  createThumbnailProject,
  generateThumbnailVariants,
  getThumbnailProject,
  imageProviderStatus,
  linkVariantToExperiment,
  listProjectVariants,
  selectVariantWinner,
  setThumbnailProjectStatus,
  updateThumbnailCanvas,
} from "./projects.server";
import type { Database } from "@/integrations/supabase/types";

function realStoragePort(admin: SupabaseClient<Database>): StoragePort {
  return {
    uploadImage: async (path, bytes, contentType) => {
      const { error } = await admin.storage
        .from(CREATION_BUCKET)
        .upload(path, bytes, { contentType, upsert: true });
      if (error) throw new Error(`Thumbnail upload failed: ${error.message}`);
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

async function generationRateLimit(userId: string, adminClient: SupabaseClient<Database>) {
  const { enforcePostgresRateLimit } = await import("@/lib/rate-limit");
  await enforcePostgresRateLimit(
    adminClient,
    `thumbnails:generate-variants:${userId}`,
    { max: 10, windowSeconds: 3600 },
    "You're generating thumbnail variants too fast. Please wait a bit.",
  );
}

/* ── Project surface ─────────────────────────────────────────────────────── */

const getOrCreateSchema = z.object({
  project_id: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  aspect: CanvasAspectSchema.default("16:9"),
});

/** Latest thumbnail project for a creation project, creating one when absent. */
export const getOrCreateThumbnailProject = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((input: unknown) => getOrCreateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const adminClient = await admin();
    const existing = await getThumbnailProject(adminClient, {
      userId,
      projectId: data.project_id,
    });
    if (!existing.ok) throw new Error(existing.message);
    if (existing.data) return existing;
    const created = await createThumbnailProject(adminClient, {
      userId,
      projectId: data.project_id,
      name: data.name,
      aspect: data.aspect,
    });
    if (!created.ok) throw new Error(created.message);
    // Normalize to the LoadedProject shape so the UI has one contract.
    return {
      ok: true,
      data: { project: created.data, canvas: emptyCanvas(), problems: [] as string[] },
    };
  });

const saveCanvasSchema = z.object({
  thumbnail_project_id: z.string().uuid(),
  canvas: z.unknown(),
});

export const saveThumbnailCanvas = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((input: unknown) => saveCanvasSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const result = await updateThumbnailCanvas(await admin(), {
      userId,
      thumbnailProjectId: data.thumbnail_project_id,
      canvas: data.canvas,
    });
    if (!result.ok) throw new Error(result.message);
    return result;
  });

const setStatusSchema = z.object({
  thumbnail_project_id: z.string().uuid(),
  status: ThumbnailProjectStatusSchema,
});

export const setThumbnailProjectStatusFn = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((input: unknown) => setStatusSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const result = await setThumbnailProjectStatus(await admin(), {
      userId,
      thumbnailProjectId: data.thumbnail_project_id,
      status: data.status,
    });
    // Status outcomes are a UX flow (illegal_transition is expected UI input),
    // so the envelope is returned, not thrown.
    return result;
  });

/* ── Paid variant generation ─────────────────────────────────────────────── */

const generateVariantsSchema = z.object({
  project_id: z.string().uuid(),
  video_title: z.string().trim().min(1).max(120),
  video_topic: z.string().trim().min(1).max(200),
  style_hint: z.string().trim().max(200).optional(),
  count: z.number().int().min(1).max(8).default(4),
  aspect: CanvasAspectSchema.default("16:9"),
});

/**
 * Generate N AI thumbnail variants (credit-preflighted). Returns the envelope:
 * `image_provider_unconfigured` / `INSUFFICIENT_CREDITS` / `BUDGET_EXCEEDED`
 * are normal outcomes the UI must render honestly — never thrown.
 */
export const generateThumbnailVariantsFn = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((input: unknown) => generateVariantsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const adminClient = await admin();
    await generationRateLimit(userId, adminClient);
    return generateThumbnailVariants(adminClient, realStoragePort(adminClient), {
      userId,
      projectId: data.project_id,
      videoTitle: data.video_title,
      videoTopic: data.video_topic,
      styleHint: data.style_hint,
      count: data.count,
      aspect: data.aspect,
    });
  });

const listVariantsSchema = z.object({ project_id: z.string().uuid() });

export const listThumbnailVariants = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((input: unknown) => listVariantsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const adminClient = await admin();
    const result = await listProjectVariants(adminClient, realStoragePort(adminClient), {
      userId,
      projectId: data.project_id,
    });
    if (!result.ok) throw new Error(result.message);
    return result;
  });

const selectWinnerSchema = z.object({ thumbnail_id: z.string().uuid() });

export const selectThumbnailWinner = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((input: unknown) => selectWinnerSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const result = await selectVariantWinner(await admin(), {
      userId,
      thumbnailId: data.thumbnail_id,
    });
    if (!result.ok) throw new Error(result.message);
    return result;
  });

const linkArmSchema = z.object({
  experiment_id: z.string().uuid(),
  thumbnail_id: z.string().uuid(),
  arm_name: z.string().trim().min(1).max(120).optional(),
  arm_type: ExperimentArmTypeSchema.default("variant"),
});

export const linkVariantToExperimentFn = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((input: unknown) => linkArmSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const result = await linkVariantToExperiment(await admin(), {
      userId,
      experimentId: data.experiment_id,
      thumbnailId: data.thumbnail_id,
      armName: data.arm_name,
      armType: data.arm_type,
    });
    // experiment_not_found is a normal UI outcome (stale experiment picker).
    return result;
  });

/** Honest image-provider state for the studio UI. */
export const thumbnailProviderStatus = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((input: unknown) => z.object({}).parse(input))
  .handler(async () => imageProviderStatus());
