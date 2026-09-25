import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  APPROVED_RIGHTS,
  BLOCKED_RIGHTS,
  canRenderFinal,
  type PermissionStatus,
} from "@/lib/content/stages";
import { COMMENTARY_STYLES, DURATION_PRESETS, resolveTargetDuration } from "./duration";

const rightsEnum = z.enum([
  "unknown",
  "permission_required",
  "permission_requested",
  "permission_granted",
  "permission_denied",
  "licensed",
  "owned",
  "public_domain",
  "do_not_use",
]);

const createVoiceoverSchema = z.object({
  title: z.string().trim().max(200).default(""),
  description: z.string().trim().max(4000).optional(),
  userNotes: z.string().trim().max(4000).optional(),
  rights_status: rightsEnum,
  /** Signed or public URL after client upload to generated-videos */
  source_video_url: z.string().url().max(2000).optional(),
  source_storage_path: z.string().max(400).optional(),
  source_file_name: z.string().max(260).optional(),
  source_duration_seconds: z.number().positive().max(7200).optional(),
  /** Metadata-only URL paste — never scraped/downloaded server-side */
  source_url_metadata: z.string().url().max(2000).optional(),
  duration_preset: z.union([z.enum(["15", "30", "45", "60", "120", "180"]), z.literal("custom")]),
  custom_duration_seconds: z.number().min(5).max(600).optional(),
  commentary_style: z.enum(COMMENTARY_STYLES).default("documentary"),
  aspect_ratio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
  language: z.string().trim().max(40).default("English"),
  mute_original: z.boolean().default(true),
  /** Opaque per-browser id for free-credit abuse correlation (optional). */
  device_hash: z.string().max(100).optional(),
});

const idSchema = z.object({ id: z.string().uuid() });

function mergeSettings(existing: unknown, patch: Record<string, unknown>) {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  return { ...base, ...patch };
}

export const createVoiceoverProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => createVoiceoverSchema.parse(i))
  .handler(async ({ data, context }) => {
    if (BLOCKED_RIGHTS.includes(data.rights_status as PermissionStatus)) {
      throw new Error(
        `Rights status "${data.rights_status}" cannot be used to start a voiceover project.`,
      );
    }
    if (!data.source_video_url && !data.source_url_metadata) {
      throw new Error("Upload a video file (preferred) or paste a URL for metadata only.");
    }
    if (data.source_url_metadata && !data.source_video_url) {
      // Metadata-only path: allowed to create draft, but final render stays gated.
    }
    if (data.source_storage_path && !data.source_storage_path.startsWith(`${context.userId}/`)) {
      throw new Error("Invalid upload path.");
    }

    const preset =
      data.duration_preset === "custom"
        ? "custom"
        : (Number(data.duration_preset) as (typeof DURATION_PRESETS)[number]);
    const resolved = resolveTargetDuration(preset, data.custom_duration_seconds);
    if (!resolved.ok) throw new Error(resolved.reason);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Hard global rate limit: 10 voiceover projects per hour per user.
    const { enforcePostgresRateLimit } = await import("@/lib/rate-limit");
    await enforcePostgresRateLimit(
      supabaseAdmin,
      `voiceover:create:${context.userId}`,
      { max: 10, windowSeconds: 3600 },
      "You're creating voiceovers too fast. Please wait a bit and try again.",
    );

    // Free-credit farming check.
    const { checkAbuseCluster } = await import("@/lib/abuse");
    await checkAbuseCluster(supabaseAdmin, {
      userId: context.userId,
      signalType: "voiceover_create",
      deviceHash: data.device_hash,
    });

    const title =
      data.title.trim() ||
      data.source_file_name?.replace(/\.[^.]+$/, "").slice(0, 120) ||
      "Voiceover project";

    const settings = {
      creation_mode: "voiceover",
      rights_status: data.rights_status,
      source_video_url: data.source_video_url ?? null,
      source_storage_path: data.source_storage_path ?? null,
      source_file_name: data.source_file_name ?? null,
      source_duration_seconds: data.source_duration_seconds ?? null,
      source_url_metadata: data.source_url_metadata ?? null,
      target_duration_seconds: resolved.seconds,
      commentary_style: data.commentary_style,
      trim_start: 0,
      trim_end: null,
      mute_original: data.mute_original,
      burn_captions: true,
      analysis_uncertainty: null,
    };

    const { data: project, error } = await context.supabase
      .from("projects")
      .insert({
        user_id: context.userId,
        title,
        topic: title,
        script: null,
        mode: "stock",
        preset: "documentary",
        language: data.language,
        duration_minutes: Math.max(1, Math.ceil(resolved.seconds / 60)),
        aspect_ratio: data.aspect_ratio,
        status: "draft",
        stage: "created",
        step: "Ready for commentary",
        creation_mode: "voiceover",
        settings: settings as never,
      } as never)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return project;
  });

