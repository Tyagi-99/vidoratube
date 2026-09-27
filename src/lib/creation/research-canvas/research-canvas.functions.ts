/**
 * F9 Visual Research — research canvas server functions.
 *
 * Per-project source canvas: list / add / update / remove / reorder.
 * Sources already flow from the Phase-2 Trend Radar (TrendDataPort persists
 * `research_sources` rows with citations in `metadata`); this module is the
 * read/write surface the canvas UI builds on.
 *
 * Ownership: every query is scoped `.eq("user_id", userId)` (service-role
 * client bypasses RLS, so the scope is explicit here).
 *
 * Client-bundle rule: no top-level `node:*` imports. Server-only modules are
 * reached via dynamic import() inside handlers.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAppUser } from "@/lib/server-auth";
import {
  CreateSourceSchema,
  ReorderSourcesSchema,
  UpdateSourceSchema,
  type CanvasSource,
  type ResearchSourceRow,
  type ResearchSourceType,
} from "./types";

/** Minimal surface of the service-role client used by this module. */
export type AdminDb = Pick<SupabaseClient, "from">;

/* ------------------------------------------------------------------ */
/* Data port (fake-able in tests; supabase implementation below)        */
/* ------------------------------------------------------------------ */

export type SourceInsert = {
  source_type: ResearchSourceType;
  url: string | null;
  title: string;
  excerpt: string;
  published_at: string | null;
  position: number;
};

export interface ResearchCanvasDataPort {
  listSources(userId: string, projectId: string): Promise<ResearchSourceRow[]>;
  countClaims(userId: string, sourceIds: string[]): Promise<Record<string, number>>;
  insertSource(userId: string, projectId: string, row: SourceInsert): Promise<ResearchSourceRow>;
  updateSource(
    userId: string,
    id: string,
    patch: Partial<Pick<ResearchSourceRow, "title" | "excerpt" | "published_at">>,
  ): Promise<ResearchSourceRow>;
  deleteSource(userId: string, id: string): Promise<void>;
  setPositions(userId: string, projectId: string, orderedIds: string[]): Promise<void>;
  assertProjectOwned(userId: string, projectId: string): Promise<void>;
}

type Db = AdminDb;

