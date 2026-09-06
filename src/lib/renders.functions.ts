import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SIGNED_URL_TTL = 60 * 60 * 24 * 365;

const idSchema = z.object({ id: z.string().uuid() });

export const listRenders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ projectId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("renders")
      .select("*")
      .eq("project_id", data.projectId)
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const startRender = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        type: z.enum(["full", "scene", "preview"]).default("full"),
        aspect_ratio: z.string().max(10).default("16:9"),
        resolution: z.string().max(16).default("1920x1080"),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: project } = await context.supabase
      .from("projects")
      .select("id")
      .eq("id", data.projectId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!project) throw new Error("Project not found");

    const { data: row, error } = await context.supabase
      .from("renders")
      .insert({
        user_id: context.userId,
        project_id: data.projectId,
        type: data.type,
        engine: "browser_ffmpeg",
        format: "mp4",
        status: "running",
        stage: "init",
        progress: 0,
        aspect_ratio: data.aspect_ratio,
        resolution: data.resolution,
        render_started_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateRenderProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({ id: z.string().uuid(), stage: z.string().max(40), progress: z.number().min(0).max(100) })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("renders")
      .update({ stage: data.stage, progress: Math.round(data.progress) })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const completeRender = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        path: z.string().max(400),
        file_size: z.number().int().nonnegative(),
        duration: z.number().nonnegative(),
        resolution: z.string().max(16),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    if (!data.path.startsWith(`${context.userId}/`)) throw new Error("Invalid upload path");

    const { data: signed, error: signError } = await context.supabase.storage
      .from("generated-videos")
      .createSignedUrl(data.path, SIGNED_URL_TTL);
    if (signError) throw new Error(signError.message);

    const { data: row, error } = await context.supabase
      .from("renders")
      .update({
        status: "completed",
        stage: "done",
        progress: 100,
        file_url: signed?.signedUrl ?? null,
        file_size: data.file_size,
        duration: data.duration,
        resolution: data.resolution,
        error: null,
        render_completed_at: new Date().toISOString(),
        meta: { path: data.path },
      })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    // Studio path: promote finished render URL onto the project when missing.
    if (row?.project_id && row.file_url) {
      await context.supabase
        .from("projects")
        .update({ result_url: row.file_url })
        .eq("id", row.project_id)
        .eq("user_id", context.userId)
        .is("result_url", null);
    }

    return row;
  });

export const failRender = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ id: z.string().uuid(), error: z.string().max(1000), cancelled: z.boolean().default(false) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("renders")
      .update({
        status: data.cancelled ? "cancelled" : "failed",
        error: data.error.slice(0, 1000),
        render_completed_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const refreshRenderUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => idSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("renders")
      .select("meta")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    const path = (row?.meta as { path?: string } | null)?.path;
    if (!path) throw new Error("This render has no stored file");
    const { data: signed, error } = await context.supabase.storage
      .from("generated-videos")
      .createSignedUrl(path, SIGNED_URL_TTL);
    if (error) throw new Error(error.message);
    await context.supabase
      .from("renders")
      .update({ file_url: signed?.signedUrl ?? null })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    return { url: signed?.signedUrl ?? null };
  });
