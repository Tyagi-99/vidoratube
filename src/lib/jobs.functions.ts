import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { generateVideoPlan } from "./jobs.server";
import {
  looksLikeMp4,
  nextStageAfterVisuals,
  validateClientFinalizeMeta,
} from "./jobs/final-video";

export const getMyAccount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: profile }, { data: roles }, { count }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("video_jobs").select("id", { count: "exact", head: true }).eq("user_id", userId),
    ]);

    return {
      profile,
      isAdmin: (roles ?? []).some((r) => r.role === "admin"),
      jobCount: count ?? 0,
    };
  });

export const listMyJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("video_jobs")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getMyJob = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: job, error } = await context.supabase
      .from("video_jobs")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return job;
  });

const createSchema = z.object({
  script: z.string().trim().min(20, "Script needs at least 20 characters").max(12000),
  voice: z.string().trim().min(1).max(40),
  format: z.string().trim().min(1).max(40),
});

/** Step 1 — reserve a credit, write the plan (title, narration, scenes). */
export const createVideoJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("credits, status")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) throw new Error(profileError.message);
    if (!profile) throw new Error("Profile not found");
    if (profile.status === "suspended") throw new Error("Your account is suspended.");
    if (profile.credits < 1)
      throw new Error("You're out of credits. Upgrade your plan to keep rendering.");

    const { data: job, error: insertError } = await supabase
      .from("video_jobs")
      .insert({
        user_id: userId,
        script: data.script,
        voice: data.voice,
        format: data.format,
        status: "running",
        stage: "planning",
        progress: 8,
        step: "Writing narration",
      })
      .select()
      .single();
    if (insertError) throw new Error(insertError.message);

    try {
      const plan = await generateVideoPlan(data.script, data.format, data.voice);
      const { data: updated, error } = await supabase
        .from("video_jobs")
        .update({
          title: plan.title,
          narration: plan.narration,
          scenes: plan.scenes,
          duration_seconds: plan.durationSeconds,
          stage: "voiceover",
          progress: 22,
          step: "Recording voiceover",
        })
        .eq("id", job.id)
        .select()
        .single();
      if (error) throw new Error(error.message);

      // Reserve the credit once the plan exists.
      await supabase
        .from("profiles")
        .update({ credits: profile.credits - 1 })
        .eq("id", userId);
      await supabase.from("credit_ledger").insert({
        user_id: userId,
        delta: -1,
        reason: `Video render: ${plan.title}`,
      });

      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Render failed";
      await supabase
        .from("video_jobs")
        .update({ status: "failed", stage: "failed", step: "Failed", error: message })
        .eq("id", job.id);
      throw new Error(message);
    }
  });

