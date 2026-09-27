/**
 * F20 Video Studio — per-scene regeneration cores (SERVER-ONLY).
 *
 * Plain async functions (not server fns) so both the studio server fns and
 * the F21 scene-repair path share them. Paid ops go through the preflight
 * gate; providers return the pinned {@link ProviderResult} envelope (never
 * throw); debits happen BEFORE the provider call and are refunded when the
 * provider fails (no blind paid retries — one attempt, then the error
 * surfaces in the envelope).
 *
 * Regenerating ONE scene writes a new `scene_versions` row and updates the
 * live scene row — it never re-renders the whole video for a scene fix.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { preflightCreditsCheck } from "../../credits/preflight.server";
import {
  synthesizeWithTelemetry,
  mp3Duration,
  DEFAULT_VOICE_ID,
  DEFAULT_VOICE_MODEL,
} from "../../providers/voice.server";
import { generateImageWithTelemetry } from "../../providers/image.server";
import type { ProviderResult } from "../../providers/contracts";
import { asStudioDb } from "./tables";

// NOTE: no node:crypto import — the universal Web Crypto API instead
// (this module is server-only, but the convention keeps it portable).
const randomUUID = () => crypto.randomUUID();

/** Storage bucket for scene-level regen assets (existing bucket, new prefix). */
export const SCENE_ASSET_BUCKET = "generated-videos";
/** Signed-URL TTL for scene assets: 1 year, matching the voiceover flows. */
export const SCENE_ASSET_URL_TTL = 60 * 60 * 24 * 365;

/**
 * Debit an exact credit amount, idempotent per ref. The preflight ESTIMATE
 * is priced in credits (USD-per-char → credits), so the debit uses the
 * credit-amount RPC — NOT the per-minute render RPC.
 */
async function debitCreditsOnce(
  admin: SupabaseClient<Database>,
  userId: string,
  amount: number,
  reason: string,
  refId: string,
): Promise<void> {
  const { error } = await admin.rpc("debit_credits_amount_once", {
    p_user_id: userId,
    p_amount: Math.max(1, Math.ceil(amount)),
    p_reason: reason,
    p_ref_id: refId,
  });
  if (error) {
    const msg = error.message ?? String(error);
    if (msg.includes("INSUFFICIENT_CREDITS")) {
      throw new Error(
        `Not enough credits for this regeneration (needs ~${Math.ceil(amount)}). Top up to continue.`,
      );
    }
    throw new Error(msg);
  }
}

/** Refund an exact credit amount, idempotent per ref (provider failed). */
async function refundCreditsOnce(
  admin: SupabaseClient<Database>,
  userId: string,
  amount: number,
  reason: string,
  refId: string,
): Promise<void> {
  const { error } = await admin.rpc("grant_credits_once", {
    p_user_id: userId,
    p_amount: Math.max(1, Math.ceil(amount)),
    p_reason: reason,
    p_ref_id: refId,
  });
  if (error) throw new Error(error.message);
}

export interface RegenAudioResult {
  audioUrl: string;
  /** Measured from the MP3 when parseable, otherwise a words-per-minute ESTIMATE. */
  durationSec: number;
  durationEstimated: boolean;
  versionNumber: number;
  costEstimateCredits: number;
}

export interface RegenVisualResult {
  assetUrl: string;
  versionNumber: number;
  costEstimateCredits: number;
}

type SceneRow = {
  id: string;
  project_id: string;
  user_id: string;
  scene_number: number;
  narration: string;
  visual_prompt: string | null;
  asset_url: string | null;
};

function failResult<T>(code: string, message: string, model: string): ProviderResult<T> {
  return {
    ok: false,
    output: null,
    model,
    taskId: null,
    latencyMs: 0,
    estimatedCost: null,
    actualCost: null,
    costCurrency: "credits",
    status: "error",
    error: { code, message },
    usage: {},
  };
}

