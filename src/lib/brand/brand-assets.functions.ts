/**
 * Phase 4 Stream E (F39) — Brand Library server functions.
 *
 * Workspace-scoped asset library (logos, font files, intro/outro clips)
 * backed by the `brand_assets` table + the private `brand-library` storage
 * bucket. Members read; owners/editors manage (mirrors brand_kits rules).
 *
 * Brand assets are deliberately NOT content_assets rows: content_assets is
 * user-scoped and requires a content_item (research pipeline), while brand
 * assets are workspace-shared brand identity items independent of any
 * content item (D158).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requireAppUser } from "../server-auth";
import { auditApiCall } from "../api-keys/keys.server";
import { canEditWorkspace, canReadWorkspace, type WorkspaceRole } from "../agency/agency";
import { getWorkspaceRole } from "../agency/agency.functions";
import { str, strOrNull, untypedAdminDb, type UntypedDb } from "../supabase/untyped";

export const BRAND_ASSET_KINDS = ["logo", "font", "intro", "outro"] as const;
export type BrandAssetKind = (typeof BRAND_ASSET_KINDS)[number];

const KIND_LIMITS: Record<
  BrandAssetKind,
  { mimes: readonly string[]; maxBytes: number; label: string }
> = {
  logo: {
    mimes: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"],
    maxBytes: 5 * 1024 * 1024,
    label: "Logo",
  },
  font: {
    mimes: ["font/woff", "font/woff2", "font/ttf", "font/otf", "application/font-sfnt"],
    maxBytes: 5 * 1024 * 1024,
    label: "Font",
  },
  intro: {
    mimes: ["video/mp4", "video/webm", "video/quicktime"],
    maxBytes: 50 * 1024 * 1024,
    label: "Intro clip",
  },
  outro: {
    mimes: ["video/mp4", "video/webm", "video/quicktime"],
    maxBytes: 50 * 1024 * 1024,
    label: "Outro clip",
  },
};

export interface BrandAsset {
  id: string;
  workspace_id: string;
  name: string;
  kind: BrandAssetKind;
  storage_path: string;
  content_type: string | null;
  bytes: number | null;
  is_default: boolean;
  created_at: string;
  preview_url: string | null;
}

type AdminClient = import("@supabase/supabase-js").SupabaseClient<
  import("@/integrations/supabase/types").Database
>;

async function admin(): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as AdminClient;
}

/** Untyped service-role client for tables missing from the generated types. */
async function udb(): Promise<UntypedDb> {
  return untypedAdminDb();
}

async function requireRole(
  workspaceId: string,
  userId: string,
  allowed: (role: WorkspaceRole | null) => boolean,
  action: string,
) {
  const role = await getWorkspaceRole(await admin(), workspaceId, userId);
  if (role === null) throw new Error("Workspace not found");
  if (!allowed(role)) throw new Error(`Your role (${role}) cannot ${action}.`);
}

async function rateLimit(
  userId: string,
  key: string,
  max: number,
  windowSeconds: number,
  message: string,
) {
  const { enforcePostgresRateLimit } = await import("../rate-limit");
  await enforcePostgresRateLimit(
    await admin(),
    `${key}:${userId}`,
    { max, windowSeconds },
    message,
  );
}

async function auditBrandAction(
  workspaceId: string,
  actorUserId: string,
  action: string,
  assetId: string | null,
  metadata?: Record<string, unknown>,
) {
  await auditApiCall(
    {
      workspaceId,
      actorUserId,
      action,
      entityType: "brand_asset",
      entityId: assetId,
      metadata: { via: "settings-ui", ...(metadata ?? {}) },
    },
    undefined,
  );
}

const workspaceSchema = z.object({ workspaceId: z.string().uuid() });

/** List the workspace's brand assets with short-lived preview URLs. */
export const listBrandAssetsFn = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => workspaceSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ assets: BrandAsset[] }> => {
    const { userId } = context;
    await requireRole(data.workspaceId, userId, canReadWorkspace, "view the brand library");
    const db = await udb();
    const { data: rows, error } = await db
      .from("brand_assets")
      .select(
        "id, workspace_id, name, kind, storage_path, content_type, bytes, is_default, created_at",
      )
      .eq("workspace_id", data.workspaceId)
      .order("kind", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const assets: BrandAsset[] = [];
    for (const row of rows ?? []) {
      const storagePath = str(row, "storage_path");
      const { data: signed } = await db.storage
        .from("brand-library")
        .createSignedUrl(storagePath, 3600);
      const kind = str(row, "kind");
      assets.push({
        id: str(row, "id"),
        workspace_id: str(row, "workspace_id"),
        name: str(row, "name"),
        kind: (BRAND_ASSET_KINDS as readonly string[]).includes(kind)
          ? (kind as BrandAssetKind)
          : "logo",
        storage_path: storagePath,
        content_type: strOrNull(row, "content_type"),
        bytes: typeof row["bytes"] === "number" ? row["bytes"] : null,
        is_default: row["is_default"] === true,
        created_at: str(row, "created_at"),
        preview_url: signed?.signedUrl ?? null,
      });
    }
    return { assets };
  });

