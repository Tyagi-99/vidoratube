import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  SAFETY_SCORE_VERSION,
  computeSafetyScore,
  type SafetyIssue,
} from "./safety";

/**
 * P6: Monetization Safety Score server functions.
 *
 * scoreProject  — gathers script + metadata + P4 provenance, computes the
 *                 versioned score, stores it in safety_scores. 1 credit.
 * getSafetyScore — latest score + history for a project. Free.
 * requestDeepReview — LLM reads the script and flags subtle issues for
 *                 borderline scores (50-89). 1 credit. Labeled AI opinion.
 * rewriteFlaggedSpan — LLM rewrites a flagged script span. 1 credit.
 *
 * All paid endpoints: zod-validated, Postgres rate-limited, idempotent
 * credit debit via debit_credits_for_job_once.
 */

const LLM_MODEL = "google/gemini-3.5-flash";

/** Records a safety LLM call's measured gateway cost (passthrough estimate). */
async function recordSafetyLlmCost(
  admin: import("@supabase/supabase-js").SupabaseClient<import("@/integrations/supabase/types").Database>,
  userId: string,
  projectId: string,
  operation: "llm_plan" | "llm_script",
  system: string,
  user: string,
  payload: unknown,
): Promise<void> {
  const {
    extractUsage,
    estimateTokens,
    gatewayChatUnitCostUsd,
    recordApiCost,
  } = await import("./api-cost");
  const usage = extractUsage(payload);
  const inputTokens = usage?.inputTokens ?? estimateTokens(system + user);
  const outputTokens = usage?.outputTokens ?? 0;
  await recordApiCost(admin, {
    userId,
    projectId,
    provider: "lovable-ai",
    operation,
    units: inputTokens + outputTokens,
    unitCostUsd: gatewayChatUnitCostUsd(inputTokens, outputTokens),
    meta: {
      model: LLM_MODEL,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      usage_reported: usage !== null,
      cost_basis: "gateway-passthrough-estimate",
    },
  });
}

async function debitSafetyCredit(admin: any, userId: string, reason: string) {
  const { error } = await admin.rpc("debit_credits_for_job_once", {
    p_user_id: userId,
    p_job_id: reason,
    p_amount: 1,
  });
  if (error) throw new Error("You're out of credits. Upgrade your plan to continue.");
}

async function enforceSafetyRateLimit(
  admin: any,
  userId: string,
  action: string,
  max = 20
) {
  const { enforcePostgresRateLimit } = await import("./rate-limit");
  await enforcePostgresRateLimit(
    admin,
    `safety:${action}:${userId}`,
    { max, windowSeconds: 3600 },
    "You're checking safety too fast. Please wait a bit and try again."
  );
}

const projectIdSchema = z.object({ project_id: z.string().uuid() });

interface ProjectInputs {
  script: string;
  title: string;
  description: string;
  assets: { kind: string; provider: string | null; license: string | null; licenseUrl: string | null }[];
  sourceTexts: string[];
  madeForKids: boolean | null;
}

/** Gathers everything the scorer needs, verifying project ownership. */
async function gatherInputs(
  supabase: any,
  userId: string,
  projectId: string
): Promise<ProjectInputs> {
  const { data: project } = await supabase
    .from("projects")
    .select("id, title, topic, script")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!project) throw new Error("Project not found");

  const { data: seo } = await supabase
    .from("seo_metadata")
    .select("selected_title, description")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  const { data: provenance } = await supabase
    .from("asset_provenance")
    .select("kind, provider, license, license_url")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .limit(200);

  // Originality sources: titles of the user's imported outlier videos
  // (transcripts aren't stored; title-level signal only — stated in UI).
  const { data: outliers } = await supabase
    .from("outlier_videos")
    .select("title")
    .eq("user_id", userId)
    .order("outlier_score", { ascending: false })
    .limit(50);

  // Latest made-for-kids declaration from any publish job on this project.
  const { data: pubJob } = await supabase
    .from("publish_jobs")
    .select("made_for_kids")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    script: project.script ?? "",
    title: seo?.selected_title || project.title,
    description: seo?.description ?? "",
    assets: (provenance ?? []).map((p: any) => ({
      kind: p.kind,
      provider: p.provider,
      license: p.license,
      licenseUrl: p.license_url,
    })),
    sourceTexts: (outliers ?? []).map((o: any) => o.title).filter(Boolean),
    madeForKids: pubJob?.made_for_kids ?? null,
  };
}

