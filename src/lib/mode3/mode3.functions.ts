import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  APPROVED_RIGHTS,
  BLOCKED_RIGHTS,
  canRenderFinal,
  type PermissionStatus,
} from "@/lib/content/stages";
import { DURATION_PRESETS, resolveTargetDuration } from "@/lib/mode2/duration";
import { planHeuristicEdit } from "./heuristic";
import type { AutoEditPlan } from "./provider";

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

const createAutoEditSchema = z.object({
  title: z.string().trim().max(200).default(""),
  userNotes: z.string().trim().max(4000).optional(),
  rights_status: rightsEnum,
  source_video_url: z.string().url().max(2000),
  source_storage_path: z.string().max(400).optional(),
  source_file_name: z.string().max(260).optional(),
  source_duration_seconds: z.number().positive().max(7200).optional(),
  duration_preset: z.union([
    z.enum(["15", "30", "45", "60", "120", "180"]),
    z.literal("custom"),
  ]),
  custom_duration_seconds: z.number().min(5).max(600).optional(),
  aspect_ratio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
  language: z.string().trim().max(40).default("English"),
  burn_captions: z.boolean().default(true),
  enable_voiceover: z.boolean().default(false),
  mute_original: z.boolean().default(false),
});

const idSchema = z.object({ id: z.string().uuid() });

function mergeSettings(existing: unknown, patch: Record<string, unknown>) {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  return { ...base, ...patch };
}

export const createAutoEditProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => createAutoEditSchema.parse(i))
  .handler(async ({ data, context }) => {
    if (BLOCKED_RIGHTS.includes(data.rights_status as PermissionStatus)) {
      throw new Error(
        `Rights status "${data.rights_status}" cannot be used to start an automatic edit.`,
      );
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

    const sourceDuration = data.source_duration_seconds ?? resolved.seconds;
    const plan = planHeuristicEdit({
      sourceDurationSeconds: sourceDuration,
      targetDurationSeconds: resolved.seconds,
      aspect: data.aspect_ratio,
      burnCaptions: data.burn_captions,
      enableVoiceover: data.enable_voiceover,
      notes: data.userNotes ?? null,
      title: data.title,
    });

    const title =
      data.title.trim() ||
      data.source_file_name?.replace(/\.[^.]+$/, "").slice(0, 120) ||
      "Automatic edit";

    const settings = {
      creation_mode: "auto_edit" as const,
      rights_status: data.rights_status,
      source_video_url: data.source_video_url,
      source_storage_path: data.source_storage_path ?? null,
      source_file_name: data.source_file_name ?? null,
      source_duration_seconds: data.source_duration_seconds ?? null,
      target_duration_seconds: resolved.seconds,
      trim_start: plan.trimStart,
      trim_end: plan.trimEnd,
      mute_original: data.mute_original,
      burn_captions: data.burn_captions,
      enable_voiceover: data.enable_voiceover,
      auto_edit_provider: plan.providerId,
      auto_edit_plan: plan,
    };

    const { data: project, error } = await context.supabase
      .from("projects")
      .insert({
        user_id: context.userId,
        title,
        topic: title,
        script: data.enable_voiceover
          ? data.userNotes?.trim() || null
          : plan.cues.map((c) => c.text).join(". ") || null,
        narration: plan.cues.map((c) => c.text).join(" ") || null,
        mode: "stock",
        preset: "documentary",
        language: data.language,
        duration_minutes: Math.max(1, Math.ceil(resolved.seconds / 60)),
        aspect_ratio: data.aspect_ratio,
        status: "draft",
        stage: "created",
        step: "Auto-edit plan ready",
        creation_mode: "auto_edit",
        settings: settings as never,
      } as never)
      .select()
      .single();
    if (error) throw new Error(error.message);

    // Persist caption cues when burn is on (no VO path still wants overlays).
    if (data.burn_captions && plan.cues.length) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("captions").delete().eq("project_id", project.id);
      await supabaseAdmin.from("captions").insert({
        project_id: project.id,
        scene_id: null,
        user_id: context.userId,
        style: "classic",
        cues: plan.cues as never,
      } as never);
    }

    return { project, plan };
  });