const uploadSchema = z.object({
  workspaceId: z.string().uuid(),
  kind: z.enum(BRAND_ASSET_KINDS),
  name: z.string().trim().min(1).max(120),
  fileBase64: z.string().min(1).max(70_000_000),
  contentType: z.string().min(1).max(120),
});

/** Upload a brand asset — owners/editors only. MIME + size validated per kind. */
export const uploadBrandAssetFn = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => uploadSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await requireRole(data.workspaceId, userId, canEditWorkspace, "edit the brand library");
    await rateLimit(userId, "brand:upload", 30, 3600, "You're uploading brand assets too fast.");

    const limits = KIND_LIMITS[data.kind];
    if (!limits.mimes.includes(data.contentType)) {
      throw new Error(
        `${limits.label} must be one of: ${limits.mimes.join(", ")} (got ${data.contentType})`,
      );
    }
    const bytes = Buffer.from(data.fileBase64, "base64");
    if (bytes.length === 0 || bytes.length > limits.maxBytes) {
      throw new Error(
        `${limits.label} must be a non-empty file under ${Math.round(limits.maxBytes / 1024 / 1024)} MB.`,
      );
    }

    const db = await udb();
    const ext = (data.contentType.split("/")[1] ?? "bin").replace(/[^a-z0-9+.-]/gi, "");
    const path = `${data.workspaceId}/${data.kind}/${randomUUID()}.${ext}`;
    const { error: uploadError } = await db.storage
      .from("brand-library")
      .upload(path, bytes, { contentType: data.contentType, upsert: false });
    if (uploadError) throw new Error(uploadError.message);

    const { data: row, error: insertError } = await db
      .from("brand_assets")
      .insert({
        workspace_id: data.workspaceId,
        name: data.name,
        kind: data.kind,
        storage_path: path,
        content_type: data.contentType,
        bytes: bytes.length,
        created_by: userId,
      })
      .select("id")
      .single();
    if (insertError || !row) {
      // Roll back the uploaded object so we never orphan storage.
      await db.storage.from("brand-library").remove([path]);
      throw new Error(insertError?.message ?? "Could not save the brand asset.");
    }
    const assetId = str(row, "id");
    await auditBrandAction(data.workspaceId, userId, "brand.assets.uploaded", assetId, {
      kind: data.kind,
      name: data.name,
    });
    return { assetId };
  });

const assetTargetSchema = z.object({ workspaceId: z.string().uuid(), assetId: z.string().uuid() });

/** Delete a brand asset (row + storage object) — owners/editors only. */
export const deleteBrandAssetFn = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => assetTargetSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await requireRole(data.workspaceId, userId, canEditWorkspace, "edit the brand library");
    await rateLimit(userId, "brand:delete", 60, 3600, "You're deleting brand assets too fast.");

    const db = await udb();
    const { data: row, error: fetchError } = await db
      .from("brand_assets")
      .select("id, storage_path, name, kind")
      .eq("id", data.assetId)
      .eq("workspace_id", data.workspaceId)
      .single();
    if (fetchError || !row) throw new Error("Brand asset not found in this workspace.");

    const { error: deleteError } = await db.from("brand_assets").delete().eq("id", data.assetId);
    if (deleteError) throw new Error(deleteError.message);
    // Best-effort storage cleanup (row is the source of truth).
    await db.storage.from("brand-library").remove([str(row, "storage_path")]);

    await auditBrandAction(data.workspaceId, userId, "brand.assets.deleted", data.assetId, {
      kind: strOrNull(row, "kind"),
      name: strOrNull(row, "name"),
    });
    return { ok: true };
  });

/**
 * Set the default asset for its kind (the "selected" logo/intro/outro/font).
 * Clears the previous default of the same kind — the partial unique index
 * enforces at most one.
 */
export const setDefaultBrandAssetFn = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => assetTargetSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await requireRole(data.workspaceId, userId, canEditWorkspace, "edit the brand library");

    const db = await udb();
    const { data: row, error: fetchError } = await db
      .from("brand_assets")
      .select("id, kind, name")
      .eq("id", data.assetId)
      .eq("workspace_id", data.workspaceId)
      .single();
    if (fetchError || !row) throw new Error("Brand asset not found in this workspace.");

    const kind = str(row, "kind");
    const { error: clearError } = await db
      .from("brand_assets")
      .update({ is_default: false })
      .eq("workspace_id", data.workspaceId)
      .eq("kind", kind)
      .eq("is_default", true);
    if (clearError) throw new Error(clearError.message);

    const { error: setError } = await db
      .from("brand_assets")
      .update({ is_default: true })
      .eq("id", data.assetId);
    if (setError) throw new Error(setError.message);

    await auditBrandAction(data.workspaceId, userId, "brand.assets.default_set", data.assetId, {
      kind,
      name: strOrNull(row, "name"),
    });
    return { ok: true };
  });