/** Scores a project and stores the versioned result. Costs 1 credit. */
export const scoreProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => projectIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    await enforceSafetyRateLimit(supabaseAdmin, userId, "score");
    await debitSafetyCredit(supabaseAdmin, userId, `safety:score:${data.project_id}`);

    const inputs = await gatherInputs(supabase, userId, data.project_id);
    if (!inputs.script.trim()) {
      throw new Error("Generate a script first — there's nothing to score yet.");
    }

    const result = computeSafetyScore({
      script: inputs.script,
      title: inputs.title,
      description: inputs.description,
      assets: inputs.assets,
      sourceTexts: inputs.sourceTexts,
      madeForKids: inputs.madeForKids,
    });

    const { data: row, error } = await supabaseAdmin
      .from("safety_scores")
      .insert({
        user_id: userId,
        project_id: data.project_id,
        version: SAFETY_SCORE_VERSION,
        score: result.score,
        band: result.band,
        dimensions: JSON.parse(
          JSON.stringify(
            Object.fromEntries(
              result.dimensions.map((d) => [
                d.dimension,
                { points: d.points, maxPoints: d.maxPoints },
              ])
            )
          )
        ),
        issues: JSON.parse(JSON.stringify(result.issues)),
      })
      .select("id, score, band, created_at")
      .single();
    if (error) throw new Error("Could not save the safety score.");

    return { ...row, issues: result.issues, dimensions: result.dimensions, version: result.version };
  });

/** Latest safety score + history for a project. Free. */
export const getSafetyScore = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => projectIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("id", data.project_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!project) throw new Error("Project not found");

    const { data: history } = await supabase
      .from("safety_scores")
      .select("id, version, score, band, dimensions, issues, ai_review, created_at")
      .eq("project_id", data.project_id)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);

    return { latest: history?.[0] ?? null, history: history ?? [] };
  });

const deepReviewSchema = z.object({
  issues: z.array(
    z.object({
      severity: z.enum(["info", "warning", "critical"]),
      message: z.string(),
      suggestion: z.string(),
    })
  ),
});

/**
 * LLM deep review for borderline scores (50-89). Reads the full script and
 * flags subtle issues the keyword scorer can't see (implied claims,
 * borderline framing). Clearly labeled as AI opinion — not a guarantee.
 * Costs 1 credit.
 */