async function loadOwnedScene(
  admin: SupabaseClient<Database>,
  userId: string,
  sceneId: string,
): Promise<SceneRow> {
  const { data, error } = await admin
    .from("scenes")
    .select("id,project_id,user_id,scene_number,narration,visual_prompt,asset_url")
    .eq("id", sceneId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Scene not found");
  return data as SceneRow;
}

async function nextVersionNumber(
  admin: SupabaseClient<Database>,
  sceneId: string,
): Promise<number> {
  const db = asStudioDb(admin);
  const { data, error } = await db
    .from("scene_versions")
    .select("version_number")
    .eq("scene_id", sceneId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.version_number ?? 0) + 1;
}

async function uploadSceneAsset(
  admin: SupabaseClient<Database>,
  userId: string,
  sceneId: string,
  versionNumber: number,
  kind: "narration" | "visual",
  bytes: Uint8Array,
  contentType: string,
): Promise<string> {
  const ext = contentType.includes("png") ? "png" : contentType.includes("audio") ? "mp3" : "jpg";
  const path = `${userId}/scene-assets/${sceneId}/${kind}-v${versionNumber}.${ext}`;
  const { error: uploadError } = await admin.storage
    .from(SCENE_ASSET_BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  if (uploadError) throw new Error(`Asset upload failed: ${uploadError.message}`);
  const { data: signed, error: signError } = await admin.storage
    .from(SCENE_ASSET_BUCKET)
    .createSignedUrl(path, SCENE_ASSET_URL_TTL);
  if (signError || !signed?.signedUrl) {
    throw new Error(signError?.message ?? "Could not sign asset URL");
  }
  return signed.signedUrl;
}

/**
 * Regenerate ONE scene's narration audio. Returns the pinned ProviderResult —
 * the provider is never retried blindly; on provider failure the debit is
 * refunded and the error surfaces in the envelope.
 */
export async function regenerateSceneAudioCore(
  admin: SupabaseClient<Database>,
  userId: string,
  sceneId: string,
  opts: { voiceId?: string; voiceModel?: string } = {},
): Promise<ProviderResult<RegenAudioResult>> {
  const voiceId = opts.voiceId ?? DEFAULT_VOICE_ID;
  const voiceModel = opts.voiceModel ?? DEFAULT_VOICE_MODEL;
  const fail = (code: string, message: string) =>
    failResult<RegenAudioResult>(code, message, voiceModel);

  let scene: SceneRow;
  try {
    scene = await loadOwnedScene(admin, userId, sceneId);
  } catch (e) {
    return fail("scene_not_found", e instanceof Error ? e.message : "Scene not found");
  }
  const narration = scene.narration.trim();
  if (!narration) return fail("empty_narration", "Scene has no narration text to synthesize");

  // Paid-op gate: ESTIMATE → balance → budget. Never runs blind.
  const preflight = await preflightCreditsCheck(admin, {
    userId,
    projectId: scene.project_id,
    jobType: "tts",
    provider: "elevenlabs",
    model: voiceModel,
    characters: narration.length,
  });
  if (!preflight.ok) return fail(preflight.code, preflight.message);
  const estimateCredits = preflight.estimate.credits;

  const debitRef = randomUUID();
  const refundRef = randomUUID();
  try {
    // Debit BEFORE the provider call (convention); refunded on failure.
    await debitCreditsOnce(
      admin,
      userId,
      estimateCredits,
      `Scene ${scene.scene_number} narration regen`,
      debitRef,
    );
  } catch (e) {
    return fail("debit_failed", e instanceof Error ? e.message : "Credit debit failed");
  }

  const result = await synthesizeWithTelemetry(
    narration,
    { voiceId, model: voiceModel },
    {
      meta: {
        scene_id: sceneId,
        project_id: scene.project_id,
        operation: "scene_narration_regen",
      },
    },
  );
  if (!result.ok || !result.output) {
    await refundCreditsOnce(
      admin,
      userId,
      estimateCredits,
      `Refund: failed scene ${scene.scene_number} narration regen`,
      refundRef,
    ).catch(() => undefined);
    return fail(result.error?.code ?? "tts_failed", result.error?.message ?? "TTS provider failed");
  }

  try {
    const versionNumber = await nextVersionNumber(admin, sceneId);
    const audioUrl = await uploadSceneAsset(
      admin,
      userId,
      sceneId,
      versionNumber,
      "narration",
      new Uint8Array(result.output),
      "audio/mpeg",
    );

    // voiceovers: one live row per scene (update if present, else insert).
    const { data: existing } = await admin
      .from("voiceovers")
      .select("id")
      .eq("scene_id", sceneId)
      .maybeSingle();
    const measured = mp3Duration(result.output, narration);
    const estimated = measured <= 0;
    const durationSec = estimated ? (narration.split(/\s+/).length / 150) * 60 + 0.5 : measured;
    if (existing) {
      const { error } = await admin
        .from("voiceovers")
        .update({
          audio_url: audioUrl,
          duration: durationSec,
          characters: narration.length,
          voice_id: voiceId,
          model: voiceModel,
        })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await admin.from("voiceovers").insert({
        project_id: scene.project_id,
        scene_id: sceneId,
        user_id: userId,
        audio_url: audioUrl,
        duration: durationSec,
        characters: narration.length,
        voice_id: voiceId,
        model: voiceModel,
      });
      if (error) throw new Error(error.message);
    }

    await asStudioDb(admin)
      .from("scene_versions")
      .insert({
        scene_id: sceneId,
        version_number: versionNumber,
        narration,
        visual_prompt: scene.visual_prompt,
        asset_url: scene.asset_url,
        change_note: `narration audio regenerated (voice ${voiceId}, ${voiceModel})`,
        created_by: userId,
      });

    return {
      ok: true,
      output: {
        audioUrl,
        durationSec,
        durationEstimated: estimated,
        versionNumber,
        costEstimateCredits: estimateCredits,
      },
      model: voiceModel,
      taskId: result.taskId,
      latencyMs: result.latencyMs,
      estimatedCost: estimateCredits,
      actualCost: result.actualCost,
      costCurrency: "credits",
      status: "ok",
      error: null,
      usage: result.usage,
    };
  } catch (e) {
    await refundCreditsOnce(
      admin,
      userId,
      estimateCredits,
      `Refund: failed scene ${scene.scene_number} narration regen`,
      refundRef,
    ).catch(() => undefined);
    return fail("regen_failed", e instanceof Error ? e.message : "Narration regen failed");
  }
}

/**
 * Regenerate ONE scene's visual. Same paid-op discipline as audio regen.
 */
export async function regenerateSceneVisualCore(
  admin: SupabaseClient<Database>,
  userId: string,
  sceneId: string,
  opts: { prompt?: string } = {},
): Promise<ProviderResult<RegenVisualResult>> {
  const fail = (code: string, message: string) =>
    failResult<RegenVisualResult>(code, message, "google/gemini-2.5-flash-image");

  let scene: SceneRow;
  try {
    scene = await loadOwnedScene(admin, userId, sceneId);
  } catch (e) {
    return fail("scene_not_found", e instanceof Error ? e.message : "Scene not found");
  }
  const prompt = opts.prompt?.trim() || scene.visual_prompt?.trim() || scene.narration.trim();
  if (!prompt)
    return fail("empty_prompt", "Scene has no visual prompt or narration to generate from");

  // Match the project's aspect so the regenerated visual fits the timeline.
  const { data: project } = await admin
    .from("projects")
    .select("aspect_ratio")
    .eq("id", scene.project_id)
    .maybeSingle();
  const aspectRatio = (project as { aspect_ratio?: string } | null)?.aspect_ratio ?? "16:9";

  const preflight = await preflightCreditsCheck(admin, {
    userId,
    projectId: scene.project_id,
    jobType: "image",
    provider: "lovable-ai",
    scenes: 1,
  });
  if (!preflight.ok) return fail(preflight.code, preflight.message);
  const estimateCredits = preflight.estimate.credits;

  const debitRef = randomUUID();
  const refundRef = randomUUID();
  try {
    await debitCreditsOnce(
      admin,
      userId,
      estimateCredits,
      `Scene ${scene.scene_number} visual regen`,
      debitRef,
    );
  } catch (e) {
    return fail("debit_failed", e instanceof Error ? e.message : "Credit debit failed");
  }

  const result = await generateImageWithTelemetry(
    { prompt, aspectRatio },
    { meta: { scene_id: sceneId, project_id: scene.project_id, operation: "scene_visual_regen" } },
  );
  if (!result.ok || !result.output) {
    await refundCreditsOnce(
      admin,
      userId,
      estimateCredits,
      `Refund: failed scene ${scene.scene_number} visual regen`,
      refundRef,
    ).catch(() => undefined);
    return fail(
      result.error?.code ?? "image_failed",
      result.error?.message ?? "Image provider failed",
    );
  }

  try {
    const versionNumber = await nextVersionNumber(admin, sceneId);
    const assetUrl = await uploadSceneAsset(
      admin,
      userId,
      sceneId,
      versionNumber,
      "visual",
      new Uint8Array(result.output),
      "image/png",
    );

    const { error: sceneError } = await admin
      .from("scenes")
      .update({
        asset_url: assetUrl,
        asset_thumb_url: assetUrl,
        visual_type: "AI_IMAGE",
        status: "assets_ready",
        updated_at: new Date().toISOString(),
      })
      .eq("id", sceneId);
    if (sceneError) throw new Error(sceneError.message);

    await asStudioDb(admin).from("scene_versions").insert({
      scene_id: sceneId,
      version_number: versionNumber,
      narration: scene.narration,
      visual_prompt: prompt,
      asset_url: assetUrl,
      change_note: "visual regenerated",
      created_by: userId,
    });

    return {
      ok: true,
      output: { assetUrl, versionNumber, costEstimateCredits: estimateCredits },
      model: result.model,
      taskId: result.taskId,
      latencyMs: result.latencyMs,
      estimatedCost: estimateCredits,
      actualCost: result.actualCost,
      costCurrency: "credits",
      status: "ok",
      error: null,
      usage: result.usage,
    };
  } catch (e) {
    await refundCreditsOnce(
      admin,
      userId,
      estimateCredits,
      `Refund: failed scene ${scene.scene_number} visual regen`,
      refundRef,
    ).catch(() => undefined);
    return fail("regen_failed", e instanceof Error ? e.message : "Visual regen failed");
  }
}

/**
 * Recompute a scene's timing ESTIMATE (repair kind "timing" — no provider
 * spend, no preflight needed).
 */
export async function recomputeSceneTimingCore(
  admin: SupabaseClient<Database>,
  userId: string,
  sceneId: string,
  durationSec: number,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const scene = await loadOwnedScene(admin, userId, sceneId);
    if (!(durationSec > 0) || durationSec > 600) {
      return { ok: false, error: "Duration must be between 0 and 600 seconds" };
    }
    const { error } = await admin
      .from("scenes")
      .update({ duration: durationSec, updated_at: new Date().toISOString() })
      .eq("id", sceneId);
    if (error) throw new Error(error.message);
    const versionNumber = await nextVersionNumber(admin, sceneId);
    await asStudioDb(admin)
      .from("scene_versions")
      .insert({
        scene_id: sceneId,
        version_number: versionNumber,
        narration: scene.narration,
        visual_prompt: scene.visual_prompt,
        asset_url: scene.asset_url,
        change_note: `timing adjusted to ${durationSec}s ESTIMATE`,
        created_by: userId,
      });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Timing update failed" };
  }
}