export const replanAutoEdit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        target_duration_seconds: z.number().min(5).max(600).optional(),
        burn_captions: z.boolean().optional(),
        enable_voiceover: z.boolean().optional(),
        mute_original: z.boolean().optional(),
        rights_status: rightsEnum.optional(),
        userNotes: z.string().trim().max(4000).optional(),
        script: z.string().max(40000).optional(),
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

    const prev =
      project.settings && typeof project.settings === "object"
        ? (project.settings as Record<string, unknown>)
        : {};

    const sourceDuration =
      Number(prev['source_duration_seconds']) > 0
        ? Number(prev['source_duration_seconds'])
        : Number(data.target_duration_seconds) || 60;
    const target =
      data.target_duration_seconds != null
        ? data.target_duration_seconds
        : Number(prev['target_duration_seconds']) || 60;
    const burn =
      data.burn_captions != null ? data.burn_captions : prev['burn_captions'] !== false;
    const enableVo =
      data.enable_voiceover != null
        ? data.enable_voiceover
        : Boolean(prev['enable_voiceover']);

    const plan = planHeuristicEdit({
      sourceDurationSeconds: sourceDuration,
      targetDurationSeconds: target,
      aspect: String(project.aspect_ratio || "16:9"),
      burnCaptions: burn,
      enableVoiceover: enableVo,
      notes: data.userNotes ?? data.script ?? (typeof project.script === "string" ? project.script : null),
      title: project.title,
    });

    const nextSettings = mergeSettings(project.settings, {
      creation_mode: "auto_edit",
      target_duration_seconds: target,
      trim_start: plan.trimStart,
      trim_end: plan.trimEnd,
      burn_captions: burn,
      enable_voiceover: enableVo,
      mute_original:
        data.mute_original ??
        (prev['mute_original'] !== undefined ? prev['mute_original'] : !enableVo),
      auto_edit_provider: plan.providerId,
      auto_edit_plan: plan,
      ...(data.rights_status ? { rights_status: data.rights_status } : {}),
    });

    const { data: updated, error: updErr } = await context.supabase
      .from("projects")
      .update({
        script: data.script !== undefined ? data.script : project.script,
        settings: nextSettings as never,
        stage: "created",
        step: "Auto-edit plan ready",
      } as never)
      .eq("id", data.id)
      .select()
      .single();
    if (updErr) throw new Error(updErr.message);

    if (burn && plan.cues.length) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("captions").delete().eq("project_id", project.id);
      await supabaseAdmin.from("captions").insert({
        project_id: project.id,
        scene_id: null,
        user_id: context.userId,
        style: "classic",
        cues: plan.cues as never,
      } as never);
    }

    return { project: updated, plan };
  });

export const completeAutoEditRender = createServerFn({ method: "POST" })
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

    const settings =
      project.settings && typeof project.settings === "object"
        ? (project.settings as Record<string, unknown>)
        : {};
    const rights = (String(settings['rights_status'] || "unknown") as PermissionStatus);
    const gate = canRenderFinal(rights);
    if (!gate.ok) throw new Error(gate.reason);

    const { data: signed, error: signError } = await context.supabase.storage
      .from("generated-videos")
      .createSignedUrl(data.path, 60 * 60 * 24 * 365);
    if (signError || !signed) throw new Error(signError?.message || "Could not sign result URL");

    const nextSettings = mergeSettings(project.settings, {
      last_render_bytes: data.file_size,
      last_render_duration: data.duration,
    });

    const { data: updated, error: updErr } = await context.supabase
      .from("projects")
      .update({
        result_url: signed.signedUrl,
        status: "completed",
        stage: "done",
        step: "Final MP4 ready",
        error: null,
        settings: nextSettings as never,
      } as never)
      .eq("id", data.id)
      .select()
      .single();
    if (updErr) throw new Error(updErr.message);
    return updated;
  });

export const getAutoEditRightsGate = createServerFn({ method: "GET" })
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
    const settings =
      project.settings && typeof project.settings === "object"
        ? (project.settings as Record<string, unknown>)
        : {};
    const rights = (String(settings['rights_status'] || "unknown") as PermissionStatus);
    return {
      rights_status: rights,
      gate: canRenderFinal(rights),
      approved: APPROVED_RIGHTS,
      blocked: BLOCKED_RIGHTS,
      result_url: project.result_url,
      status: project.status,
      plan: (settings['auto_edit_plan'] as AutoEditPlan | undefined) ?? null,
    };
  });
