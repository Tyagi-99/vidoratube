/**
 * Stream A — F13 Brand Voice: CRUD server functions for `brand_profiles`.
 *
 * The table is READ by Stream B's script studio for generation binding —
 * its columns are not changed here. This module additionally exports
 * `resolveBrandProfileForUser`, the binding helper Stream B calls to pick
 * the profile for a script generation request:
 *   - explicit `requestedId` (must be owned by the user) wins;
 *   - otherwise the user's single profile is used when exactly one exists;
 *   - otherwise null (UI must ask the user to pick — never guess).
 *
 * Owner-scoped via `user_id`; an optional `workspaceId` on create is
 * verified against workspace membership (`getWorkspaceRole`) so a profile
 * can be shared into a workspace context without widening access.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "../../server-auth";
import type { Json } from "@/integrations/supabase/types";
import { adminDb, dbList, dbOne, type AdminDb } from "../../intelligence/youtube-api.server";
import { getWorkspaceRole } from "../../workspace-auth.server";

/* ------------------------------------------------------------------ */
/* Local table types (D89: `type` aliases, not interfaces)              */
/* ------------------------------------------------------------------ */

export type BrandProfileRow = {
  id: string;
  user_id: string;
  workspace_id: string | null;
  name: string;
  tone: string;
  vocabulary: Json;
  persona: string;
  do_list: string[];
  dont_list: string[];
  sample_text: string;
  created_at: string;
  updated_at: string;
};

const PROFILE_COLUMNS =
  "id, user_id, workspace_id, name, tone, vocabulary, persona, do_list, dont_list, sample_text, created_at, updated_at";

async function getAdmin(): Promise<AdminDb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return adminDb(supabaseAdmin);
}

/* ------------------------------------------------------------------ */
/* Pure helpers (exported for unit tests + Stream B)                   */
/* ------------------------------------------------------------------ */

const stringList = z.array(z.string().trim().min(1).max(200)).max(50).default([]);

/** JSON value schema for the vocabulary jsonb column (serializable). */
const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonSchema),
    z.record(z.string(), jsonSchema),
  ]),
);

export const vocabularySchema = z.record(z.string(), jsonSchema).default({});

/**
 * Normalize UI vocabulary input ({ preferred: string, avoid: string } as
 * comma-separated strings or arrays) into the jsonb shape. Pure.
 */
export function normalizeVocabulary(input: {
  preferred?: string | string[];
  avoid?: string | string[];
  extra?: Record<string, Json>;
}): Record<string, Json> {
  const toList = (v: string | string[] | undefined): string[] => {
    if (Array.isArray(v)) return v.map((s) => s.trim()).filter(Boolean);
    if (typeof v === "string")
      return v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    return [];
  };
  return {
    preferred: toList(input.preferred),
    avoid: toList(input.avoid),
    ...(input.extra ?? {}),
  };
}

export const createBrandProfileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  tone: z.string().trim().max(500).default(""),
  vocabulary: vocabularySchema,
  persona: z.string().trim().max(1000).default(""),
  doList: stringList,
  dontList: stringList,
  sampleText: z.string().trim().max(5000).default(""),
  workspaceId: z.string().uuid().optional(),
});

export const updateBrandProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  tone: z.string().trim().max(500).optional(),
  vocabulary: vocabularySchema.optional(),
  persona: z.string().trim().max(1000).optional(),
  doList: stringList.optional(),
  dontList: stringList.optional(),
  sampleText: z.string().trim().max(5000).optional(),
});

const profileIdSchema = z.object({ id: z.string().uuid() });

/**
 * Binding helper for Stream B's script studio: resolve which brand profile
 * applies to a generation request. Never invents a profile — returns null
 * when the choice is ambiguous so the caller surfaces a picker.
 */
export async function resolveBrandProfileForUser(
  admin: AdminDb,
  userId: string,
  requestedId?: string,
): Promise<BrandProfileRow | null> {
  const profiles = await dbList<BrandProfileRow>(
    admin.from("brand_profiles").select(PROFILE_COLUMNS).eq("user_id", userId).limit(10),
  );
  if (requestedId) {
    return profiles.find((p) => p.id === requestedId) ?? null;
  }
  if (profiles.length === 1) return profiles[0]!;
  return null;
}

async function ownProfile(
  admin: AdminDb,
  userId: string,
  id: string,
): Promise<BrandProfileRow | null> {
  return dbOne<BrandProfileRow>(
    admin
      .from("brand_profiles")
      .select(PROFILE_COLUMNS)
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle<BrandProfileRow>(),
  );
}

/* ------------------------------------------------------------------ */
/* CRUD                                                                */
/* ------------------------------------------------------------------ */

export const listBrandProfiles = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({}).parse(i))
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    const profiles = await dbList<BrandProfileRow>(
      admin
        .from("brand_profiles")
        .select(PROFILE_COLUMNS)
        .eq("user_id", userId)
        .order("updated_at", { ascending: false }),
    );
    return { status: "ok" as const, profiles };
  });

export const getBrandProfile = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => profileIdSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    const profile = await ownProfile(admin, userId, data.id);
    if (!profile) throw new Error("Brand profile not found.");
    return { status: "ok" as const, profile };
  });

export const createBrandProfile = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => createBrandProfileSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    let workspaceId: string | null = null;
    if (data.workspaceId) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const role = await getWorkspaceRole(supabaseAdmin, data.workspaceId, userId);
      if (!role) throw new Error("Not a member of that workspace.");
      workspaceId = data.workspaceId;
    }
    const profile = await dbOne<BrandProfileRow>(
      admin
        .from("brand_profiles")
        .insert({
          user_id: userId,
          workspace_id: workspaceId,
          name: data.name,
          tone: data.tone,
          vocabulary: data.vocabulary,
          persona: data.persona,
          do_list: data.doList,
          dont_list: data.dontList,
          sample_text: data.sampleText,
        })
        .select(PROFILE_COLUMNS)
        .single<BrandProfileRow>(),
    );
    if (!profile) throw new Error("Failed to create brand profile.");
    return { status: "ok" as const, profile };
  });

export const updateBrandProfile = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => updateBrandProfileSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    const existing = await ownProfile(admin, userId, data.id);
    if (!existing) throw new Error("Brand profile not found.");
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.name !== undefined) patch["name"] = data.name;
    if (data.tone !== undefined) patch["tone"] = data.tone;
    if (data.vocabulary !== undefined) patch["vocabulary"] = data.vocabulary;
    if (data.persona !== undefined) patch["persona"] = data.persona;
    if (data.doList !== undefined) patch["do_list"] = data.doList;
    if (data.dontList !== undefined) patch["dont_list"] = data.dontList;
    if (data.sampleText !== undefined) patch["sample_text"] = data.sampleText;
    const profile = await dbOne<BrandProfileRow>(
      admin
        .from("brand_profiles")
        .update(patch)
        .eq("id", data.id)
        .eq("user_id", userId)
        .select(PROFILE_COLUMNS)
        .single<BrandProfileRow>(),
    );
    if (!profile) throw new Error("Failed to update brand profile.");
    return { status: "ok" as const, profile };
  });

export const deleteBrandProfile = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => profileIdSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    const existing = await ownProfile(admin, userId, data.id);
    if (!existing) throw new Error("Brand profile not found.");
    const del = (await admin
      .from("brand_profiles")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId)) as unknown as { error: { message: string } | null };
    if (del.error) throw new Error(del.error.message);
    // scripts.brand_profile_id is ON DELETE SET NULL — linked scripts keep
    // working, they just lose the voice binding (surfaced in Script Studio).
    return { status: "ok" as const, deletedId: data.id };
  });
