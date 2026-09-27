/**
 * F34 — Packaging Experiments server functions (TanStack Start).
 *
 * Thin wrappers over the pure domain logic in experiments.server.ts.
 * Every handler:
 *   - requires an authenticated app user (requireAppUser),
 *   - scopes all reads/writes with an explicit user_id guard (service-role
 *     client, defense in depth alongside RLS),
 *   - never applies a winner automatically — applyWinner is a separate
 *     human-only action (D139).
 */
import { createServerFn } from "@tanstack/react-start";
import type { Json } from "@/integrations/supabase/types";
import { z } from "zod";
import { requireAppUser } from "../server-auth";
import {
  buildApplyWinnerPlan,
  concludeExperimentLifecycle,
  createMemoryExperimentStore,
  evaluateConclusion,
  pauseExperimentLifecycle,
  recordMetricsLifecycle,
  startExperimentLifecycle,
  validateArms,
  validateCreateExperiment,
  ExperimentNotReadyError,
  ExperimentValidationError,
  PRIMARY_METRICS,
  type ArmMetrics,
  type ArmRow,
  type ConclusionEvaluation,
  type ConclusionShape,
  type ExperimentLearningDraft,
  type ExperimentRow,
  type ExperimentStore,
} from "./experiments.server";

/* ------------------------------------------------------------------ */
/* Supabase-backed store (service role + explicit user_id guards)      */
/* ------------------------------------------------------------------ */

// The generated Database type is stale for Phase 4 tables (it has no
// `experiments` table at all), so the admin client cannot be typed through
// it. Explicit user_id guards on every query carry the ownership check
// instead of relying on RLS alone.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

/** One raw row from a select on a Phase 4 table (untyped: see AdminClient). */
type RawRow = { [key: string]: unknown };

function toExperimentRow(data: RawRow): ExperimentRow {
  return {
    id: data["id"] as string,
    user_id: data["user_id"] as string,
    project_id: (data["project_id"] as string | null) ?? null,
    name: data["name"] as string,
    hypothesis: (data["hypothesis"] as string) ?? "",
    status: data["status"] as ExperimentRow["status"],
    primary_metric: data["primary_metric"] as ExperimentRow["primary_metric"],
    min_sample_size: Number(data["min_sample_size"] ?? 100),
    min_duration_hours: Number(data["min_duration_hours"] ?? 24),
    started_at: (data["started_at"] as string | null) ?? null,
    ended_at: (data["ended_at"] as string | null) ?? null,
    conclusion: (data["conclusion"] ?? {}) as Record<string, Json>,
    created_at: data["created_at"] as string,
    updated_at: data["updated_at"] as string,
  };
}

function toArmRow(data: RawRow): ArmRow {
  return {
    id: data["id"] as string,
    experiment_id: data["experiment_id"] as string,
    name: data["name"] as string,
    arm_type: data["arm_type"] as ArmRow["arm_type"],
    title_variant_id: (data["title_variant_id"] as string | null) ?? null,
    thumbnail_id: (data["thumbnail_id"] as string | null) ?? null,
    traffic_split: Number(data["traffic_split"] ?? 0),
    metrics: (data["metrics"] ?? {}) as ArmMetrics,
    created_at: data["created_at"] as string,
  };
}