export const requestDeepReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => projectIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    await enforceSafetyRateLimit(supabaseAdmin, userId, "deep-review", 10);

    const { data: latest } = await supabase
      .from("safety_scores")
      .select("id, score")
      .eq("project_id", data.project_id)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latest) throw new Error("Run a safety check first.");
    if (latest.score < 50 || latest.score >= 90) {
      throw new Error("Deep review is for borderline scores (50-89).");
    }

    await debitSafetyCredit(supabaseAdmin, userId, `safety:deep-review:${latest.id}`);

    const inputs = await gatherInputs(supabase, userId, data.project_id);
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured on this project.");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are a YouTube advertiser-policy analyst. Read the video script and flag subtle monetization risks the keyword checker may miss: implied medical/financial claims, borderline sexual or violent framing, demeaning language, misinformation risk, undisclosed sponsorship tone. Be specific and quote the line. Respond with JSON only: {\"issues\": [{\"severity\": \"info|warning|critical\", \"message\": \"...\", \"suggestion\": \"...\"}]}. No markdown fences.",
          },
          {
            role: "user",
            content: `Title: ${inputs.title}\n\nScript:\n${inputs.script.slice(0, 12000)}`,
          },
        ],
        temperature: 0.3,
      }),
    });
    if (!res.ok) throw new Error("AI review failed. Please try again.");
    const json = await res.json();
    await recordSafetyLlmCost(
      supabaseAdmin,
      userId,
      data.project_id,
      "llm_plan",
      "You are a YouTube advertiser-policy analyst.",
      `Title: ${inputs.title}`,
      json,
    );
    const text: string = json.choices?.[0]?.message?.content ?? "{}";
    const parsed = deepReviewSchema.parse(JSON.parse(text.replace(/```json?/g, "").trim()));

    const aiReview = {
      issues: parsed.issues,
      model: LLM_MODEL,
      created_at: new Date().toISOString(),
      label: "AI opinion — not a guarantee. YouTube decides monetization.",
    };

    const { error } = await supabaseAdmin
      .from("safety_scores")
      .update({ ai_review: aiReview })
      .eq("id", latest.id)
      .eq("user_id", userId);
    if (error) throw new Error("Could not save the AI review.");

    return { aiReview };
  });

const rewriteSpanSchema = z.object({
  project_id: z.string().uuid(),
  start: z.number().int().min(0),
  end: z.number().int().min(1),
});

/**
 * "Fix with AI": rewrites a flagged script span in safer wording.
 * Returns the replacement text — the client applies it to the script.
 * Costs 1 credit.
 */
export const rewriteFlaggedSpan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => rewriteSpanSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    await enforceSafetyRateLimit(supabaseAdmin, userId, "rewrite", 10);
    await debitSafetyCredit(supabaseAdmin, userId, `safety:rewrite:${data.project_id}:${data.start}`);

    const inputs = await gatherInputs(supabase, userId, data.project_id);
    if (data.end > inputs.script.length || data.start >= data.end) {
      throw new Error("Invalid text selection.");
    }
    const span = inputs.script.slice(data.start, Math.min(data.end, data.start + 500));

    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured on this project.");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          {
            role: "system",
            content:
              "Rewrite the given sentence(s) to be advertiser-friendly for YouTube: remove profanity, sexual suggestiveness, graphic detail, and sensationalism while keeping the meaning and tone. Return ONLY the rewritten text, no quotes, no explanation.",
          },
          { role: "user", content: span },
        ],
        temperature: 0.5,
      }),
    });
    if (!res.ok) throw new Error("Rewrite failed. Please try again.");
    const json = await res.json();
    await recordSafetyLlmCost(
      supabaseAdmin,
      userId,
      data.project_id,
      "llm_script",
      "Rewrite the given sentence(s) to be advertiser-friendly for YouTube.",
      span,
      json,
    );
    const rewritten: string = (json.choices?.[0]?.message?.content ?? "").trim();
    if (!rewritten) throw new Error("Rewrite came back empty. Please try again.");

    return { rewritten, start: data.start, end: data.end };
  });

const updateScriptSchema = z.object({
  project_id: z.string().uuid(),
  script: z.string().trim().min(1).max(60000),
});

/** Owner-only script update (used to apply AI safety rewrites). */
export const updateProjectScript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateScriptSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { enforcePostgresRateLimit } = await import("./rate-limit");
    await enforcePostgresRateLimit(
      supabaseAdmin,
      `safety:script-update:${userId}`,
      { max: 30, windowSeconds: 3600 },
      "You're updating the script too fast. Please wait a bit."
    );
    const { error } = await supabase
      .from("projects")
      .update({ script: data.script })
      .eq("id", data.project_id)
      .eq("user_id", userId);
    if (error) throw new Error("Couldn't save the script.");
    return { ok: true };
  });

export type { SafetyIssue };
