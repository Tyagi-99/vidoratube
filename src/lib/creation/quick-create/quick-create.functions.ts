/**
 * F23 — 30-second Quick Create: server orchestration.
 *
 * One `quick_create_runs` row per run carries `stage_states`
 * (Record<stage, QuickCreateStage> — the pinned contract) and `artifacts`
 * (script, manifest, assemble payload, captions, SEO package, enqueue
 * payload). Stages run in order; each stage is independently rerunnable
 * (checkpoint/resume by re-running the stage).
 *
 * Honesty rules:
 * - Free stages execute fully (idea scoring F8, research claim linking
 *   F11, script templating, scene split + SceneManifest via Stream E,
 *   assemble prep, QC via Stream E, captions).
 * - Paid stages (voiceover, visuals, render) NEVER fake completion:
 *   no provider key → `skipped_unconfigured`; key present but no explicit
 *   spend approval → `skipped_needs_spend_approval` with the exact
 *   ESTIMATE-labeled cost. With approval + key, the real provider call
 *   runs (TTS via the Stream D fallback chain, images via the provider
 *   module) and real artifacts are persisted.
 * - Music: `skipped_unconfigured` until a music source (BYO upload or
 *   stock-music key) exists — no silent track is presented as music.
 * - Render never auto-enqueues: the render stage prepares the exact
 *   `enqueueServerRender` payload; the actual render starts only via the
 *   explicit UI button (one enqueue path, D93). Stops at download —
 *   quick create never publishes.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import { requireAppUser } from "../../server-auth";
import { adminDb, dbList, dbOne, type AdminDb } from "../../intelligence/youtube-api.server";
import type { QuickCreateStage, QuickCreateStageStatus } from "../contracts";
import {
  QUICK_CREATE_STAGE_KEYS,
  QUICK_CREATE_STAGE_SPECS,
  estimatePaidStageCredits,
  resolvePaidStage,
  type QuickCreateStageKey,
} from "./pipeline";
import { buildQuickScript, type QuickScriptFact } from "./script";
import { planQuickScenes, scenePlansToManifest } from "./scenes";
import { buildTimelineCaptions } from "./captions";
import { buildSceneManifest } from "../video-studio/manifest";
import { qcStudioTimeline } from "../video-studio/qc";
import { scoreIdea } from "../ideas/scorer";
import { buildScoreCachePayload, buildIdeaScoreInput } from "../ideas/ideas.functions";
import { linkClaimsToSources } from "../claims/linker";

async function getAdmin(): Promise<AdminDb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return adminDb(supabaseAdmin);
}

export type QuickCreateFactInput = { text: string; title: string; url?: string | undefined };

export type QuickCreateRunRow = {
  id: string;
  user_id: string;
  project_id: string;
  topic: string;
  hook: string;
  facts: QuickCreateFactInput[];
  spend_approved: boolean;
  stage_states: Record<string, QuickCreateStage>;
  artifacts: Record<string, Json>;
  created_at: string;
  updated_at: string;
};

const RUN_COLUMNS =
  "id, user_id, project_id, topic, hook, facts, spend_approved, stage_states, artifacts, created_at, updated_at";

const factSchema = z.object({
  text: z.string().trim().min(1).max(600),
  title: z.string().trim().max(200).default(""),
  url: z.string().trim().max(2000).optional(),
});

export const startQuickCreateSchema = z.object({
  topic: z.string().trim().min(1).max(200),
  hook: z.string().trim().max(500).default(""),
  facts: z.array(factSchema).min(1).max(8),
  spendApproved: z.boolean().default(false),
});

function initialStages(): Record<string, QuickCreateStage> {
  const out: Record<string, QuickCreateStage> = {};
  for (const key of QUICK_CREATE_STAGE_KEYS) {
    out[key] = {
      stage: key,
      status: "pending",
      detail: QUICK_CREATE_STAGE_SPECS[key].blurb,
      costEstimateCredits: null,
    };
  }
  return out;
}

async function ownRun(admin: AdminDb, userId: string, runId: string): Promise<QuickCreateRunRow> {
  const run = await dbOne<QuickCreateRunRow>(
    admin
      .from("quick_create_runs")
      .select(RUN_COLUMNS)
      .eq("id", runId)
      .eq("user_id", userId)
      .single<QuickCreateRunRow>(),
  );
  if (!run) throw new Error("Quick-create run not found.");
  return run;
}

async function saveRun(
  admin: AdminDb,
  run: QuickCreateRunRow,
  patch: Partial<Pick<QuickCreateRunRow, "stage_states" | "artifacts" | "spend_approved">>,
): Promise<void> {
  const { error } = await admin
    .from("quick_create_runs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", run.id);
  if (error) throw new Error(`Could not save run state: ${error.message}`);
}

function setStage(
  run: QuickCreateRunRow,
  key: QuickCreateStageKey,
  status: QuickCreateStageStatus,
  detail: string,
  costEstimateCredits: number | null = null,
): void {
  run.stage_states[key] = { stage: key, status, detail, costEstimateCredits };
}

/** Deep-convert a manifest (whose `checkpoint` is Record<string, unknown>) to Json. */
function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

