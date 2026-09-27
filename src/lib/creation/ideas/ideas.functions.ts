/**
 * Stream A — F8 Viral Idea Engine server functions.
 *
 * Evidence-backed scoring over `video_ideas` (schema:
 * `20260925120000_schema_reconciliation.sql`). The scorer itself is pure and
 * deterministic (`scorer.ts`); these handlers assemble the evidence:
 *   - Phase-2 outlier evidence comes from `outlier_videos.outlier_score`
 *     (descriptive latest-views ÷ sibling-median multiples, D96). Note: the
 *     pinned `videos` table carries no `outlier_score` column — the task
 *     brief's `videos.outlier_score` reference is corrected here to the
 *     actual ideation surface.
 *   - The computed score is cached on `video_ideas.score`
 *     (`20260928041000_p3_stream_a.sql`); the cache is recomputable and the
 *     UI always shows the factor breakdown.
 *
 * Thin evidence → confidence 'low' + 'insufficient_data' evidence strings
 * (D94). No virality guarantees anywhere.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "../../server-auth";
import { adminDb, dbList, dbOne, type AdminDb } from "../../intelligence/youtube-api.server";
import {
  extractIdeaKeywords,
  scoreIdea,
  type IdeaOutlierEvidence,
  type IdeaScoreInput,
  type IdeaScorerIdea,
} from "./scorer";
import type { IdeaScore } from "../contracts";

/* ------------------------------------------------------------------ */
/* Local table types (D89: `type` aliases, not interfaces)              */
/* ------------------------------------------------------------------ */

type VideoIdeaRow = {
  id: string;
  user_id: string;
  project_id: string;
  title: string;
  hook: string;
  angle: string;
  format: string;
  difficulty: string;
  safety_flag: string;
  status: string;
  project_ref: string | null;
  /** Cached deterministic score (migration 20260928041000); null until scored. */
  score: { computed_at?: string; score?: IdeaScore } | null;
  created_at: string;
  updated_at: string;
};

type ResearchProjectRow = {
  id: string;
  topic: string;
};

type OutlierVideoRow = {
  youtube_id: string;
  title: string;
  outlier_score: number;
};

async function getAdmin(): Promise<AdminDb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return adminDb(supabaseAdmin);
}

/* ------------------------------------------------------------------ */
/* Pure helpers (exported for unit tests)                              */
/* ------------------------------------------------------------------ */

/** Row → scorer input. */
export function ideaRowToScorerInput(row: VideoIdeaRow): IdeaScorerIdea {
  return {
    id: row.id,
    title: row.title,
    hook: row.hook,
    angle: row.angle,
    format: row.format,
    difficulty: row.difficulty,
    safetyFlag: row.safety_flag,
  };
}

/**
 * Match outlier rows to an idea by keyword overlap (case-insensitive
 * substring on the outlier video title). Deterministic; caps at 50 matches.
 */
export function matchOutliersToIdea(
  outliers: OutlierVideoRow[],
  keywords: string[],
): OutlierVideoRow[] {
  if (keywords.length === 0) return [];
  const lowered = keywords.map((k) => k.toLowerCase());
  const matched: OutlierVideoRow[] = [];
  for (const o of outliers) {
    const title = o.title.toLowerCase();
    if (lowered.some((k) => title.includes(k))) {
      matched.push(o);
      if (matched.length >= 50) break;
    }
  }
  return matched;
}

/** Assemble the full scorer input from a row + its project's outlier rows. */
export function buildIdeaScoreInput(
  row: VideoIdeaRow,
  projectOutliers: OutlierVideoRow[],
): IdeaScoreInput {
  const idea = ideaRowToScorerInput(row);
  const keywords = extractIdeaKeywords(idea.title, idea.hook, idea.angle);
  const matched = matchOutliersToIdea(projectOutliers, keywords);
  const outlier: IdeaOutlierEvidence = {
    matchedOutlierScores: matched
      .map((m) => m.outlier_score)
      .filter((s) => Number.isFinite(s) && s > 0),
    matchedKeywords: keywords,
    projectOutlierCount: projectOutliers.length,
  };
  return { idea, outlier };
}

/** The cache payload written to `video_ideas.score`. Recomputable. */
export function buildScoreCachePayload(score: IdeaScore): {
  computed_at: string;
  score: IdeaScore;
} {
  return {
    computed_at: new Date().toISOString(),
    score,
  };
}

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