export const updateVoiceoverDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        script: z.string().max(40000).optional(),
        title: z.string().trim().max(200).optional(),
        rights_status: rightsEnum.optional(),
        commentary_style: z.enum(COMMENTARY_STYLES).optional(),
        trim_start: z.number().min(0).max(7200).optional(),
        trim_end: z.number().min(0).max(7200).nullable().optional(),
        mute_original: z.boolean().optional(),
        burn_captions: z.boolean().optional(),
        target_duration_seconds: z.number().min(5).max(600).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: project, error } = await context.supabase
      .from("projects")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!project) throw new Error("Project not found");

    const settings = mergeSettings(project.settings, {
      ...(data.rights_status !== undefined ? { rights_status: data.rights_status } : {}),
      ...(data.commentary_style !== undefined ? { commentary_style: data.commentary_style } : {}),
      ...(data.trim_start !== undefined ? { trim_start: data.trim_start } : {}),
      ...(data.trim_end !== undefined ? { trim_end: data.trim_end } : {}),
      ...(data.mute_original !== undefined ? { mute_original: data.mute_original } : {}),
      ...(data.burn_captions !== undefined ? { burn_captions: data.burn_captions } : {}),
      ...(data.target_duration_seconds !== undefined
        ? { target_duration_seconds: data.target_duration_seconds }
        : {}),
    });

    const patch: Record<string, unknown> = { settings };
    if (data.script !== undefined) {
      patch['script'] = data.script;
      patch['narration'] = data.script;
    }
    if (data.title !== undefined) patch['title'] = data.title;

    const { data: updated, error: updErr } = await context.supabase
      .from("projects")
      .update(patch as never)
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .select()
      .single();
    if (updErr) throw new Error(updErr.message);
    return updated;
  });

export const generateVoiceoverScript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => idSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { data: project, error } = await context.supabase
      .from("projects")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!project) throw new Error("Project not found");

    const { generateCommentaryScript, readMode2Settings } = await import("./mode2.server");
    const settings = readMode2Settings(project.settings);
    const target =
      settings.target_duration_seconds ??
      Math.max(15, (project.duration_minutes || 1) * 60);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 30 script generations per hour per user (LLM spend).
    const { enforcePostgresRateLimit } = await import("@/lib/rate-limit");
    await enforcePostgresRateLimit(
      supabaseAdmin,
      `voiceover:script:${context.userId}`,
      { max: 30, windowSeconds: 3600 },
      "You're generating scripts too fast. Please wait a bit and try again.",
    );

    // 1 credit per project, charged once no matter which billable step runs
    // first (idempotent on the project id). Charged BEFORE the provider call.
    const { debitOneCreditForProject } = await import("@/lib/credits");
    await debitOneCreditForProject(
      supabaseAdmin,
      context.userId,
      project.id,
      `Voiceover project: ${project.title}`,
    );

    const plan = await generateCommentaryScript(
      {
        title: project.title,
        description: typeof settings.source_file_name === "string" ? settings.source_file_name : null,
        userNotes: project.topic,
        style: String(settings.commentary_style || "documentary"),
        targetSeconds: target,
        sourceDurationSeconds: settings.source_duration_seconds ?? null,
        language: project.language,
      },
      { admin: supabaseAdmin, userId: context.userId, projectId: project.id },
    );

    const nextSettings = mergeSettings(project.settings, {
      analysis_uncertainty: plan.uncertainty,
      beats: plan.beats,
    });

    const { data: updated, error: updErr } = await context.supabase
      .from("projects")
      .update({
        title: plan.title,
        script: plan.script,
        narration: plan.script,
        stage: "script",
        step: "Edit commentary script",
        settings: nextSettings as never,
      } as never)
      .eq("id", data.id)
      .select()
      .single();
    if (updErr) throw new Error(updErr.message);
    return { project: updated, uncertainty: plan.uncertainty };
  });