/* ------------------------------------------------------------------ */
/* startQuickCreate                                                     */
/* ------------------------------------------------------------------ */

export const startQuickCreate = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => startQuickCreateSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();

    const project = await dbOne<{ id: string }>(
      admin
        .from("projects")
        .insert({
          user_id: userId,
          title: data.topic.slice(0, 120),
          topic: data.topic,
          mode: "stock",
          aspect_ratio: "9:16",
          language: "English",
          status: "draft",
          stage: "quick_create",
          step: "Quick create started",
        })
        .select("id")
        .single<{ id: string }>(),
    );
    if (!project) throw new Error("Could not create the quick-create project.");

    const run = await dbOne<QuickCreateRunRow>(
      admin
        .from("quick_create_runs")
        .insert({
          user_id: userId,
          project_id: project.id,
          topic: data.topic,
          hook: data.hook || `Why ${data.topic.replace(/\?+\s*$/, "")}?`,
          facts: data.facts,
          spend_approved: data.spendApproved,
          stage_states: initialStages(),
          artifacts: {},
        })
        .select(RUN_COLUMNS)
        .single<QuickCreateRunRow>(),
    );
    if (!run) throw new Error("Could not create the quick-create run.");
    return { status: "ok" as const, runId: run.id, projectId: project.id };
  });

/* ------------------------------------------------------------------ */
/* getQuickCreateRun / listQuickCreateRuns                              */
/* ------------------------------------------------------------------ */

export const getQuickCreateRun = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ runId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    return { status: "ok" as const, run: await ownRun(admin, userId, data.runId) };
  });

export const listQuickCreateRuns = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    const runs = await dbList<QuickCreateRunRow>(
      admin
        .from("quick_create_runs")
        .select(RUN_COLUMNS)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(25),
    );
    return { status: "ok" as const, runs };
  });

/* ------------------------------------------------------------------ */
/* Stage executors                                                      */
/* ------------------------------------------------------------------ */

type StageCtx = { admin: AdminDb; userId: string; run: QuickCreateRunRow };

