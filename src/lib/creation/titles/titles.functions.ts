/**
 * Stream A — F14 Title Lab server functions.
 *
 * Stats discipline (pinned contract): TitleScore is a packaging-heuristic
 * assessment — the UI presents it as such, never as a CTR prediction.
 * `impressions`/`ctr` on `title_variants` are measured values only; this
 * module never writes them.
 *
 * Experiment linkage: `createTitleExperiment` creates the `experiments` row
 * (status 'draft') + one `experiment_arms` row per variant (arm_type
 * 'variant', even traffic split) and moves the variants draft→testing.
 * Phase 4 owns running/reading the experiment; this module only creates the
 * linkage and the 'testing' status flow.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "../../server-auth";
import type { Json } from "@/integrations/supabase/types";
import { adminDb, dbList, dbOne, type AdminDb } from "../../intelligence/youtube-api.server";
import { generateTitleVariants, scoreTitle } from "./titles";
import type { TitleScore } from "../contracts";

/* ------------------------------------------------------------------ */
/* Local table types (D89: `type` aliases, not interfaces)              */
/* ------------------------------------------------------------------ */

export type TitleVariantRow = {
  id: string;
  user_id: string;
  project_id: string;
  title: string;
  score: Json;
  impressions: number;
  ctr: number | null;
  status: "draft" | "testing" | "winner" | "retired";
  experiment_id: string | null;
  created_at: string;
  updated_at: string;
};

type ProjectRow = { id: string };

const VARIANT_COLUMNS =
  "id, user_id, project_id, title, score, impressions, ctr, status, experiment_id, created_at, updated_at";

async function getAdmin(): Promise<AdminDb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return adminDb(supabaseAdmin);
}

/* ------------------------------------------------------------------ */
/* Pure helpers (exported for unit tests)                              */
/* ------------------------------------------------------------------ */

export const TITLE_STATUSES = ["draft", "testing", "winner", "retired"] as const;
export type TitleVariantStatus = (typeof TITLE_STATUSES)[number];

/** Forward-only status flow for title variants. */
export const TITLE_STATUS_TRANSITIONS: Record<TitleVariantStatus, TitleVariantStatus[]> = {
  draft: ["testing", "retired"],
  testing: ["winner", "retired", "draft"],
  winner: ["retired"],
  retired: ["draft"],
};

export function assertTitleStatusTransition(from: string, to: string): void {
  const allowed = TITLE_STATUS_TRANSITIONS[from as TitleVariantStatus];
  if (!allowed || !(allowed as string[]).includes(to)) {
    throw new Error(`Illegal title-variant transition: ${from} → ${to}`);
  }
}

/** Even traffic split across n arms (rounded to 4dp, last arm takes the remainder). */
export function buildExperimentArmSplits(n: number): number[] {
  if (n <= 0) throw new Error("At least one variant is required for an experiment.");
  const even = Math.floor(10000 / n) / 10000;
  const splits = Array(n).fill(even) as number[];
  splits[n - 1] = Math.round((1 - even * (n - 1)) * 10000) / 10000;
  return splits;
}

/** Narrow a TitleScore to the jsonb payload stored on the row. */
export function titleScoreToJson(score: TitleScore): Json {
  return { ...score };
}

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

const projectIdSchema = z.object({ projectId: z.string().uuid() });

export const generateTitlesSchema = z.object({
  projectId: z.string().uuid(),
  topic: z.string().trim().min(1).max(200),
  keywords: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  maxVariants: z.number().int().min(1).max(12).default(10),
});

export const setVariantStatusSchema = z.object({
  variantId: z.string().uuid(),
  status: z.enum(TITLE_STATUSES),
});

export const createTitleExperimentSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  hypothesis: z.string().trim().max(1000).default(""),
  variantIds: z.array(z.string().uuid()).min(2).max(12),
});

async function ownProject(admin: AdminDb, userId: string, projectId: string): Promise<boolean> {
  const row = await dbOne<ProjectRow>(
    admin
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("user_id", userId)
      .maybeSingle<ProjectRow>(),
  );
  return row !== null;
}

async function ownVariant(
  admin: AdminDb,
  userId: string,
  variantId: string,
): Promise<TitleVariantRow | null> {
  return dbOne<TitleVariantRow>(
    admin
      .from("title_variants")
      .select(VARIANT_COLUMNS)
      .eq("id", variantId)
      .eq("user_id", userId)
      .maybeSingle<TitleVariantRow>(),
  );
}

/* ------------------------------------------------------------------ */
/* listTitleVariants                                                   */
/* ------------------------------------------------------------------ */

