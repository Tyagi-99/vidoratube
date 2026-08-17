import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { generateVideoPlan } from "./jobs.server";

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
          return await save({
            assets: images,
            thumbnail_url: images[0] ?? job.thumbnail_url,
            stage: shotstackConfigured() ? "render" : "preview",
            progress: 70,
            step: shotstackConfigured() ? "Composing the cut" : "Finishing preview",
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

        case "preview": {
          return await save({
            status: "completed",
            stage: "done",
            progress: 100,
            step: "Preview ready",
            error: null,
          });
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