async function runIdeaStage(ctx: StageCtx): Promise<void> {
  const { admin, userId, run } = ctx;
  const researchProject = await dbOne<{ id: string }>(
    admin
      .from("research_projects")
      .insert({ user_id: userId, topic: run.topic, language: "en", niches: ["explainers"] })
      .select("id")
      .single<{ id: string }>(),
  );
  if (!researchProject) throw new Error("Could not create the research project for the idea.");

  const idea = await dbOne<{
    id: string;
    title: string;
    hook: string;
    angle: string;
    format: string;
    difficulty: string;
    safety_flag: string;
  }>(
    admin
      .from("video_ideas")
      .insert({
        user_id: userId,
        project_id: researchProject.id,
        title: run.topic,
        hook: run.hook,
        angle: "30-second explainer",
        format: "short",
        difficulty: "easy",
        safety_flag: "safe",
        status: "new",
        project_ref: run.project_id,
      })
      .select("id, title, hook, angle, format, difficulty, safety_flag")
      .single<{
        id: string;
        title: string;
        hook: string;
        angle: string;
        format: string;
        difficulty: string;
        safety_flag: string;
      }>(),
  );
  if (!idea) throw new Error("Could not create the idea.");

  // F8 deterministic scoring (no outliers in quick create — evidence noted).
  const score = scoreIdea(buildIdeaScoreInput(idea as never, []));
  await dbList(
    admin
      .from("video_ideas")
      .update({ score: buildScoreCachePayload(score), updated_at: new Date().toISOString() })
      .eq("id", idea.id)
      .select("id"),
  );
  run.artifacts = { ...run.artifacts, idea: { id: idea.id, score } };
  setStage(
    run,
    "idea",
    "done",
    `Idea scored ${score.total}/100 (${score.confidence} confidence) — deterministic F8 scoring.`,
  );
}

async function runResearchStage(ctx: StageCtx): Promise<void> {
  const { admin, userId, run } = ctx;
  // One source row per distinct URL (≥2 required by the run schema validation
  // at the UI layer; enforced here too).
  const byUrl = new Map<string, QuickCreateFactInput>();
  for (const f of run.facts) {
    if (f.url && !byUrl.has(f.url)) byUrl.set(f.url, f);
  }
  if (byUrl.size < 2) throw new Error("Quick create needs at least 2 distinct source URLs.");

  const sourceRows = await dbList<{ id: string; title: string; url: string | null }>(
    admin
      .from("research_sources")
      .insert(
        [...byUrl.values()].map((f, i) => ({
          user_id: userId,
          project_id: run.project_id,
          title: f.title || f.url || `Source ${i + 1}`,
          url: f.url ?? null,
          source_type: "web",
          excerpt: f.text,
        })),
      )
      .select("id, title, url"),
  );
  if (sourceRows.length < 2) throw new Error("Could not persist the research sources.");

  // F11: each verified fact is a claim candidate; link candidates to sources
  // by keyword overlap (sources carry the fact text as their excerpt).
  const linkable = sourceRows.map((s) => ({
    id: s.id,
    title: s.title,
    url: s.url,
    excerpt: byUrl.get(s.url ?? "")?.text ?? "",
  }));
  const linked = linkClaimsToSources(
    run.facts.map((f) => ({ text: f.text })),
    linkable,
  );
  const claimRows = linked.map((c) => {
    const matchedIds = c.matches.map((m) => m.sourceId);
    return {
      user_id: userId,
      source_id: matchedIds[0] ?? sourceRows[0]!.id,
      claim: c.claimText,
      verdict: "qualified" as const,
      evidence: {
        auto_linked: true,
        matched_source_ids: matchedIds,
        match_scores: c.matches.map((m) => m.score),
      },
      review_state: "unreviewed" as const,
    };
  });
  if (claimRows.length > 0) {
    await dbList(admin.from("research_claims").insert(claimRows).select("id"));
  }
  run.artifacts = {
    ...run.artifacts,
    research: {
      sourceIds: sourceRows.map((s) => s.id),
      claimCount: claimRows.length,
      linkedClaims: linked.map((c) => ({
        text: c.claimText,
        matchedSourceIds: c.matches.map((m) => m.sourceId),
      })),
    },
  };
  setStage(
    run,
    "research",
    "done",
    `${sourceRows.length} sources persisted, ${claimRows.length} claim candidates extracted and source-linked (awaiting human review in the Evidence Desk).`,
  );
}