const uuidSchema = z.string().uuid();

export const listIdeasSchema = z.object({
  researchProjectId: z.string().uuid().optional(),
  status: z.string().max(30).optional(),
  limit: z.number().int().min(1).max(200).default(100),
});

export const createIdeaSchema = z.object({
  researchProjectId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  hook: z.string().trim().max(500).default(""),
  angle: z.string().trim().max(500).default(""),
  format: z.string().trim().max(30).default("long"),
  difficulty: z.string().trim().max(30).default("medium"),
  safetyFlag: z.string().trim().max(30).default("safe"),
});

const ideaIdSchema = z.object({ ideaId: uuidSchema });

/* ------------------------------------------------------------------ */
/* listIdeas                                                           */
/* ------------------------------------------------------------------ */

export const listIdeasForHub = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => listIdeasSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    let query = admin
      .from("video_ideas")
      .select(
        "id, user_id, project_id, title, hook, angle, format, difficulty, safety_flag, status, project_ref, score, created_at, updated_at",
      )
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(data.limit);
    if (data.researchProjectId) query = query.eq("project_id", data.researchProjectId);
    if (data.status) query = query.eq("status", data.status);
    const ideas = await dbList<VideoIdeaRow>(query);
    const projectIds = [...new Set(ideas.map((i) => i.project_id))];
    const projects =
      projectIds.length > 0
        ? await dbList<ResearchProjectRow>(
            admin.from("research_projects").select("id, topic").in("id", projectIds),
          )
        : [];
    const topicById = new Map(projects.map((p) => [p.id, p.topic]));
    return {
      status: "ok" as const,
      ideas: ideas.map((i) => ({
        ...i,
        research_topic: topicById.get(i.project_id) ?? null,
      })),
    };
  });

/* ------------------------------------------------------------------ */
/* createIdea                                                          */
/* ------------------------------------------------------------------ */

export const createIdea = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => createIdeaSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    const project = await dbOne<ResearchProjectRow>(
      admin
        .from("research_projects")
        .select("id, topic")
        .eq("id", data.researchProjectId)
        .eq("user_id", userId)
        .maybeSingle<ResearchProjectRow>(),
    );
    if (!project) throw new Error("Research project not found.");
    const idea = await dbOne<VideoIdeaRow>(
      admin
        .from("video_ideas")
        .insert({
          user_id: userId,
          project_id: data.researchProjectId,
          title: data.title,
          hook: data.hook,
          angle: data.angle,
          format: data.format,
          difficulty: data.difficulty,
          safety_flag: data.safetyFlag,
          status: "new",
        })
        .select(
          "id, user_id, project_id, title, hook, angle, format, difficulty, safety_flag, status, project_ref, score, created_at, updated_at",
        )
        .single<VideoIdeaRow>(),
    );
    if (!idea) throw new Error("Failed to create idea.");
    return { status: "ok" as const, idea };
  });

/* ------------------------------------------------------------------ */
/* scoreIdeaFn — assemble evidence, score, cache                       */
/* ------------------------------------------------------------------ */

export const scoreIdeaFn = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => ideaIdSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    const idea = await dbOne<VideoIdeaRow>(
      admin
        .from("video_ideas")
        .select(
          "id, user_id, project_id, title, hook, angle, format, difficulty, safety_flag, status, project_ref, score, created_at, updated_at",
        )
        .eq("id", data.ideaId)
        .eq("user_id", userId)
        .maybeSingle<VideoIdeaRow>(),
    );
    if (!idea) throw new Error("Idea not found.");
    const outliers = await dbList<OutlierVideoRow>(
      admin
        .from("outlier_videos")
        .select("youtube_id, title, outlier_score")
        .eq("user_id", userId)
        .eq("project_id", idea.project_id)
        .order("outlier_score", { ascending: false })
        .limit(100),
    );
    const score = scoreIdea(buildIdeaScoreInput(idea, outliers));
    // Cache the deterministic score; failure here must not break scoring.
    try {
      await dbOne(
        admin
          .from("video_ideas")
          .update({ score: buildScoreCachePayload(score), updated_at: new Date().toISOString() })
          .eq("id", idea.id)
          .eq("user_id", userId)
          .select("id")
          .maybeSingle<{ id: string }>(),
      );
    } catch {
      // Cache write is best-effort (e.g. migration not yet applied); the
      // score itself is always returned.
    }
    return { status: "ok" as const, score };
  });