function supabaseExperimentStore(admin: AdminClient, userId: string): ExperimentStore {
  return {
    async getExperiment(experimentId: string) {
      const { data, error } = await admin
        .from("experiments")
        .select("*")
        .eq("id", experimentId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? toExperimentRow(data) : null;
    },
    async listArms(experimentId: string) {
      // Ownership is enforced through the parent experiment row.
      const exp = await this.getExperiment(experimentId);
      if (!exp) return [];
      const { data, error } = await admin
        .from("experiment_arms")
        .select("*")
        .eq("experiment_id", experimentId)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []).map(toArmRow);
    },
    async patchExperiment(experimentId: string, patch) {
      const { data, error } = await admin
        .from("experiments")
        .update(patch)
        .eq("id", experimentId)
        .eq("user_id", userId)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return toExperimentRow(data);
    },
    async mergeArmMetrics(armId: string, metrics: ArmMetrics) {
      const { data: arm, error: armError } = await admin
        .from("experiment_arms")
        .select("id, experiment_id, metrics")
        .eq("id", armId)
        .single();
      if (armError) throw new Error(armError.message);
      // Verify ownership via the parent experiment.
      const exp = await this.getExperiment(arm.experiment_id);
      if (!exp) {
        throw new ExperimentValidationError("Arm not found or not owned.");
      }
      const merged = { ...(arm.metrics ?? {}), ...metrics };
      const { data, error } = await admin
        .from("experiment_arms")
        .update({ metrics: merged, updated_at: new Date().toISOString() })
        .eq("id", armId)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return toArmRow(data);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

async function getStore(userId: string): Promise<ExperimentStore> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseExperimentStore(supabaseAdmin as AdminClient, userId);
}

async function writeExperimentNotification(
  admin: AdminClient,
  userId: string,
  experiment: ExperimentRow,
  conclusion: { verdict: string; winner_arm_id: string | null },
): Promise<void> {
  // Best-effort: a failed notification must never break the conclusion.
  try {
    const { error } = await admin.from("notifications").insert({
      user_id: userId,
      type: "experiment.concluded",
      title:
        conclusion.verdict === "winner"
          ? `Experiment concluded: winner found`
          : `Experiment concluded: inconclusive`,
      body: `"${experiment.name}" ${conclusion.verdict === "winner" ? "found a winning variant." : "found no significant winner."} Review before applying anything — winners are never auto-applied.`,
      link: `/experiments/${experiment.id}`,
    });
    if (error) throw new Error(error.message);
  } catch (e) {
    console.error("[experiments] notification write failed", e);
  }
}

async function insertLearningDraft(
  admin: AdminClient,
  userId: string,
  draft: {
    kind: string;
    topic: string;
    statement: string;
    payload: Record<string, Json>;
    evidence: Record<string, Json>;
    confidence: number;
    source: string;
    status: string;
    experiment_id: string;
  },
): Promise<void> {
  try {
    const { error } = await admin.from("learning_insights").insert({
      user_id: userId,
      kind: draft.kind,
      topic: draft.topic,
      payload: { ...draft.payload, statement: draft.statement },
      evidence: draft.evidence,
      confidence: draft.confidence,
      source: draft.source,
      status: draft.status,
      experiment_id: draft.experiment_id,
    });
    if (error) throw new Error(error.message);
  } catch (e) {
    console.error("[experiments] learning draft insert failed", e);
  }
}

async function finalizeConclusion(
  admin: AdminClient,
  userId: string,
  outcome: {
    experiment: ExperimentRow;
    conclusion: ConclusionShape;
    learningDraft: ExperimentLearningDraft;
  },
): Promise<void> {
  await writeExperimentNotification(admin, userId, outcome.experiment, {
    verdict: outcome.conclusion.verdict,
    winner_arm_id: outcome.conclusion.winner_arm_id,
  });
  await insertLearningDraft(admin, userId, outcome.learningDraft);
}

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

const uuid = z.string().uuid();

const armInputSchema = z.object({
  name: z.string().min(1).max(80),
  arm_type: z.enum(["control", "variant"]),
  title_variant_id: uuid.nullable().optional(),
  thumbnail_id: uuid.nullable().optional(),
  traffic_split: z.number().min(0).max(1),
});

const createExperimentSchema = z.object({
  name: z.string().min(1).max(120),
  hypothesis: z.string().max(2000).optional().default(""),
  project_id: uuid.nullable().optional(),
  primary_metric: z.enum(PRIMARY_METRICS).optional(),
  min_sample_size: z.number().int().min(100).optional(),
  min_duration_hours: z.number().min(1).optional(),
  arms: z.array(armInputSchema).min(2).max(10),
});

const metricsSchema = z
  .object({
    impressions: z.number().int().min(0).optional(),
    clicks: z.number().int().min(0).optional(),
    n: z.number().int().min(0).optional(),
    mean: z.number().finite().optional(),
    variance: z.number().min(0).finite().optional(),
    std: z.number().min(0).finite().optional(),
  })
  .strict();

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

export const listExperiments = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        status: z.enum(["draft", "running", "completed", "archived"]).optional(),
        limit: z.number().int().min(1).max(100).default(50),
      })
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }): Promise<ExperimentRow[]> => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as AdminClient;
    let q = admin
      .from("experiments")
      .select(
        "id,name,hypothesis,status,primary_metric,min_sample_size,min_duration_hours,started_at,ended_at,conclusion,project_id,created_at,updated_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []).map(toExperimentRow);
  });