async function runScriptStage(ctx: StageCtx): Promise<void> {
  const { run } = ctx;
  const facts: QuickScriptFact[] = run.facts.map((f) => ({ text: f.text, sourceIds: [] }));
  const research = run.artifacts["research"] as
    { linkedClaims?: Array<{ text: string; matchedSourceIds: string[] }> } | undefined;
  if (research?.linkedClaims) {
    for (const lc of research.linkedClaims) {
      const match = facts.find(
        (f) => lc.text.includes(f.text.slice(0, 24)) || f.text.includes(lc.text.slice(0, 24)),
      );
      if (match) match.sourceIds = lc.matchedSourceIds;
    }
  }
  const script = buildQuickScript({
    topic: run.topic,
    hook: run.hook,
    facts,
    payoff: "Follow for one surprising explanation every day.",
  });
  const { admin } = ctx;
  await dbList(
    admin
      .from("projects")
      .update({ script: script.fullText })
      .eq("id", run.project_id)
      .select("id"),
  );
  run.artifacts = { ...run.artifacts, script };
  setStage(
    run,
    "script",
    "done",
    script.inTargetWindow
      ? `Script assembled: ${script.wordCount} words ≈ ${script.durationSecEstimate.toFixed(1)}s (target 25–35s).`
      : `Script assembled: ${script.wordCount} words ≈ ${script.durationSecEstimate.toFixed(1)}s — outside the 25–35s target, review before continuing.`,
  );
}

async function runScenesStage(ctx: StageCtx): Promise<void> {
  const { admin, userId, run } = ctx;
  const script = run.artifacts["script"] as
    { fullText: string; hook: string; beats: string[]; payoff: string } | undefined;
  if (!script?.fullText) throw new Error("Run the script stage before scenes.");
  const plans = planQuickScenes(script as never, run.topic);
  if (plans.length < 5 || plans.length > 7) {
    throw new Error(`Scene split produced ${plans.length} scenes — quick create targets 5–7.`);
  }
  // Idempotent re-run: rebuild this run's scenes from scratch.
  {
    const { error: delError } = await admin
      .from("scenes")
      .delete()
      .eq("project_id", run.project_id);
    if (delError) throw new Error(`Could not clear prior scenes: ${delError.message}`);
  }
  const rows = await dbList<{ id: string; scene_number: number }>(
    admin
      .from("scenes")
      .insert(
        plans.map((p) => ({
          user_id: userId,
          project_id: run.project_id,
          scene_number: p.sceneNumber,
          narration: p.narration,
          visual_prompt: p.visualPrompt,
          duration: p.durationSecEstimate,
        })),
      )
      .select("id, scene_number"),
  );
  if (rows.length !== plans.length) throw new Error("Could not persist all scenes.");
  const manifest = scenePlansToManifest(run.project_id, plans);
  // Rebind manifest scene ids to the persisted rows (stable checkpoints).
  const byNumber = new Map(rows.map((r) => [r.scene_number, r.id]));
  const rebound = {
    ...manifest,
    scenes: manifest.scenes.map((s) => ({
      ...s,
      sceneId: byNumber.get(s.sceneNumber) ?? s.sceneId,
    })),
  };
  run.artifacts = { ...run.artifacts, scenes: { plans, manifest: toJson(rebound) } };
  setStage(
    run,
    "scenes",
    "done",
    `${plans.length} scenes persisted; pinned SceneManifest built via Stream E.`,
  );
}

/** Paid-stage gate: real provider configured? + explicit spend approval? */
async function paidGate(
  stage: QuickCreateStageKey,
  providerName: string,
  providerConfigured: boolean,
  estimateInput: Parameters<typeof estimatePaidStageCredits>[1],
  spendApproved: boolean,
): Promise<{
  proceed: boolean;
  resolution: { status: QuickCreateStageStatus; detail: string };
  costEstimateCredits: number | null;
}> {
  const costEstimateCredits = estimatePaidStageCredits(stage, estimateInput);
  const resolution = resolvePaidStage({
    providerConfigured,
    spendApproved,
    costEstimateCredits,
    providerName,
  });
  return { proceed: resolution.status === "running", resolution, costEstimateCredits };
}