export const listTitleVariants = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => projectIdSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    if (!(await ownProject(admin, userId, data.projectId))) {
      throw new Error("Project not found.");
    }
    const variants = await dbList<TitleVariantRow>(
      admin
        .from("title_variants")
        .select(VARIANT_COLUMNS)
        .eq("user_id", userId)
        .eq("project_id", data.projectId)
        .order("created_at", { ascending: true }),
    );
    return { status: "ok" as const, variants };
  });

/* ------------------------------------------------------------------ */
/* generateAndSaveTitleVariants (deterministic, no LLM)                */
/* ------------------------------------------------------------------ */

export const generateAndSaveTitleVariants = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => generateTitlesSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    if (!(await ownProject(admin, userId, data.projectId))) {
      throw new Error("Project not found.");
    }
    const titles = generateTitleVariants({
      topic: data.topic,
      keywords: data.keywords,
      maxVariants: data.maxVariants,
    });
    const rows = titles.map((title) => ({
      user_id: userId,
      project_id: data.projectId,
      title,
      score: titleScoreToJson(scoreTitle({ title, keywords: data.keywords })),
      status: "draft" as const,
    }));
    const saved = await dbList<TitleVariantRow>(
      admin.from("title_variants").insert(rows).select(VARIANT_COLUMNS),
    );
    return { status: "ok" as const, variants: saved };
  });

/* ------------------------------------------------------------------ */
/* setTitleVariantStatus                                               */
/* ------------------------------------------------------------------ */

export const setTitleVariantStatus = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => setVariantStatusSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    const variant = await ownVariant(admin, userId, data.variantId);
    if (!variant) throw new Error("Title variant not found.");
    assertTitleStatusTransition(variant.status, data.status);
    if (data.status === "winner") {
      // Only one winner per project: retire any existing winners first.
      await dbList(
        admin
          .from("title_variants")
          .update({ status: "retired", updated_at: new Date().toISOString() })
          .eq("user_id", userId)
          .eq("project_id", variant.project_id)
          .eq("status", "winner")
          .neq("id", variant.id)
          .select("id"),
      );
    }
    const updated = await dbOne<TitleVariantRow>(
      admin
        .from("title_variants")
        .update({ status: data.status, updated_at: new Date().toISOString() })
        .eq("id", variant.id)
        .eq("user_id", userId)
        .select(VARIANT_COLUMNS)
        .single<TitleVariantRow>(),
    );
    if (!updated) throw new Error("Failed to update title variant.");
    return { status: "ok" as const, variant: updated };
  });

/* ------------------------------------------------------------------ */
/* createTitleExperiment — linkage only; Phase 4 runs it               */
/* ------------------------------------------------------------------ */

export const createTitleExperiment = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => createTitleExperimentSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    if (!(await ownProject(admin, userId, data.projectId))) {
      throw new Error("Project not found.");
    }
    const variants = await dbList<TitleVariantRow>(
      admin
        .from("title_variants")
        .select(VARIANT_COLUMNS)
        .eq("user_id", userId)
        .eq("project_id", data.projectId)
        .in("id", data.variantIds),
    );
    if (variants.length !== data.variantIds.length) {
      throw new Error("One or more variants were not found in this project.");
    }
    for (const v of variants) {
      if (v.status !== "draft") {
        throw new Error(
          `Variant "${v.title.slice(0, 40)}" is ${v.status} — only draft variants can enter an experiment.`,
        );
      }
    }
    const experiment = await dbOne<{ id: string }>(
      admin
        .from("experiments")
        .insert({
          user_id: userId,
          project_id: data.projectId,
          name: data.name,
          hypothesis: data.hypothesis,
          status: "draft",
          primary_metric: "ctr",
        })
        .select("id")
        .single<{ id: string }>(),
    );
    if (!experiment) throw new Error("Failed to create experiment.");
    const splits = buildExperimentArmSplits(variants.length);
    const arms = variants.map((v, i) => ({
      experiment_id: experiment.id,
      name: `Arm ${i + 1}`,
      arm_type: "variant",
      title_variant_id: v.id,
      traffic_split: splits[i],
      metrics: {},
    }));
    await dbList(admin.from("experiment_arms").insert(arms).select("id"));
    // Move the variants into the testing flow and link the experiment.
    await dbList(
      admin
        .from("title_variants")
        .update({
          status: "testing",
          experiment_id: experiment.id,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .in("id", data.variantIds)
        .select("id"),
    );
    return { status: "ok" as const, experimentId: experiment.id };
  });