export function makeSupabaseResearchCanvasPort(admin: Db): ResearchCanvasDataPort {
  const check = (error: { message: string } | null, what: string) => {
    if (error) throw new Error(`${what}: ${error.message}`);
  };
  return {
    async listSources(userId, projectId) {
      const { data, error } = await admin
        .from("research_sources")
        .select("*")
        .eq("user_id", userId)
        .eq("project_id", projectId)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      check(error, "listSources");
      return (data ?? []) as ResearchSourceRow[];
    },

    async countClaims(userId, sourceIds) {
      if (sourceIds.length === 0) return {};
      const { data, error } = await admin
        .from("research_claims")
        .select("source_id")
        .eq("user_id", userId)
        .in("source_id", sourceIds);
      check(error, "countClaims");
      const counts: Record<string, number> = {};
      for (const row of (data ?? []) as { source_id: string }[]) {
        counts[row.source_id] = (counts[row.source_id] ?? 0) + 1;
      }
      return counts;
    },

    async insertSource(userId, projectId, row) {
      const { data, error } = await admin
        .from("research_sources")
        .insert({ user_id: userId, project_id: projectId, ...row })
        .select("*")
        .single();
      check(error, "insertSource");
      return data as ResearchSourceRow;
    },

    async updateSource(userId, id, patch) {
      const { data, error } = await admin
        .from("research_sources")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("id", id)
        .select("*")
        .single();
      check(error, "updateSource");
      return data as ResearchSourceRow;
    },

    async deleteSource(userId, id) {
      const { error } = await admin
        .from("research_sources")
        .delete()
        .eq("user_id", userId)
        .eq("id", id);
      check(error, "deleteSource");
    },

    async setPositions(userId, projectId, orderedIds) {
      // Positional update, one statement per row — canvas sets are small
      // (< 500 by schema cap) and correctness beats batch cleverness.
      for (let i = 0; i < orderedIds.length; i++) {
        const { error } = await admin
          .from("research_sources")
          .update({ position: i, updated_at: new Date().toISOString() })
          .eq("user_id", userId)
          .eq("project_id", projectId)
          .eq("id", orderedIds[i]);
        check(error, "setPositions");
      }
    },

    async assertProjectOwned(userId, projectId) {
      const { data, error } = await admin
        .from("projects")
        .select("id")
        .eq("user_id", userId)
        .eq("id", projectId)
        .limit(1);
      check(error, "assertProjectOwned");
      if (!data || (data as unknown[]).length === 0) {
        throw new Error("Project not found");
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Business logic over the port (pure, unit-tested)                     */
/* ------------------------------------------------------------------ */

/** Validate that a reorder request matches the project's source set exactly. */
export function validateReorder(current: ResearchSourceRow[], orderedIds: string[]): void {
  const currentIds = new Set(current.map((s) => s.id));
  const seen = new Set<string>();
  for (const id of orderedIds) {
    if (seen.has(id)) throw new Error("Reorder contains a duplicate source id");
    seen.add(id);
    if (!currentIds.has(id)) throw new Error("Reorder references an unknown source");
  }
  if (seen.size !== currentIds.size) {
    throw new Error("Reorder must include every source on the canvas");
  }
}

export async function listCanvas(
  port: ResearchCanvasDataPort,
  userId: string,
  projectId: string,
): Promise<CanvasSource[]> {
  await port.assertProjectOwned(userId, projectId);
  const sources = await port.listSources(userId, projectId);
  const counts = await port.countClaims(
    userId,
    sources.map((s) => s.id),
  );
  return sources.map((s) => ({ ...s, claimCount: counts[s.id] ?? 0 }));
}

/* ------------------------------------------------------------------ */
/* Server functions                                                     */
/* ------------------------------------------------------------------ */

async function getPort(): Promise<ResearchCanvasDataPort> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return makeSupabaseResearchCanvasPort(supabaseAdmin);
}

const projectIdSchema = z.object({ projectId: z.string().uuid() });

export const listCanvasSources = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => projectIdSchema.parse(i))
  .handler(async ({ data, context }): Promise<CanvasSource[]> => {
    const { userId } = context;
    return listCanvas(await getPort(), userId, data.projectId);
  });

export const addCanvasSource = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => CreateSourceSchema.parse(i))
  .handler(async ({ data, context }): Promise<CanvasSource> => {
    const { userId } = context;
    const port = await getPort();
    await port.assertProjectOwned(userId, data.projectId);
    const existing = await port.listSources(userId, data.projectId);
    const row = await port.insertSource(userId, data.projectId, {
      source_type: data.sourceType,
      url: data.url && data.url.length > 0 ? data.url : null,
      title: data.title,
      excerpt: data.excerpt,
      published_at: data.publishedAt ?? null,
      // New sources land at the end of the canvas.
      position: existing.length,
    });
    return { ...row, claimCount: 0 };
  });

export const updateCanvasSource = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => UpdateSourceSchema.parse(i))
  .handler(async ({ data, context }): Promise<CanvasSource> => {
    const { userId } = context;
    const port = await getPort();
    const patch: Partial<Pick<ResearchSourceRow, "title" | "excerpt" | "published_at">> = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.excerpt !== undefined) patch.excerpt = data.excerpt;
    if (data.publishedAt !== undefined) patch.published_at = data.publishedAt ?? null;
    const row = await port.updateSource(userId, data.id, patch);
    const counts = await port.countClaims(userId, [row.id]);
    return { ...row, claimCount: counts[row.id] ?? 0 };
  });

export const removeCanvasSource = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { userId } = context;
    const port = await getPort();
    await port.deleteSource(userId, data.id);
    return { ok: true };
  });

export const reorderCanvasSources = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => ReorderSourcesSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { userId } = context;
    const port = await getPort();
    await port.assertProjectOwned(userId, data.projectId);
    const current = await port.listSources(userId, data.projectId);
    validateReorder(current, data.orderedIds);
    await port.setPositions(userId, data.projectId, data.orderedIds);
    return { ok: true };
  });