async function sceneRows(ctx: StageCtx) {
  const { admin, run } = ctx;
  return dbList<{ id: string; scene_number: number; narration: string; asset_url: string | null }>(
    admin
      .from("scenes")
      .select("id, scene_number, narration, asset_url")
      .eq("project_id", run.project_id)
      .order("scene_number", { ascending: true }),
  );
}

async function runVoiceoverStage(ctx: StageCtx, spendApproved: boolean): Promise<void> {
  const { admin, userId, run } = ctx;
  const scenes = await sceneRows(ctx);
  if (scenes.length === 0) throw new Error("Run the scenes stage before voiceover.");
  const narration = scenes.map((s) => s.narration).join(" ");

  const { resolveTtsChain, synthesizeSpeechWithFallback } = await import("../voice/chain.server");
  const configured = resolveTtsChain().some((p) => p.configured());
  const gate = await paidGate(
    "voiceover",
    "TTS provider (ElevenLabs / OpenAI / Lovable AI gateway)",
    configured,
    { narrationText: narration },
    spendApproved,
  );
  if (!gate.proceed) {
    setStage(
      run,
      "voiceover",
      gate.resolution.status,
      gate.resolution.detail,
      gate.costEstimateCredits,
    );
    return;
  }

  // Real TTS — per scene, persisted to the creation bucket + voiceovers rows.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { recordApiCost } = await import("../../api-cost");
  const saved: Array<{ sceneId: number; audioUrl: string }> = [];
  for (const s of scenes) {
    const result = await synthesizeSpeechWithFallback(
      s.narration,
      { voiceId: "default", model: "default" },
      {
        costCtx: { admin: supabaseAdmin, userId, projectId: run.project_id },
        meta: { quick_create_run: run.id },
      },
    );
    if (!result.ok || !result.audio) {
      setStage(
        run,
        "voiceover",
        "failed",
        `TTS failed on scene ${s.scene_number}: ${result.error?.message ?? "unknown error"}`,
        gate.costEstimateCredits,
      );
      return;
    }
    const path = `${userId}/quick-create/${run.id}/scene-${s.scene_number}.mp3`;
    const { error: upError } = await supabaseAdmin.storage
      .from("generated-videos")
      .upload(path, result.audio, {
        contentType: "audio/mpeg",
        upsert: true,
      });
    if (upError) {
      setStage(
        run,
        "voiceover",
        "failed",
        `Could not store scene ${s.scene_number} audio: ${upError.message}`,
        gate.costEstimateCredits,
      );
      return;
    }
    const { data: signed } = await supabaseAdmin.storage
      .from("generated-videos")
      .createSignedUrl(path, 60 * 60 * 24 * 7);
    // Idempotent re-run: replace any prior voiceover for this scene.
    {
      const { error: delError } = await admin.from("voiceovers").delete().eq("scene_id", s.id);
      if (delError) throw new Error(`Could not clear prior voiceover: ${delError.message}`);
    }
    await dbList(
      admin
        .from("voiceovers")
        .insert({
          user_id: userId,
          project_id: run.project_id,
          scene_id: s.id,
          audio_url: signed?.signedUrl ?? path,
          characters: s.narration.length,
        })
        .select("id"),
    );
    try {
      if (result.unitCostUsd !== null) {
        await recordApiCost(supabaseAdmin, {
          userId,
          projectId: run.project_id,
          provider: result.provider ?? "tts",
          operation: "quick_create_voiceover",
          units: result.characters,
          unitCostUsd: result.unitCostUsd,
          meta: { scene: s.scene_number },
        });
      }
    } catch {
      /* telemetry must never fail the stage */
    }
    saved.push({ sceneId: s.scene_number, audioUrl: signed?.signedUrl ?? path });
  }
  run.artifacts = { ...run.artifacts, voiceover: { scenes: saved } };
  setStage(
    run,
    "voiceover",
    "done",
    `Real TTS complete for ${saved.length} scenes (spend approved).`,
    gate.costEstimateCredits,
  );
}