export interface ExperimentDetail {
  experiment: ExperimentRow;
  arms: ArmRow[];
  /** Live stats: gates, per-arm p-values, "not yet significant" states. */
  evaluation: ConclusionEvaluation;
}

export const getExperiment = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ id: uuid }).parse(i))
  .handler(async ({ data, context }): Promise<ExperimentDetail> => {
    const { userId } = context;
    const store = await getStore(userId);
    const experiment = await store.getExperiment(data.id);
    if (!experiment) throw new Error("Experiment not found.");
    const arms = await store.listArms(data.id);
    const evaluation = evaluateConclusion(experiment, arms, new Date(), "human");
    return { experiment, arms, evaluation };
  });

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

export const createExperiment = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => createExperimentSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const v = validateCreateExperiment(data);
    validateArms(
      data.arms.map((a) => ({
        name: a.name,
        arm_type: a.arm_type,
        title_variant_id: a.title_variant_id ?? null,
        thumbnail_id: a.thumbnail_id ?? null,
        traffic_split: a.traffic_split,
      })),
    );
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as AdminClient;
    const { data: expRow, error: expError } = await admin
      .from("experiments")
      .insert({
        user_id: userId,
        project_id: v.project_id,
        name: v.name,
        hypothesis: v.hypothesis,
        status: "draft",
        primary_metric: v.primary_metric,
        min_sample_size: v.min_sample_size,
        min_duration_hours: v.min_duration_hours,
        conclusion: {},
      })
      .select("*")
      .single();
    if (expError) throw new Error(expError.message);

    const { data: armRows, error: armError } = await admin
      .from("experiment_arms")
      .insert(
        data.arms.map((a) => ({
          experiment_id: expRow.id,
          name: a.name,
          arm_type: a.arm_type,
          title_variant_id: a.title_variant_id ?? null,
          thumbnail_id: a.thumbnail_id ?? null,
          traffic_split: a.traffic_split,
          metrics: {},
        })),
      )
      .select("*");
    if (armError) {
      // Roll back the experiment row so no armless experiment lingers.
      await admin.from("experiments").delete().eq("id", expRow.id);
      throw new Error(armError.message);
    }
    return {
      experiment: toExperimentRow(expRow),
      arms: (armRows ?? []).map(toArmRow),
    };
  });

