import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { generateVideoPlan } from "./jobs.server";
import {
  canFinalizeJobStage,
  claimJobStage,
  isReapableJob,
  REAP_AFTER_MS,
  releaseJobStageClaim,
} from "./jobs/stage-claim";
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
  /** Client-generated UUID per submit click; a retry with the same key returns the existing job. */
  idempotency_key: z.string().uuid().optional(),
  /** Opaque per-browser id for free-credit abuse correlation (optional). */
  device_hash: z.string().max(100).optional(),
});

/** Idempotency window: a retry with the same key returns the in-flight job. */
const IDEMPOTENCY_WINDOW_MS = 10 * 60 * 1000;

/**
 * Refund whatever a job was actually debited (Sprint 1-2). Looks up the real
 * negative ledger row for the job and refunds exactly that amount.
 * refundMinutesForJob is idempotent per job id and clamps to the actual
 * debit — a job that was never charged is a no-op. Never throws: callers
 * use it on failure paths where the original error must not be masked.
 */
async function refundDebitedMinutes(
  supabaseAdmin: import("@supabase/supabase-js").SupabaseClient<import("@/integrations/supabase/types").Database>,
  userId: string,
  jobId: string,
): Promise<void> {
  try {
    const { refundMinutesForJob } = await import("./credits");
    const { data: debit } = await supabaseAdmin
      .from("credit_ledger")
      .select("delta")
      .eq("user_id", userId)
      .eq("ref_id", jobId)
      .lt("delta", 0)
      .limit(1)
      .maybeSingle();
    if (debit) {
      await refundMinutesForJob(
        supabaseAdmin,
        userId,
        jobId,
        Math.abs(debit.delta),
        `Refund: failed render ${jobId}`,
      );
    }
  } catch {
    // Never mask the original failure with a refund error.
  }
}

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

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Idempotent retry: a double-click / network retry with the same key
    // returns the already-created job instead of spending another credit.
    if (data.idempotency_key) {
      const { data: existing, error: existingError } = await supabase
        .from("video_jobs")
        .select("*")
        .eq("user_id", userId)
        .eq("idempotency_key", data.idempotency_key)
        .gte("created_at", new Date(Date.now() - IDEMPOTENCY_WINDOW_MS).toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingError) throw new Error(existingError.message);
      if (existing) return existing;
    }

    // Hard global rate limit: 10 job creates per hour per user.
    const { enforcePostgresRateLimit } = await import("./rate-limit");
    await enforcePostgresRateLimit(
      supabaseAdmin,
      `job:create:${userId}`,
      { max: 10, windowSeconds: 3600 },
      "You're creating videos too fast. Please wait a bit and try again.",
    );

    // Free-credit farming check: >2 distinct free-tier users on the same
    // network/device get blocked.
    const { checkAbuseCluster } = await import("./abuse");
    await checkAbuseCluster(supabaseAdmin, {
      userId,
      signalType: "job_create",
      deviceHash: data.device_hash,
    });

    if (profile.credits < 1)
      throw new Error("You're out of credits. Upgrade your plan to keep rendering.");

    const { data: job, error: insertError } = await supabase
      .from("video_jobs")
      .insert({
        user_id: userId,
        script: data.script,
        voice: data.voice,
        format: data.format,
        idempotency_key: data.idempotency_key ?? null,
        status: "running",
        stage: "planning",
        progress: 8,
        step: "Writing narration",
      })
      .select()
      .single();
    if (insertError) throw new Error(insertError.message);

    const { finishedMinutes } = await import("./billing/per-minute");
    let reserveMinutes = 1;
    try {
      const plan = await generateVideoPlan(data.script, data.format, data.voice, {
        admin: supabaseAdmin,
        userId,
        jobId: job.id,
      });
      reserveMinutes = finishedMinutes(plan.durationSeconds);
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

      // Reserve finished minutes once the plan exists. Per-minute pricing:
      // 1 credit = 1 finished minute of Story Mode with a standard voice
      // (see src/lib/billing/per-minute.ts for multipliers). The debit is a
      // single atomic RPC (balance check + update + ledger insert in one
      // transaction), so concurrent requests can never double-spend.
      // Idempotent per job id: a retry after a network blip is a no-op.
      const { debitMinutesForJob } = await import("./credits");
      await debitMinutesForJob(
        supabaseAdmin,
        userId,
        job.id,
        reserveMinutes,
        `Video render (${reserveMinutes} finished min): ${plan.title}`,
      );

      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Render failed";
      await supabase
        .from("video_jobs")
        .update({ status: "failed", stage: "failed", step: "Failed", error: message })
        .eq("id", job.id);
      // Failed renders refund the actually-debited minutes automatically.
      await refundDebitedMinutes(supabaseAdmin, userId, job.id);
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

    // Lost a stage race (another tab claimed it): return the fresh job state
    // with no side effects so the client just polls again.
    const refetch = async () => {
      const { data: fresh, error: err } = await supabase
        .from("video_jobs")
        .select("*")
        .eq("id", job.id)
        .eq("user_id", userId)
        .maybeSingle();
      if (err) throw new Error(err.message);
      if (!fresh) throw new Error("Job not found");
      return fresh;
    };

    try {
      switch (job.stage) {
        case "voiceover": {
          // Claim atomically: only the winner runs the paid TTS call.
          const claimed = await claimJobStage(supabase, job.id, userId, "voiceover");
          if (!claimed) return await refetch();
          try {
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
          } catch (err) {
            await releaseJobStageClaim(supabase, job.id, userId, "voiceover");
            throw err;
          }
        }

        case "visuals": {
          const claimed = await claimJobStage(supabase, job.id, userId, "visuals");
          if (!claimed) return await refetch();
          try {
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
          } catch (err) {
            await releaseJobStageClaim(supabase, job.id, userId, "visuals");
            throw err;
          }
        }

        case "render": {
          const claimed = await claimJobStage(supabase, job.id, userId, "render");
          if (!claimed) return await refetch();
          try {
            const images = (Array.isArray(job.assets) ? job.assets : []) as string[];
            const renderId = await submitRender(
              {
                images,
                audioUrl: job.audio_url!,
                captions: scenes.map((s) => s.caption),
                durationSeconds: job.duration_seconds ?? 45,
                title: job.title ?? "Vidora video",
              },
              { admin: supabaseAdmin, userId, mode: "story" },
            );
            return await save({
              render_id: renderId,
              stage: "rendering",
              progress: 80,
              step: "Final render",
            });
          } catch (err) {
            await releaseJobStageClaim(supabase, job.id, userId, "render");
            throw err;
          }
        }

        case "rendering": {
          const status = await pollRender(job.render_id!);
          if (status.status === "done" && status.url) {
            const claimed = await claimJobStage(supabase, job.id, userId, "rendering");
            if (!claimed) return await refetch();
            try {
              const stored = await storeFinishedVideo(supabaseAdmin, job.id, userId, status.url);
              return await save({
                result_url: stored,
                status: "completed",
                stage: "done",
                progress: 100,
                step: "Ready",
              });
            } catch (err) {
              await releaseJobStageClaim(supabase, job.id, userId, "rendering");
              throw err;
            }
          }
          if (status.status === "failed") {
            const claimed = await claimJobStage(supabase, job.id, userId, "rendering");
            if (!claimed) return await refetch();
            // The provider failed the render: refund the debited minutes.
            // save() moves the claimed stage straight to failed; no release needed.
            await refundDebitedMinutes(supabaseAdmin, userId, job.id);
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
      // Failed renders refund the actually-debited minutes automatically.
      // refundDebitedMinutes never throws, so the original error survives.
      await refundDebitedMinutes(supabaseAdmin, userId, job.id);
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
    z
      .object({
        display_name: z.string().trim().min(1).max(80).optional(),
        preferred_language: z.enum(["en", "hi"]).optional(),
      })
      .refine((v) => v.display_name !== undefined || v.preferred_language !== undefined, {
        message: "Nothing to update",
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({
        ...(data.display_name !== undefined ? { display_name: data.display_name } : {}),
        ...(data.preferred_language !== undefined
          ? { preferred_language: data.preferred_language }
          : {}),
      })
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
    // Only a running job in a client-compose stage may attach a final MP4 —
    // this blocks force-completing jobs that are still in voiceover/visuals/render.
    if (!canFinalizeJobStage(job)) {
      throw new Error("This job is not waiting for a final video upload.");
    }

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
    // Only a running job can be marked failed — never rewrite completed/failed
    // history, even if the client retries this call after the job resolved.
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
      .eq("status", "running")
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) throw new Error("Job is already resolved.");

    // The render genuinely failed: refund the debited minutes. Idempotent per
    // job id, and the RPC only refunds what was actually debited.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await refundDebitedMinutes(supabaseAdmin, context.userId, data.id);
    return updated;
  });

/**
 * Fail jobs stuck in `running` (browser closed / request died mid-stage) and
 * refund the reserved minutes when the ledger shows this job was actually
 * charged. Safe to call repeatedly: the fail-mark is conditional on
 * status='running' and refunds are idempotent per job (see
 * refund_credits_for_minutes).
 */
export const reapStaleVideoJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cutoff = new Date(Date.now() - REAP_AFTER_MS).toISOString();

    const { data: stale, error } = await supabaseAdmin
      .from("video_jobs")
      .select("id, stage, status, updated_at")
      .eq("user_id", userId)
      .eq("status", "running")
      .not("stage", "in", "(done,failed)")
      .lt("updated_at", cutoff);
    if (error) throw new Error(error.message);

    let reaped = 0;
    let refunded = 0;
    for (const job of stale ?? []) {
      if (!isReapableJob(job)) continue;
      // Conditional mark: concurrent reapers cannot double-process a job.
      const { data: marked, error: markError } = await supabaseAdmin
        .from("video_jobs")
        .update({
          status: "failed",
          stage: "failed",
          step: "Failed",
          error: "Render timed out and was stopped.",
        })
        .eq("id", job.id)
        .eq("user_id", userId)
        .eq("status", "running")
        .select("id")
        .maybeSingle();
      if (markError) throw new Error(markError.message);
      if (!marked) continue;
      reaped++;

      // Refund only if this job was actually charged (debit recorded with ref_id).
      // Debits are per finished minute, so read the actual debited amount.
      const { data: debit } = await supabaseAdmin
        .from("credit_ledger")
        .select("delta")
        .eq("user_id", userId)
        .eq("ref_id", job.id)
        .lt("delta", 0)
        .limit(1)
        .maybeSingle();
      if (!debit) continue;
      const { error: refundError } = await supabaseAdmin.rpc("refund_credits_for_minutes", {
        p_user_id: userId,
        p_minutes: Math.abs(debit.delta),
        p_reason: `Refund: stale render ${job.id}`,
        p_ref_id: job.id,
      });
      if (refundError) throw new Error(refundError.message);
      refunded++;
    }

    return { reaped, refunded };
  });
