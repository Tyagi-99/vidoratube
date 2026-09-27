/**
 * F11 Deep Research hardening — Evidence Desk server functions.
 *
 * Approval-first gates (competitor pattern #3):
 *  - claims are extracted/linking candidates only (see linker.ts);
 *  - a human reviewer CONFIRMS or WAIVES each claim via `setClaimReview`
 *    — no code path ever sets review_state automatically;
 *  - `projects.research_strict_mode` fail-closes packaging/publishing while
 *    any project claim lacks review_state = 'confirmed'
 *    (`evaluateStrictGate`, D105: waived counts as unconfirmed under strict).
 *
 * Client-bundle rule: no top-level `node:*` imports; server-only modules via
 * dynamic import() inside handlers.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/integrations/supabase/types";
import { requireAppUser } from "@/lib/server-auth";
import {
  SaveClaimsSchema,
  SetReviewSchema,
  type ClaimVerdict,
  type ClaimWithSources,
  type ExtractedClaim,
  type ResearchClaimRow,
} from "./types";
import { evaluateStrictGate, type StrictGateResult } from "./linker";
import { extractClaimCandidates, linkClaimsToSources } from "./linker";
import { getProjectStrictGate, type StrictGateVerdict } from "./strict-gate";

/** Re-exported from ./types (the canonical home for client-importable types). */
export type { ExtractedClaim };

/** Minimal surface of the service-role client used by this module. */
export type AdminDb = Pick<SupabaseClient, "from">;
type Db = AdminDb;

export type ClaimSourceLite = {
  id: string;
  title: string;
  url: string | null;
  source_type: string;
  published_at: string | null;
  excerpt: string;
};

export interface ClaimsDataPort {
  getProjectStrictMode(userId: string, projectId: string): Promise<boolean>;
  setProjectStrictMode(userId: string, projectId: string, enabled: boolean): Promise<void>;
  listProjectSources(userId: string, projectId: string): Promise<ClaimSourceLite[]>;
  assertSourceInProject(userId: string, projectId: string, sourceId: string): Promise<void>;
  listProjectClaims(userId: string, projectId: string): Promise<ClaimWithSources[]>;
  insertClaims(
    userId: string,
    rows: { source_id: string; claim: string; verdict: ClaimVerdict; evidence: Json }[],
  ): Promise<ResearchClaimRow[]>;
  setClaimReview(
    userId: string,
    claimId: string,
    reviewState: "confirmed" | "waived",
    note: string,
  ): Promise<ResearchClaimRow>;
  getScriptText(
    userId: string,
    scriptId: string,
  ): Promise<{ projectId: string; text: string } | null>;
}