export const addExperimentArm = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ experiment_id: uuid, arm: armInputSchema }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const store = await getStore(userId);
    const experiment = await store.getExperiment(data.experiment_id);
    if (!experiment) throw new Error("Experiment not found.");
    if (experiment.status !== "draft") {
      throw new ExperimentValidationError("Arms can only be added to draft experiments.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as AdminClient;
    const { data: row, error } = await admin
      .from("experiment_arms")
      .insert({
        experiment_id: data.experiment_id,
        name: data.arm.name,
        arm_type: data.arm.arm_type,
        title_variant_id: data.arm.title_variant_id ?? null,
        thumbnail_id: data.arm.thumbnail_id ?? null,
        traffic_split: data.arm.traffic_split,
        metrics: {},
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return toArmRow(row);
  });

export const deleteExperimentArm = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ experiment_id: uuid, arm_id: uuid }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const store = await getStore(userId);
    const experiment = await store.getExperiment(data.experiment_id);
    if (!experiment) throw new Error("Experiment not found.");
    if (experiment.status !== "draft") {
      throw new ExperimentValidationError("Arms can only be removed from draft experiments.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as AdminClient;
    const { error } = await admin
      .from("experiment_arms")
      .delete()
      .eq("id", data.arm_id)
      .eq("experiment_id", data.experiment_id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

export const startExperiment = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ id: uuid }).parse(i))
  .handler(async ({ data, context }) => {
    const store = await getStore(context.userId);
    return startExperimentLifecycle(store, data.id, new Date());
  });

export const pauseExperiment = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ id: uuid }).parse(i))
  .handler(async ({ data, context }) => {
    const store = await getStore(context.userId);
    return pauseExperimentLifecycle(store, data.id, new Date());
  });

export const recordArmMetrics = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z.object({ experiment_id: uuid, arm_id: uuid, metrics: metricsSchema }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const store = await getStore(userId);
    const out = await recordMetricsLifecycle(
      store,
      data.experiment_id,
      data.arm_id,
      data.metrics as ArmMetrics,
      new Date(),
    );
    if (out.concluded) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await finalizeConclusion(supabaseAdmin as AdminClient, userId, out.concluded);
    }
    return {
      arm: out.arm,
      evaluation: out.evaluation,
      concluded: out.concluded
        ? {
            verdict: out.concluded.conclusion.verdict,
            winner_arm_id: out.concluded.conclusion.winner_arm_id,
            decided_by: out.concluded.conclusion.decided_by,
          }
        : null,
    };
  });

export type ConcludeResult =
  | {
      ok: true;
      verdict: "winner" | "inconclusive";
      winner_arm_id: string | null;
      decided_by: "human" | "auto";
    }
  | { ok: false; evaluation: ConclusionEvaluation };

export const concludeExperiment = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ id: uuid }).parse(i))
  .handler(async ({ data, context }): Promise<ConcludeResult> => {
    const { userId } = context;
    const store = await getStore(userId);
    try {
      const out = await concludeExperimentLifecycle(store, data.id, new Date(), "human");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await finalizeConclusion(supabaseAdmin as AdminClient, userId, out);
      return {
        ok: true,
        verdict: out.conclusion.verdict,
        winner_arm_id: out.conclusion.winner_arm_id,
        decided_by: "human",
      };
    } catch (e) {
      // Not-ready is a normal UI state ("not yet significant"), not a 500.
      if (e instanceof ExperimentNotReadyError) {
        return { ok: false, evaluation: e.evaluation };
      }
      throw e;
    }
  });

/* ------------------------------------------------------------------ */
/* Apply winner — human-only, audit-logged, never automatic (D139)     */
/* ------------------------------------------------------------------ */

export interface ApplyWinnerResult {
  ok: boolean;
  applied: {
    title_variant_id: string | null;
    thumbnail_id: string | null;
  };
  /** False when the user has no workspace to attach the audit row to. */
  auditLogged: boolean;
}

