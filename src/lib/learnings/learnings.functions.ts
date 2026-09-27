/**
 * F35 — Learning Engine server functions (TanStack Start).
 *
 * Thin wrappers over the pure domain logic in learnings.server.ts.
 *   - listLearnings / getLearning / createLearning (manual)
 *   - promoteLearning — the evidence gate is enforced in the domain layer
 *     (D140): no evidence + confidence ⇒ stays proposed.
 *   - draftFromCommentSignals — READ-ONLY over Stream D's engagement_insights
 *     (D142); Stream D owns all writes to that table.
 *   - minePatterns — aggregates VALIDATED learnings only; drafts are always
 *     source 'ai_analysis' (D141).
 */
import { createServerFn } from "@tanstack/react-start";
import type { Json } from "@/integrations/supabase/types";
import { z } from "zod";
import { requireAppUser } from "../server-auth";
import {
  archiveLearningLifecycle,
  createManualLearningLifecycle,
  createMemoryLearningStore,
  draftCommentSignalsLifecycle,
  minePatternsLifecycle,
  promoteLearningLifecycle,
  refuteLearningLifecycle,
  validateManualLearning,
  LEARNING_KINDS,
  LEARNING_SOURCES,
  LEARNING_STATUSES,
  type LearningRow,
  type LearningStore,
  type ManualLearningInput,
} from "./learnings.server";

// Generated Supabase types are stale for Phase 4 tables, so the admin
// client cannot be typed through them; explicit user_id guards on every
// query carry the ownership check instead of relying on RLS alone.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

/** One raw row from a select on a Phase 4 table (untyped: see AdminClient). */
type RawRow = { [key: string]: unknown };

function toLearningRow(data: RawRow): LearningRow {
  return {
    id: data["id"] as string,
    user_id: data["user_id"] as string,
    kind: data["kind"] as LearningRow["kind"],
    topic: (data["topic"] as string) ?? "general",
    payload: (data["payload"] ?? {}) as Record<string, Json>,
    evidence: (data["evidence"] ?? {}) as LearningRow["evidence"],
    confidence:
      data["confidence"] === null || data["confidence"] === undefined
        ? null
        : Number(data["confidence"]),
    source: (data["source"] as LearningRow["source"]) ?? "human",
    status: data["status"] as LearningRow["status"],
    experiment_id: (data["experiment_id"] as string | null) ?? null,
    created_at: data["created_at"] as string,
  };
}

function supabaseLearningStore(admin: AdminClient, userId: string): LearningStore {
  return {
    async getLearning(id: string) {
      const { data, error } = await admin
        .from("learning_insights")
        .select("*")
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? toLearningRow(data) : null;
    },
    async listLearnings(filter) {
      let q = admin
        .from("learning_insights")
        .select("*")
        .eq("user_id", filter.userId)
        .order("created_at", { ascending: false })
        .limit(filter.limit ?? 100);
      if (filter.kinds?.length) q = q.in("kind", filter.kinds);
      if (filter.statuses?.length) q = q.in("status", filter.statuses);
      if (filter.since) q = q.gte("created_at", filter.since);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []).map(toLearningRow);
    },
    // READ-ONLY contract with Stream D (D142): select only, never write.
    async listEngagementInsights(uid: string) {
      const { data, error } = await admin
        .from("engagement_insights")
        .select("id,user_id,kind,comment_id,payload,created_at")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r: RawRow) => ({
        id: r["id"] as string,
        user_id: r["user_id"] as string,
        kind: r["kind"] as string,
        comment_id: (r["comment_id"] as string | null) ?? null,
        payload: (r["payload"] ?? {}) as Record<string, Json>,
        created_at: r["created_at"] as string,
      }));
    },
    async insertLearning(row) {
      const { data, error } = await admin
        .from("learning_insights")
        .insert({
          user_id: row.user_id,
          kind: row.kind,
          topic: row.topic,
          payload: row.payload,
          evidence: row.evidence,
          confidence: row.confidence,
          source: row.source,
          status: row.status,
          experiment_id: row.experiment_id,
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return toLearningRow(data);
    },
    async patchLearning(id, patch) {
      const { data, error } = await admin
        .from("learning_insights")
        .update(patch)
        .eq("id", id)
        .eq("user_id", userId)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return toLearningRow(data);
    },
  };
}

