/**
 * F26 — SEO & Metadata Studio: server functions.
 *
 * Title work reuses Stream A's deterministic `generateTitleVariants` /
 * `scoreTitle` (stats-disciplined, no CTR-prediction claims). Description,
 * hashtags, and thumbnail concepts come from the deterministic template
 * builder in `./seo` — no LLM, no credits, no fake provider calls.
 *
 * Brand voice (F13 `resolveBrandProfileForUser`) supplies the description
 * sign-off when the user has a brand profile; the UI asks when ambiguous
 * (never guessed).
 *
 * Strict gate (Stream B, D105): `exportSeoPackage` — the package
 * publish/export action — imports `getProjectStrictGate` and STOPS when
 * `blocked === true`. Only a human CONFIRM in the Evidence Desk unblocks;
 * waived still blocks strict mode.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "../../server-auth";
import { adminDb, dbList, dbOne, type AdminDb } from "../../intelligence/youtube-api.server";
import { buildSeoPackage, type SeoPackage } from "./seo";
import { titleScoreToJson } from "../titles/titles.functions";
import { resolveBrandProfileForUser } from "../brand/brand.functions";
import { getProjectStrictGate } from "../claims/strict-gate";

async function getAdmin(): Promise<AdminDb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return adminDb(supabaseAdmin);
}

export type SeoPackageRow = {
  id: string;
  user_id: string;
  project_id: string;
  chosen_title: string;
  title_options: SeoPackage["titleOptions"];
  description: string;
  hashtags: string[];
  thumbnail_concepts: SeoPackage["thumbnailConcepts"];
  exported_at: string | null;
  created_at: string;
};

const PACKAGE_COLUMNS =
  "id, user_id, project_id, chosen_title, title_options, description, hashtags, thumbnail_concepts, exported_at, created_at";

async function ownProject(admin: AdminDb, userId: string, projectId: string): Promise<void> {
  const project = await dbOne<{ id: string }>(
    admin
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("user_id", userId)
      .single<{ id: string }>(),
  );
  if (!project) throw new Error("Project not found.");
}

export const generateSeoPackageSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  topic: z.string().trim().min(1).max(200).optional(),
  facts: z.array(z.string().trim().min(1).max(600)).max(8).default([]),
  sourceUrls: z.array(z.string().trim().max(2000)).max(8).default([]),
  brandName: z.string().trim().max(120).optional(),
  maxHashtags: z.number().int().min(1).max(30).default(12),
});

/**
 * Build + persist an SEO package. Pure generation (no provider calls);
 * also persists the scored title variants to `title_variants` via the
 * same deterministic Stream A path as `generateAndSaveTitleVariants`.
 */
export const generateSeoPackage = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => generateSeoPackageSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    await ownProject(admin, userId, data.projectId);

    const project = await dbOne<{ topic: string | null; title: string | null }>(
      admin
        .from("projects")
        .select("topic, title")
        .eq("id", data.projectId)
        .single<{ topic: string | null; title: string | null }>(),
    );
    const topic = data.topic ?? project?.topic ?? project?.title ?? "Untitled video";

    // F13: brand sign-off from the resolved brand profile (never guessed).
    let brandName = data.brandName;
    if (!brandName) {
      try {
        const brand = await resolveBrandProfileForUser(admin, userId);
        brandName = brand?.name ?? undefined;
      } catch {
        brandName = undefined;
      }
    }

    const pkg = buildSeoPackage({
      topic,
      title: data.title ?? topic,
      facts: data.facts,
      brandName,
      sourceUrls: data.sourceUrls,
      maxHashtags: data.maxHashtags,
    });

    // Persist scored title variants (same row shape as generateAndSaveTitleVariants).
    await dbList(
      admin
        .from("title_variants")
        .insert(
          pkg.titleOptions.map((t) => ({
            user_id: userId,
            project_id: data.projectId,
            title: t.title,
            score: titleScoreToJson(t.score),
            status: "draft" as const,
          })),
        )
        .select("id"),
    );

    const saved = await dbOne<SeoPackageRow>(
      admin
        .from("seo_packages")
        .insert({
          user_id: userId,
          project_id: data.projectId,
          chosen_title: pkg.chosenTitle,
          title_options: pkg.titleOptions,
          description: pkg.description,
          hashtags: pkg.hashtags,
          thumbnail_concepts: pkg.thumbnailConcepts,
        })
        .select(PACKAGE_COLUMNS)
        .single<SeoPackageRow>(),
    );
    if (!saved) throw new Error("Could not save the SEO package.");
    return { status: "ok" as const, package: saved, generated: pkg };
  });

export const getSeoPackage = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ projectId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    await ownProject(admin, userId, data.projectId);
    const pkg = await dbOne<SeoPackageRow>(
      admin
        .from("seo_packages")
        .select(PACKAGE_COLUMNS)
        .eq("project_id", data.projectId)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single<SeoPackageRow>(),
    );
    return { status: "ok" as const, package: pkg };
  });

/**
 * Export (publish-ready handoff) of an SEO package. STOPS when the strict
 * gate is blocked — only human CONFIRM unblocks (D105: waived still blocks).
 */
export const exportSeoPackage = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ packageId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    const pkg = await dbOne<SeoPackageRow>(
      admin
        .from("seo_packages")
        .select(PACKAGE_COLUMNS)
        .eq("id", data.packageId)
        .eq("user_id", userId)
        .single<SeoPackageRow>(),
    );
    if (!pkg) throw new Error("SEO package not found.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const gate = await getProjectStrictGate(supabaseAdmin, userId, pkg.project_id);
    if (gate.blocked) {
      return {
        status: "blocked" as const,
        message: gate.message,
        unconfirmedCount: gate.unconfirmedCount,
      };
    }
    const exported = await dbOne<SeoPackageRow>(
      admin
        .from("seo_packages")
        .update({ exported_at: new Date().toISOString() })
        .eq("id", pkg.id)
        .select(PACKAGE_COLUMNS)
        .single<SeoPackageRow>(),
    );
    return { status: "ok" as const, package: exported };
  });

/** List the caller's projects for the SEO studio project picker. */
export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    const rows = await dbList<{ id: string; name: string }>(
      admin
        .from("projects")
        .select("id, name")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50),
    );
    return { projects: rows };
  });