export function makeSupabaseClaimsPort(admin: Db): ClaimsDataPort {
  const check = (error: { message: string } | null, what: string) => {
    if (error) throw new Error(`${what}: ${error.message}`);
  };
  return {
    async getProjectStrictMode(userId, projectId) {
      const { data, error } = await admin
        .from("projects")
        .select("research_strict_mode")
        .eq("user_id", userId)
        .eq("id", projectId)
        .single();
      check(error, "getProjectStrictMode");
      return Boolean((data as { research_strict_mode?: boolean } | null)?.research_strict_mode);
    },

    async setProjectStrictMode(userId, projectId, enabled) {
      const { error } = await admin
        .from("projects")
        .update({ research_strict_mode: enabled })
        .eq("user_id", userId)
        .eq("id", projectId);
      check(error, "setProjectStrictMode");
    },

    async listProjectSources(userId, projectId) {
      const { data, error } = await admin
        .from("research_sources")
        .select("id, title, url, source_type, published_at, excerpt")
        .eq("user_id", userId)
        .eq("project_id", projectId)
        .order("position", { ascending: true });
      check(error, "listProjectSources");
      return (data ?? []) as ClaimSourceLite[];
    },

    async assertSourceInProject(userId, projectId, sourceId) {
      const { data, error } = await admin
        .from("research_sources")
        .select("id")
        .eq("user_id", userId)
        .eq("project_id", projectId)
        .eq("id", sourceId)
        .limit(1);
      check(error, "assertSourceInProject");
      if (!data || (data as unknown[]).length === 0) {
        throw new Error("Source does not belong to this project");
      }
    },

    async listProjectClaims(userId, projectId) {
      // Claims are project-scoped through their source row.
      const { data, error } = await admin
        .from("research_claims")
        .select("*, research_sources!inner(id, title, url, source_type, published_at, project_id)")
        .eq("user_id", userId)
        .eq("research_sources.project_id", projectId)
        .order("created_at", { ascending: true });
      check(error, "listProjectClaims");
      return (
        (data ?? []) as (ResearchClaimRow & {
          research_sources: ClaimSourceLite & { project_id: string };
        })[]
      ).map((row) => {
        const { research_sources: src, ...claim } = row;
        return {
          ...claim,
          sources: [
            {
              id: src.id,
              title: src.title,
              url: src.url,
              source_type: src.source_type,
              published_at: src.published_at,
            },
          ],
        };
      });
    },

    async insertClaims(userId, rows) {
      const { data, error } = await admin
        .from("research_claims")
        .insert(rows.map((r) => ({ user_id: userId, ...r })))
        .select("*");
      check(error, "insertClaims");
      return (data ?? []) as ResearchClaimRow[];
    },

    async setClaimReview(userId, claimId, reviewState, note) {
      // Ownership is enforced by the user_id scope; the claim's project is
      // unchanged. Only explicit human states pass the zod schema.
      const { data, error } = await admin
        .from("research_claims")
        .update({
          review_state: reviewState,
          reviewed_by: userId,
          reviewed_at: new Date().toISOString(),
          review_note: note,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("id", claimId)
        .select("*")
        .single();
      check(error, "setClaimReview");
      return data as ResearchClaimRow;
    },

    async getScriptText(userId, scriptId) {
      const { data: script, error } = await admin
        .from("scripts")
        .select("id, project_id, current_version_id")
        .eq("user_id", userId)
        .eq("id", scriptId)
        .single();
      if (error || !script) return null;
      const s = script as { project_id: string; current_version_id: string | null };
      if (!s.current_version_id) return { projectId: s.project_id, text: "" };
      const { data: version } = await admin
        .from("script_versions")
        .select("full_text")
        .eq("id", s.current_version_id)
        .single();
      return {
        projectId: s.project_id,
        text: (version as { full_text?: string } | null)?.full_text ?? "",
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Business logic over the port                                         */
/* ------------------------------------------------------------------ */

export type EvidenceDeskState = {
  strictMode: boolean;
  claims: ClaimWithSources[];
  gate: StrictGateResult;
};

export async function getEvidenceDeskState(
  port: ClaimsDataPort,
  userId: string,
  projectId: string,
): Promise<EvidenceDeskState> {
  const [strictMode, claims] = await Promise.all([
    port.getProjectStrictMode(userId, projectId),
    port.listProjectClaims(userId, projectId),
  ]);
  return {
    strictMode,
    claims,
    gate: evaluateStrictGate({ strictMode, claims }),
  };
}

export type ClaimExtraction = {
  candidates: ExtractedClaim[];
  /** How many canvas sources the linker searched. */
  sourceCount: number;
};

/**
 * Deterministic claim extraction for the Evidence Desk: reads the script's
 * current version text plus the project's canvas sources, extracts
 * candidate factual sentences, and links each to candidate sources.
 * NOTHING is saved or approved — the reviewer explicitly adds claims.
 */
export async function extractClaimsForScript(
  port: ClaimsDataPort,
  userId: string,
  scriptId: string,
): Promise<ClaimExtraction> {
  const script = await port.getScriptText(userId, scriptId);
  if (!script) throw new Error("Script not found");
  const sources = await port.listProjectSources(userId, script.projectId);
  const candidates = extractClaimCandidates(script.text);
  const linked = linkClaimsToSources(
    candidates,
    sources.map((s) => ({ id: s.id, title: s.title, url: s.url, excerpt: s.excerpt ?? "" })),
  );
  return {
    candidates: candidates.map((c, i) => ({
      text: c.text,
      score: c.score,
      reasons: c.reasons,
      matches: linked[i]?.matches ?? [],
    })),
    sourceCount: sources.length,
  };
}

/* ------------------------------------------------------------------ */
/* Server functions                                                     */
/* ------------------------------------------------------------------ */

async function getPort(): Promise<ClaimsDataPort> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return makeSupabaseClaimsPort(supabaseAdmin);
}

const projectIdSchema = z.object({ projectId: z.string().uuid() });

export const getEvidenceDesk = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => projectIdSchema.parse(i))
  .handler(async ({ data, context }): Promise<EvidenceDeskState> => {
    const { userId } = context;
    return getEvidenceDeskState(await getPort(), userId, data.projectId);
  });

/**
 * Fail-closed gate check. Stream F (quick-create) and any packaging surface
 * call this before proceeding; `blocked === true` must stop the flow.
 *
 * Shares its implementation with the publish approval/execution gates via
 * `getProjectStrictGate` (strict-gate.ts) — one rule, three call sites.
 */
export const checkStrictGate = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => projectIdSchema.parse(i))
  .handler(async ({ data, context }): Promise<StrictGateResult> => {
    const { userId } = context;
    const port = await getPort();
    const [strictMode, claims] = await Promise.all([
      port.getProjectStrictMode(userId, data.projectId),
      port.listProjectClaims(userId, data.projectId),
    ]);
    return evaluateStrictGate({ strictMode, claims });
  });

/**
 * Serializable gate verdict for UI surfaces (project page banner, export
 * button disable). Same rule as `checkStrictGate`, evaluated with count
 * queries so the project page stays cheap.
 */
export const getProjectGateState = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => projectIdSchema.parse(i))
  .handler(async ({ data, context }): Promise<StrictGateVerdict> => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return getProjectStrictGate(supabaseAdmin, userId, data.projectId);
  });

export const saveEvidenceClaims = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => SaveClaimsSchema.parse(i))
  .handler(async ({ data, context }): Promise<ResearchClaimRow[]> => {
    const { userId } = context;
    const port = await getPort();
    // Every claim must attach to a source the user owns on this project —
    // an un-sourced claim cannot enter the evidence desk (FK requires it).
    for (const c of data.claims) {
      await port.assertSourceInProject(userId, data.projectId, c.sourceId);
    }
    return port.insertClaims(
      userId,
      data.claims.map((c) => ({
        source_id: c.sourceId,
        claim: c.claim,
        verdict: c.verdict,
        evidence: c.evidence,
      })),
    );
  });