async function getStore(userId: string): Promise<LearningStore> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseLearningStore(supabaseAdmin as AdminClient, userId);
}

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

const uuid = z.string().uuid();

const listLearningsSchema = z.object({
  status: z.enum(LEARNING_STATUSES).optional(),
  kind: z.enum(LEARNING_KINDS).optional(),
  topic: z.string().max(60).optional(),
  limit: z.number().int().min(1).max(200).default(100),
});

const evidenceSchema = z.object({
  type: z.enum(["experiment_outcome", "before_after", "comment_signal", "manual"]),
  refs: z.array(z.string()).default([]),
  metrics: z.record(z.string(), z.unknown()).default({}),
  sample: z.number().int().min(0).default(0),
});

const createLearningSchema = z.object({
  kind: z.enum(LEARNING_KINDS),
  topic: z.string().max(60).optional(),
  statement: z.string().min(10).max(2000),
  evidence: evidenceSchema.optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  experiment_id: uuid.nullable().optional(),
});

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

export const listLearnings = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => listLearningsSchema.parse(i ?? {}))
  .handler(async ({ data, context }): Promise<LearningRow[]> => {
    const store = await getStore(context.userId);
    const rows = await store.listLearnings({
      userId: context.userId,
      kinds: data.kind ? [data.kind] : undefined,
      statuses: data.status ? [data.status] : undefined,
      limit: data.limit,
    });
    return data.topic ? rows.filter((r) => r.topic === data.topic) : rows;
  });

export const getLearning = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ id: uuid }).parse(i))
  .handler(async ({ data, context }) => {
    const store = await getStore(context.userId);
    const row = await store.getLearning(data.id);
    if (!row) throw new Error("Learning not found.");
    return row;
  });

/* ------------------------------------------------------------------ */
/* Manual learnings                                                    */
/* ------------------------------------------------------------------ */

export const createLearning = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => createLearningSchema.parse(i))
  .handler(async ({ data, context }) => {
    const store = await getStore(context.userId);
    const input: ManualLearningInput = {
      kind: data.kind,
      topic: data.topic,
      statement: data.statement,
      evidence: data.evidence as ManualLearningInput["evidence"],
      confidence: data.confidence ?? null,
      experiment_id: data.experiment_id ?? null,
    };
    // validateManualLearning throws on bad input (also re-checked inside).
    validateManualLearning(input);
    return createManualLearningLifecycle(store, context.userId, input);
  });

export const promoteLearning = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ id: uuid }).parse(i))
  .handler(async ({ data, context }) => {
    const store = await getStore(context.userId);
    // Throws EvidenceGateError when the learning has no evidence or no
    // confidence — the UI surfaces the reasons.
    return promoteLearningLifecycle(store, data.id);
  });

export const refuteLearning = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ id: uuid }).parse(i))
  .handler(async ({ data, context }) => {
    const store = await getStore(context.userId);
    return refuteLearningLifecycle(store, data.id);
  });

export const archiveLearning = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ id: uuid }).parse(i))
  .handler(async ({ data, context }) => {
    const store = await getStore(context.userId);
    return archiveLearningLifecycle(store, data.id);
  });

/* ------------------------------------------------------------------ */
/* Drafting + mining                                                   */
/* ------------------------------------------------------------------ */

export const draftFromCommentSignals = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({}).parse(i ?? {}))
  .handler(async ({ context }) => {
    const store = await getStore(context.userId);
    return draftCommentSignalsLifecycle(store, context.userId, new Date());
  });

export const minePatterns = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({}).parse(i ?? {}))
  .handler(async ({ context }) => {
    const store = await getStore(context.userId);
    return minePatternsLifecycle(store, context.userId);
  });

/* ------------------------------------------------------------------ */
/* Test seam                                                           */
/* ------------------------------------------------------------------ */

export { createMemoryLearningStore, LEARNING_SOURCES };