/** Step 2..n — advances the render pipeline one stage per call; the client polls this. */
export const advanceVideoJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const {
      generateVoiceover,
      generateSceneImages,
      shotstackConfigured,
      submitRender,
      pollRender,
      storeFinishedVideo,
    } = await import("./render.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: job, error } = await supabase
      .from("video_jobs")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) throw new Error("Job not found");
    if (job.status === "completed" || job.status === "failed") return job;

    const scenes = (Array.isArray(job.scenes) ? job.scenes : []) as {
      visual: string;
      caption: string;
    }[];

    const save = async (patch: Database["public"]["Tables"]["video_jobs"]["Update"]) => {
      const { data: next, error: err } = await supabase
        .from("video_jobs")
        .update(patch)
        .eq("id", job.id)
        .select()
        .single();
      if (err) throw new Error(err.message);
      return next;
    };

    try {
      switch (job.stage) {
        case "voiceover": {
          const { url, estimatedSeconds } = await generateVoiceover(
            supabaseAdmin,
            job.id,
            userId,
            job.narration || job.script,
            job.voice,
          );
          return await save({
            audio_url: url,
            duration_seconds: estimatedSeconds,
            stage: "visuals",
            progress: 45,
            step: "Matching footage",
          });
        }

        case "visuals": {
          const images = await generateSceneImages(
            supabaseAdmin,
            job.id,
            userId,
            scenes,
            job.format,
          );
          const next = nextStageAfterVisuals(shotstackConfigured());
          return await save({
            assets: images,
            thumbnail_url: images[0] ?? job.thumbnail_url,
            stage: next.stage,
            progress: next.progress,
            step: next.step,
          });
        }

        case "render": {
          const images = (Array.isArray(job.assets) ? job.assets : []) as string[];
          const renderId = await submitRender({
            images,
            audioUrl: job.audio_url!,
            captions: scenes.map((s) => s.caption),
            durationSeconds: job.duration_seconds ?? 45,
            title: job.title ?? "Vidora video",
          });
          return await save({
            render_id: renderId,
            stage: "rendering",
            progress: 80,
            step: "Final render",
          });
        }

        case "rendering": {
          const status = await pollRender(job.render_id!);
          if (status.status === "done" && status.url) {
            const stored = await storeFinishedVideo(supabaseAdmin, job.id, userId, status.url);
            return await save({
              result_url: stored,
              status: "completed",
              stage: "done",
              progress: 100,
              step: "Ready",
            });
          }
          if (status.status === "failed") {
            return await save({
              status: "failed",
              stage: "failed",
              step: "Failed",
              error: status.error ?? "The render provider failed to build the video.",
            });
          }
          return await save({ progress: Math.min(96, (job.progress ?? 80) + 3) });
        }

        case "client_render":
        case "preview": {
          // Stills + voiceover ready; final MP4 is composed in the browser
          // when Shotstack is not configured. Do not mark completed here —
          // finalize attaches result_url after upload + validation.
          return job;
        }

        default:
          return job;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Render failed";
      return await save({ status: "failed", stage: "failed", step: "Failed", error: message });
    }
  });

export const deleteMyJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("video_jobs")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ display_name: z.string().trim().min(1).max(80) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ display_name: data.display_name })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const SIGNED_URL_TTL = 60 * 60 * 24 * 365;
const VIDEO_BUCKET = "generated-videos";

/**
 * After the browser composes and uploads video.mp4, validate the object and
 * attach result_url. Does not overwrite audio_url.
 */
export const finalizeVideoJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        path: z.string().min(8).max(400),
        file_size: z.number().int().nonnegative(),
        duration: z.number().positive(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const metaError = validateClientFinalizeMeta({
      file_size: data.file_size,
      duration: data.duration,
    });
    if (metaError) throw new Error(metaError);

    const expectedPath = `${userId}/${data.id}/video.mp4`;
    if (data.path !== expectedPath) {
      throw new Error("Invalid upload path for this job.");
    }

    const { data: job, error: jobError } = await supabase
      .from("video_jobs")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) throw new Error("Job not found");
    if (job.status === "completed" && job.result_url) return job;

    const { data: blob, error: dlError } = await supabase.storage
      .from(VIDEO_BUCKET)
      .download(data.path);
    if (dlError || !blob) {
      throw new Error(
        `Final video missing from storage: ${dlError?.message ?? "not found"}`,
      );
    }
    if (blob.size < 1024) {
      throw new Error("Uploaded video is empty or truncated.");
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!looksLikeMp4(bytes)) {
      throw new Error("Uploaded file is not a valid MP4 (missing ftyp).");
    }

    const { data: signed, error: signError } = await supabase.storage
      .from(VIDEO_BUCKET)
      .createSignedUrl(data.path, SIGNED_URL_TTL);
    if (signError || !signed?.signedUrl) {
      throw new Error(signError?.message ?? "Could not sign result URL");
    }

    const { data: updated, error } = await supabase
      .from("video_jobs")
      .update({
        result_url: signed.signedUrl,
        duration_seconds: Math.round(data.duration),
        status: "completed",
        stage: "done",
        progress: 100,
        step: "Ready",
        error: null,
      })
      .eq("id", data.id)
      .eq("user_id", userId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return updated;
  });

/** Mark a quick-generate job failed when browser compose/upload fails. */
export const failVideoJobCompose = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        error: z.string().trim().min(1).max(1000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: updated, error } = await context.supabase
      .from("video_jobs")
      .update({
        status: "failed",
        stage: "failed",
        step: "Failed",
        error: data.error.slice(0, 1000),
      })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return updated;
  });