async function runVisualsStage(ctx: StageCtx, spendApproved: boolean): Promise<void> {
  const { admin, userId, run } = ctx;
  const scenes = await sceneRows(ctx);
  if (scenes.length === 0) throw new Error("Run the scenes stage before visuals.");

  const { activeImageProvider, generateImageWithTelemetry } =
    await import("../../providers/image.server");
  const provider = activeImageProvider();
  const gate = await paidGate(
    "visuals",
    "Image provider (Lovable AI gateway)",
    provider.configured(),
    { sceneCount: scenes.length },
    spendApproved,
  );
  if (!gate.proceed) {
    setStage(
      run,
      "visuals",
      gate.resolution.status,
      gate.resolution.detail,
      gate.costEstimateCredits,
    );
    return;
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const prompts =
    (run.artifacts["scenes"] as { plans?: Array<{ visualPrompt: string }> } | undefined)?.plans ??
    [];
  let done = 0;
  for (const s of scenes) {
    const prompt =
      prompts[s.scene_number - 1]?.visualPrompt ??
      `Cinematic still for: ${s.narration.slice(0, 120)}`;
    const result = await generateImageWithTelemetry(
      { prompt, aspectRatio: "9:16" },
      {
        costCtx: { admin: supabaseAdmin, userId, projectId: run.project_id },
        meta: { quick_create_run: run.id },
      },
    );
    if (!result.ok || !result.output) {
      setStage(
        run,
        "visuals",
        "failed",
        `Image generation failed on scene ${s.scene_number}: ${result.error?.message ?? "unknown error"}`,
        gate.costEstimateCredits,
      );
      return;
    }
    const path = `${userId}/quick-create/${run.id}/scene-${s.scene_number}.png`;
    const { error: upError } = await supabaseAdmin.storage
      .from("generated-videos")
      .upload(path, result.output, {
        contentType: "image/png",
        upsert: true,
      });
    if (upError) {
      setStage(
        run,
        "visuals",
        "failed",
        `Could not store scene ${s.scene_number} visual: ${upError.message}`,
        gate.costEstimateCredits,
      );
      return;
    }
    const { data: signed } = await supabaseAdmin.storage
      .from("generated-videos")
      .createSignedUrl(path, 60 * 60 * 24 * 7);
    await dbList(
      admin
        .from("scenes")
        .update({
          asset_url: signed?.signedUrl ?? path,
          asset_source: { kind: "generated", provider: provider.id, rights: "owned" },
        })
        .eq("id", s.id)
        .select("id"),
    );
    done++;
  }
  setStage(
    run,
    "visuals",
    "done",
    `Real image generation complete for ${done} scenes (spend approved).`,
    gate.costEstimateCredits,
  );
}

async function runAssembleStage(ctx: StageCtx): Promise<void> {
  const { admin, run } = ctx;
  const scenes = await sceneRows(ctx);
  if (scenes.length === 0) throw new Error("Run the scenes stage before assemble.");

  const [voiceovers, captions] = await Promise.all([
    dbList<{ scene_id: string | null; audio_url: string | null }>(
      admin.from("voiceovers").select("scene_id, audio_url").eq("project_id", run.project_id),
    ),
    dbList<{ scene_id: string | null; cues: unknown }>(
      admin.from("captions").select("scene_id, cues").eq("project_id", run.project_id),
    ),
  ]);
  const audioByScene = new Map(voiceovers.map((v) => [v.scene_id, v.audio_url]));
  const cuesByScene = new Map(
    captions.map((c) => [c.scene_id, Array.isArray(c.cues) ? c.cues : []]),
  );

  const manifest = buildSceneManifest(
    run.project_id,
    null,
    scenes.map((s) => ({
      sceneId: s.id,
      sceneNumber: s.scene_number,
      narration: s.narration,
      visualPrompt: null,
      assetUrl: s.asset_url,
      assetSource: s.asset_url
        ? { kind: "generated", provider: "quick-create", rights: "owned" }
        : {},
      durationSec: null,
      status: s.asset_url ? "assets_ready" : "draft",
      checkpoint: null,
    })),
  );
  const totalSec = manifest.scenes.reduce((a, s) => a + s.durationSecEstimate, 0);
  const renderEstimate = estimatePaidStageCredits("render", { totalSec });

  // Exact enqueueServerRender payload (same shape the studio uses) — the
  // render itself starts only via the explicit UI button (D93: one path).
  const enqueuePayload = {
    projectId: run.project_id,
    aspectRatio: "9:16",
    scenes: scenes.map((s) => ({
      id: s.id,
      number: s.scene_number,
      narration: s.narration,
      image: s.asset_url,
      audio: audioByScene.get(s.id) ?? null,
      cues: cuesByScene.get(s.id) ?? [],
    })),
  };
  run.artifacts = {
    ...run.artifacts,
    assemble: {
      manifest: toJson(manifest),
      totalSecEstimate: totalSec,
      renderEstimateCredits: renderEstimate,
      enqueuePayload,
    },
  };
  setStage(
    run,
    "assemble",
    "done",
    `Timeline assembled: ${scenes.length} scenes, ≈${totalSec.toFixed(1)}s. Manifest + exact render quote ready.`,
  );
}

async function runQcStage(ctx: StageCtx): Promise<void> {
  const { run } = ctx;
  const assemble = run.artifacts["assemble"] as
    | {
        enqueuePayload?: {
          scenes: Array<{
            id: string;
            number: number;
            narration: string;
            image: string | null;
            audio: string | null;
            cues: unknown[];
          }>;
        };
      }
    | undefined;
  const payload = assemble?.enqueuePayload;
  if (!payload) throw new Error("Run the assemble stage before QC.");
  const result = qcStudioTimeline(
    payload.scenes.map((s) => ({
      id: s.id,
      number: s.number,
      narration: s.narration,
      image: s.image,
      audio: s.audio,
      duration: 5,
      cues: [],
    })),
  );
  run.artifacts = { ...run.artifacts, qc: result };
  setStage(
    run,
    "qc",
    result.passed ? "done" : "failed",
    result.passed
      ? `QC passed (${result.checks.length} checks).`
      : `QC failed: ${result.blocking.join(", ")}. Fix the blocking checks, then re-run.`,
  );
}

async function runCaptionsStage(ctx: StageCtx): Promise<void> {
  const { admin, userId, run } = ctx;
  const scenes = await sceneRows(ctx);
  if (scenes.length === 0) throw new Error("Run the scenes stage before captions.");
  const timeline = buildTimelineCaptions(
    scenes.map((s) => ({ sceneNumber: s.scene_number, narration: s.narration })),
  );
  for (const sc of timeline.scenes) {
    const sceneId = scenes.find((s) => s.scene_number === sc.sceneNumber)?.id;
    if (!sceneId) continue;
    // Idempotent re-run: replace prior captions for this scene.
    {
      const { error: delError } = await admin.from("captions").delete().eq("scene_id", sceneId);
      if (delError) throw new Error(`Could not clear prior captions: ${delError.message}`);
    }
    await dbList(
      admin
        .from("captions")
        .insert({
          user_id: userId,
          project_id: run.project_id,
          scene_id: sceneId,
          cues: [...sc.cues.map((c) => ({ ...c, timing: "estimate" }))],
        })
        .select("id"),
    );
  }
  run.artifacts = { ...run.artifacts, captions: timeline };
  setStage(
    run,
    "captions",
    "done",
    `Word/phrase caption cues generated for ${timeline.scenes.length} scenes (≈${timeline.totalSecEstimate}s). Timing is an ESTIMATE until measured from real narration audio.`,
  );
}

async function runMusicStage(ctx: StageCtx): Promise<void> {
  const { run } = ctx;
  const music = run.artifacts["music"] as { url?: string; duckDb?: number } | undefined;
  if (music?.url) {
    setStage(
      run,
      "music",
      "done",
      `Music attached (ducked to −${music.duckDb ?? 14}dB under voiceover).`,
    );
    return;
  }
  // No music provider key / BYO upload configured in this stream — honest skip.
  setStage(
    run,
    "music",
    "skipped_unconfigured",
    "No music source configured. Upload a track (BYO) or connect a stock-music provider to enable subtle ducked music.",
  );
}

async function runRenderStage(ctx: StageCtx, spendApproved: boolean): Promise<void> {
  const { run } = ctx;
  const assemble = run.artifacts["assemble"] as
    { totalSecEstimate?: number; enqueuePayload?: unknown } | undefined;
  if (!assemble?.enqueuePayload) throw new Error("Run the assemble stage before render.");
  const totalSec = assemble.totalSecEstimate ?? 30;

  const { activeImageProvider } = await import("../../providers/image.server");
  const configured = activeImageProvider().configured();
  const gate = await paidGate(
    "render",
    "Render provider (server render pipeline)",
    configured,
    { totalSec },
    spendApproved,
  );
  if (!gate.proceed) {
    setStage(
      run,
      "render",
      gate.resolution.status,
      gate.resolution.detail,
      gate.costEstimateCredits,
    );
    return;
  }
  // Spend approved: the exact payload is ready, but the render itself only
  // starts via the explicit "Enqueue real render" button (one enqueue path,
  // D93) — the stage never auto-spends.
  setStage(
    run,
    "render",
    "done",
    `Render package ready (ESTIMATE ${gate.costEstimateCredits ?? "?"} credits). Press “Enqueue real render” to start the actual render — nothing renders until you confirm.`,
    gate.costEstimateCredits,
  );
}

/* ------------------------------------------------------------------ */
/* runQuickCreateStage                                                  */
/* ------------------------------------------------------------------ */

export const runQuickCreateStageSchema = z.object({
  runId: z.string().uuid(),
  stage: z.enum(QUICK_CREATE_STAGE_KEYS),
  spendApproved: z.boolean().optional(),
});

export const runQuickCreateStage = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => runQuickCreateStageSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    const run = await ownRun(admin, userId, data.runId);
    if (data.spendApproved !== undefined) run.spend_approved = data.spendApproved;
    const spendApproved = run.spend_approved;

    setStage(run, data.stage, "running", "Running…");
    await saveRun(admin, run, {
      stage_states: run.stage_states,
      spend_approved: run.spend_approved,
    });

    const ctx: StageCtx = { admin, userId, run };
    try {
      switch (data.stage) {
        case "idea":
          await runIdeaStage(ctx);
          break;
        case "research":
          await runResearchStage(ctx);
          break;
        case "script":
          await runScriptStage(ctx);
          break;
        case "scenes":
          await runScenesStage(ctx);
          break;
        case "voiceover":
          await runVoiceoverStage(ctx, spendApproved);
          break;
        case "visuals":
          await runVisualsStage(ctx, spendApproved);
          break;
        case "assemble":
          await runAssembleStage(ctx);
          break;
        case "qc":
          await runQcStage(ctx);
          break;
        case "captions":
          await runCaptionsStage(ctx);
          break;
        case "music":
          await runMusicStage(ctx);
          break;
        case "render":
          await runRenderStage(ctx, spendApproved);
          break;
      }
    } catch (err) {
      setStage(run, data.stage, "failed", err instanceof Error ? err.message : "Stage failed.");
    }
    await saveRun(admin, run, { stage_states: run.stage_states, artifacts: run.artifacts });
    return { status: "ok" as const, stage: run.stage_states[data.stage] };
  });