export const synthesizeVoiceoverAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        voice_id: z.string().max(80).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: project, error } = await context.supabase
      .from("projects")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!project) throw new Error("Project not found");
    const script = (project.script || project.narration || "").trim();
    if (!script) throw new Error("Write or generate a commentary script first.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { synthesizeProjectVoiceover, readMode2Settings } = await import("./mode2.server");
    const settings = readMode2Settings(project.settings);

    // 30 TTS syntheses per hour per user (ElevenLabs spend).
    const { enforcePostgresRateLimit } = await import("@/lib/rate-limit");
    await enforcePostgresRateLimit(
      supabaseAdmin,
      `voiceover:tts:${context.userId}`,
      { max: 30, windowSeconds: 3600 },
      "You're synthesizing voiceovers too fast. Please wait a bit and try again.",
    );

    // 1 credit per project; no-op when generateVoiceoverScript already charged
    // it (idempotent on the project id). Charged BEFORE the provider call.
    const { debitOneCreditForProject } = await import("@/lib/credits");
    await debitOneCreditForProject(
      supabaseAdmin,
      context.userId,
      project.id,
      `Voiceover project: ${project.title}`,
    );

    const voiceArgs: {
      userId: string;
      projectId: string;
      script: string;
      voiceId?: string;
      model?: string;
    } = {
      userId: context.userId,
      projectId: project.id,
      script,
    };
    const voiceId = data.voice_id || settings.voice_id;
    if (voiceId) voiceArgs.voiceId = voiceId;
    if (settings.voice_model) voiceArgs.model = settings.voice_model;
    const voice = await synthesizeProjectVoiceover(supabaseAdmin, voiceArgs);

    const nextSettings = mergeSettings(project.settings, {
      voice_id: data.voice_id || settings.voice_id,
    });

    const { data: updated, error: updErr } = await context.supabase
      .from("projects")
      .update({
        audio_url: voice.url,
        stage: "voice",
        step: "Voiceover ready",
        settings: nextSettings as never,
      } as never)
      .eq("id", data.id)
      .select()
      .single();
    if (updErr) throw new Error(updErr.message);
    return { project: updated, duration: voice.duration, audio_url: voice.url };
  });

export const generateVoiceoverCaptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => idSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { data: project, error } = await context.supabase
      .from("projects")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!project) throw new Error("Project not found");
    const script = (project.script || project.narration || "").trim();
    if (!script) throw new Error("Script required for captions.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { saveProjectCaptions, readMode2Settings } = await import("./mode2.server");
    const settings = readMode2Settings(project.settings);
    const duration =
      settings.target_duration_seconds ??
      Math.max(15, (project.duration_minutes || 1) * 60);

    // Prefer measured VO duration when available
    const { data: vos } = await context.supabase
      .from("voiceovers")
      .select("duration")
      .eq("project_id", project.id)
      .order("created_at", { ascending: false })
      .limit(1);
    const voDuration = Number(vos?.[0]?.duration) || duration;

    const cues = await saveProjectCaptions(supabaseAdmin, {
      userId: context.userId,
      projectId: project.id,
      script,
      duration: voDuration,
      style: String(settings.commentary_style || "documentary"),
    });

    const { data: updated, error: updErr } = await context.supabase
      .from("projects")
      .update({
        stage: "captions",
        step: "Captions ready",
      } as never)
      .eq("id", data.id)
      .select()
      .single();
    if (updErr) throw new Error(updErr.message);
    return { project: updated, cues };
  });

export const completeVoiceoverRender = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        path: z.string().max(400),
        file_size: z.number().int().nonnegative(),
        duration: z.number().nonnegative(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    if (!data.path.startsWith(`${context.userId}/`)) throw new Error("Invalid upload path");

    const { data: project, error } = await context.supabase
      .from("projects")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!project) throw new Error("Project not found");

    const { readMode2Settings } = await import("./mode2.server");
    const settings = readMode2Settings(project.settings);
    const rights = (settings.rights_status || "unknown") as PermissionStatus;
    const gate = canRenderFinal(rights);
    if (!gate.ok) throw new Error(gate.reason);

    const { data: signed, error: signError } = await context.supabase.storage
      .from("generated-videos")
      .createSignedUrl(data.path, 60 * 60 * 24 * 365);
    if (signError || !signed) throw new Error(signError?.message || "Could not sign result URL");

    const { data: updated, error: updErr } = await context.supabase
      .from("projects")
      .update({
        result_url: signed.signedUrl,
        status: "completed",
        stage: "done",
        step: "Final MP4 ready",
        error: null,
      } as never)
      .eq("id", data.id)
      .select()
      .single();
    if (updErr) throw new Error(updErr.message);
    return updated;
  });

export const getVoiceoverRightsGate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => idSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { data: project, error } = await context.supabase
      .from("projects")
      .select("settings, result_url, status")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!project) throw new Error("Project not found");
    const { readMode2Settings } = await import("./mode2.server");
    const settings = readMode2Settings(project.settings);
    const rights = (settings.rights_status || "unknown") as PermissionStatus;
    return {
      rights_status: rights,
      gate: canRenderFinal(rights),
      approved: APPROVED_RIGHTS,
      blocked: BLOCKED_RIGHTS,
      result_url: project.result_url,
      status: project.status,
    };
  });