async function resolveAuditWorkspaceId(admin: AdminClient, userId: string): Promise<string | null> {
  const { data: owned } = await admin
    .from("workspaces")
    .select("id")
    .eq("owner_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (owned?.id) return owned.id as string;
  const { data: member } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  return (member?.workspace_id as string | undefined) ?? null;
}

export const applyWinner = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ id: uuid }).parse(i))
  .handler(async ({ data, context }): Promise<ApplyWinnerResult> => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as AdminClient;
    const store = supabaseExperimentStore(admin, userId);

    // Re-check against the live row: never trust a stale client claim.
    const experiment = await store.getExperiment(data.id);
    if (!experiment) throw new Error("Experiment not found.");
    const arms = await store.listArms(data.id);
    const plan = buildApplyWinnerPlan(experiment, arms);

    let appliedTitle: string | null = null;
    let appliedThumbnail: string | null = null;

    if (plan.title_variant_id && plan.project_id) {
      const { data: tv, error: tvError } = await admin
        .from("title_variants")
        .select("id, title")
        .eq("id", plan.title_variant_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (tvError) throw new Error(tvError.message);
      if (tv?.title) {
        // Mark the winning variant; retire the losers on this project.
        const { error: markError } = await admin
          .from("title_variants")
          .update({ status: "winner", updated_at: new Date().toISOString() })
          .eq("id", plan.title_variant_id);
        if (markError) throw new Error(markError.message);

        // Point the project's live title at the winner (upsert seo_metadata).
        const { data: existing } = await admin
          .from("seo_metadata")
          .select("id")
          .eq("project_id", plan.project_id)
          .eq("user_id", userId)
          .maybeSingle();
        if (existing?.id) {
          const { error } = await admin
            .from("seo_metadata")
            .update({ selected_title: tv.title as string })
            .eq("id", existing.id as string);
          if (error) throw new Error(error.message);
        } else {
          const { error } = await admin.from("seo_metadata").insert({
            user_id: userId,
            project_id: plan.project_id,
            titles: [],
            selected_title: tv.title as string,
          });
          if (error) throw new Error(error.message);
        }
        appliedTitle = plan.title_variant_id;
      }
    }

    if (plan.thumbnail_id && plan.project_id) {
      const { data: thumb, error: thError } = await admin
        .from("thumbnails")
        .select("id, aspect")
        .eq("id", plan.thumbnail_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (thError) throw new Error(thError.message);
      if (thumb?.id) {
        // Deselect siblings of the same project+aspect, select the winner.
        const { error: clearError } = await admin
          .from("thumbnails")
          .update({ selected: false })
          .eq("project_id", plan.project_id)
          .eq("aspect", thumb.aspect as string);
        if (clearError) throw new Error(clearError.message);
        const { error: setError } = await admin
          .from("thumbnails")
          .update({ selected: true })
          .eq("id", plan.thumbnail_id);
        if (setError) throw new Error(setError.message);
        appliedThumbnail = plan.thumbnail_id;
      }
    }

    // Audit-log the human action (best-effort: never break the apply).
    // Local direct insert into audit_logs — Stream C does not touch the
    // audit module's action allow-list (owned by another stream).
    let auditLogged = false;
    try {
      const workspaceId = await resolveAuditWorkspaceId(admin, userId);
      if (!workspaceId) {
        console.error(
          `[experiments] apply-winner audit skipped: user ${userId} has no workspace (experiment ${data.id})`,
        );
      } else {
        const { error: auditError } = await admin.from("audit_logs").insert({
          workspace_id: workspaceId,
          actor_user_id: userId,
          action: "experiment.winner_applied",
          entity_type: "experiment",
          entity_id: data.id,
          metadata: {
            winner_arm_id: plan.winner_arm_id,
            title_variant_id: appliedTitle,
            thumbnail_id: appliedThumbnail,
          },
        });
        if (auditError) throw new Error(auditError.message);
        auditLogged = true;
      }
    } catch (e) {
      console.error("[experiments] apply-winner audit failed", e);
    }

    return {
      ok: true,
      applied: { title_variant_id: appliedTitle, thumbnail_id: appliedThumbnail },
      auditLogged,
    };
  });

/* ------------------------------------------------------------------ */
/* Test seam: build a store over the in-memory implementation           */
/* ------------------------------------------------------------------ */

/** Re-exported for tests that exercise the functions layer contract. */
export { createMemoryExperimentStore };