/**
 * Human review decision. The zod schema admits only "confirmed" | "waived" —
 * review_state can never be set (or reverted) to "unreviewed" through the
 * API, and no background process touches it. Never auto-approved.
 */
export const setClaimReview = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => SetReviewSchema.parse(i))
  .handler(async ({ data, context }): Promise<ResearchClaimRow> => {
    const { userId } = context;
    const port = await getPort();
    return port.setClaimReview(userId, data.claimId, data.reviewState, data.note);
  });

export const setResearchStrictMode = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z.object({ projectId: z.string().uuid(), enabled: z.boolean() }).parse(i),
  )
  .handler(async ({ data, context }): Promise<{ strictMode: boolean }> => {
    const { userId } = context;
    const port = await getPort();
    await port.setProjectStrictMode(userId, data.projectId, data.enabled);
    return { strictMode: data.enabled };
  });

/**
 * Deterministic extraction endpoint: current script text + project sources
 * → candidate claims with candidate source links. Read-only: nothing is
 * saved, nothing is approved. The reviewer adds claims explicitly via
 * `saveEvidenceClaims`.
 */
export const extractScriptClaims = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ scriptId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<ClaimExtraction> => {
    const { userId } = context;
    return extractClaimsForScript(await getPort(), userId, data.scriptId);
  });
