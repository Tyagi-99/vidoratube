import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildThumbnailPrompt,
  validateTextOverlay,
  type ThumbnailAspect,
} from "./thumbnails";
import { rankTitles, buildDescription, suggestTags } from "./seo";

/**
 * P5: Thumbnail studio + SEO studio + publish pipeline server functions.
 *
 * Publish state machine: draft -> approved -> scheduled -> uploading -> published
 *                                              -> failed / canceled
 * The draft -> approved transition REQUIRES an explicit human action
 * (approvePublishJob). Nothing auto-publishes.
 */

async function debitOneCredit(admin: any, userId: string, reason: string) {
  const { error } = await admin.rpc("debit_credits_for_job_once", {
    p_user_id: userId,
    p_job_id: reason,
    p_amount: 1,
  });
  if (error) throw new Error("You're out of credits. Upgrade your plan to continue.");
}

const generateThumbnailsSchema = z.object({
  project_id: z.string().uuid(),
  video_title: z.string().trim().min(1).max(120),
  video_topic: z.string().trim().min(1).max(200),
  style_hint: z.string().trim().max(200).optional(),
});

/** Generates 3 variants x 2 aspects of AI thumbnails for a project. */
export const generateThumbnails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => generateThumbnailsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { enforcePostgresRateLimit } = await import("./rate-limit");
    await enforcePostgresRateLimit(
      supabaseAdmin,
      `thumbnails:generate:${userId}`,
      { max: 10, windowSeconds: 3600 },
      "You're generating thumbnails too fast. Please wait a bit.",
    );

    // Verify project ownership.
    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("id", data.project_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!project) throw new Error("Project not found");

    await debitOneCredit(supabaseAdmin, userId, `thumbnails:${data.project_id}`);

    const { requestThumbnailImage, uploadThumbnail } = await import("./thumbnails.server");
    const aspects: ThumbnailAspect[] = ["16:9", "9:16"];
    const created: { variant: number; aspect: ThumbnailAspect; url: string }[] = [];

    for (const aspect of aspects) {
      for (let variant = 1; variant <= 3; variant++) {
        const prompt = buildThumbnailPrompt({
          videoTitle: data.video_title,
          videoTopic: data.video_topic,
          ...(data.style_hint ? { styleHint: data.style_hint } : {}),
          variant,
          aspect,
        });
        const bytes = await requestThumbnailImage(prompt);
        const url = await uploadThumbnail(supabaseAdmin, userId, data.project_id, variant, aspect, bytes);
        const { error } = await supabase.from("thumbnails").upsert(
          {
            user_id: userId,
            project_id: data.project_id,
            variant,
            aspect,
            url,
            prompt,
            provider: "lovable-gateway",
            model: "google/gemini-2.5-flash-image",
            text_overlay: {},
            selected: variant === 1,
          },
          { onConflict: "project_id,variant,aspect" },
        );
        if (error) throw new Error(error.message);
        created.push({ variant, aspect, url });
      }
    }
    return { thumbnails: created };
  });

const selectThumbnailSchema = z.object({
  thumbnail_id: z.string().uuid(),
});

/** Marks one thumbnail variant as selected for publishing. */
export const selectThumbnail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => selectThumbnailSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: thumb } = await supabase
      .from("thumbnails")
      .select("id, project_id, aspect")
      .eq("id", data.thumbnail_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!thumb) throw new Error("Thumbnail not found");

    // Clear other selections for the same project+aspect, then select this one.
    const { error: clearError } = await supabase
      .from("thumbnails")
      .update({ selected: false })
      .eq("project_id", thumb.project_id)
      .eq("aspect", thumb.aspect)
      .eq("user_id", userId);
    if (clearError) throw new Error(clearError.message);
    const { error } = await supabase
      .from("thumbnails")
      .update({ selected: true })
      .eq("id", thumb.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const updateOverlaySchema = z.object({
  thumbnail_id: z.string().uuid(),
  headline: z.string().trim().min(1).max(60),
  font: z.enum(["bold-sans", "condensed", "serif-display", "mono"]).default("bold-sans"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  position: z.enum(["top", "center", "bottom"]).default("bottom"),
  fontSize: z.enum(["sm", "md", "lg"]).default("lg"),
});

/** Stores the text overlay spec (burned client-side via canvas at publish). */
export const updateThumbnailOverlay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateOverlaySchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const validation = validateTextOverlay(data);
    if (validation) throw new Error(validation);
    const { error } = await supabase
      .from("thumbnails")
      .update({
        text_overlay: {
          headline: data.headline,
          font: data.font,
          color: data.color,
          position: data.position,
          fontSize: data.fontSize,
        },
      })
      .eq("id", data.thumbnail_id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const generateSEOSchema = z.object({
  project_id: z.string().uuid(),
  video_title: z.string().trim().min(1).max(120),
  script_summary: z.string().trim().min(1).max(5000),
  primary_keyword: z.string().trim().min(1).max(60),
  niche_keywords: z.array(z.string().trim().max(60)).max(20).default([]),
  chapters: z.array(z.object({ time: z.string(), label: z.string() })).max(30).default([]),
});

/** LLM-generates titles, description, tags; ranks titles with deterministic scoring. */
export const generateSEOMetadata = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => generateSEOSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { enforcePostgresRateLimit } = await import("./rate-limit");
    await enforcePostgresRateLimit(
      supabaseAdmin,
      `seo:generate:${userId}`,
      { max: 20, windowSeconds: 3600 },
      "You're generating SEO metadata too fast. Please wait a bit.",
    );

    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("id", data.project_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!project) throw new Error("Project not found");

    await debitOneCredit(supabaseAdmin, userId, `seo:${data.project_id}`);

    const { generateSEOCopy } = await import("./seo.server");
    const copy = await generateSEOCopy({
      videoTitle: data.video_title,
      scriptSummary: data.script_summary,
      primaryKeyword: data.primary_keyword,
      chapters: data.chapters,
    });

    // Deterministic ranking of the LLM's title candidates.
    const ranked = rankTitles(copy.titles, data.primary_keyword);
    const description = buildDescription({
      hook: copy.hook,
      summary: copy.summary,
      chapters: data.chapters,
      cta: copy.cta,
      hashtags: copy.hashtags,
    });
    const tags = suggestTags(data.niche_keywords, copy.outlierTerms);

    const { error } = await supabase.from("seo_metadata").upsert(
      {
        user_id: userId,
        project_id: data.project_id,
        titles: JSON.parse(JSON.stringify(ranked)),
        selected_title: ranked[0]?.title ?? data.video_title,
        description,
        tags,
        hashtags: copy.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).slice(0, 5),
        chapters: JSON.parse(JSON.stringify(data.chapters)),
      },
      { onConflict: "project_id" },
    );
    if (error) throw new Error(error.message);
    return { titles: ranked, description, tags };
  });

// ---------------------------------------------------------------------------
// Publish pipeline
// ---------------------------------------------------------------------------

const createPublishJobSchema = z.object({
  project_id: z.string().uuid(),
  video_job_id: z.string().uuid(),
});

/** Creates a draft publish job. Drafts never publish without approval. */
export const createPublishJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createPublishJobSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: job } = await supabase
      .from("video_jobs")
      .select("id, status, result_url")
      .eq("id", data.video_job_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!job) throw new Error("Video not found");
    if (job.status !== "completed" || !job.result_url) {
      throw new Error("This video hasn't finished rendering yet.");
    }

    // Pull defaults from saved SEO + selected thumbnail.
    const { data: seo } = await supabase
      .from("seo_metadata")
      .select("selected_title, description, tags")
      .eq("project_id", data.project_id)
      .eq("user_id", userId)
      .maybeSingle();
    const { data: thumb } = await supabase
      .from("thumbnails")
      .select("id")
      .eq("project_id", data.project_id)
      .eq("user_id", userId)
      .eq("aspect", "16:9")
      .eq("selected", true)
      .maybeSingle();

    const { data: created, error } = await supabase
      .from("publish_jobs")
      .insert({
        user_id: userId,
        project_id: data.project_id,
        video_job_id: data.video_job_id,
        status: "draft",
        thumbnail_id: thumb?.id ?? null,
        title: seo?.selected_title ?? null,
        description: seo?.description ?? null,
        tags: seo?.tags ?? [],
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { publishJob: created };
  });

const approvePublishJobSchema = z.object({
  publish_job_id: z.string().uuid(),
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().max(4900).optional(),
  tags: z.array(z.string().trim().max(60)).max(30).default([]),
  privacy: z.enum(["private", "unlisted", "public"]).default("private"),
  /** Required: the uploader's own "made for kids" declaration (COPPA). */
  madeForKids: z.boolean(),
  thumbnail_id: z.string().uuid().optional(),
  /** If set, the video goes live at this time; otherwise publishes immediately. */
  scheduled_for: z.string().datetime().optional(),
});

/**
 * HUMAN APPROVAL GATE. The only transition from draft -> approved.
 * This is the deliberate user action that authorizes a YouTube publish.
 * There is no code path that publishes without this.
 */
export const approvePublishJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => approvePublishJobSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: job } = await supabase
      .from("publish_jobs")
      .select("id, status")
      .eq("id", data.publish_job_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!job) throw new Error("Publish job not found");
    if (job.status !== "draft") {
      throw new Error(`Only draft jobs can be approved (current: ${job.status}).`);
    }

    if (data.thumbnail_id) {
      const { data: thumb } = await supabase
        .from("thumbnails")
        .select("id")
        .eq("id", data.thumbnail_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (!thumb) throw new Error("Thumbnail not found");
    }

    const scheduledFor = data.scheduled_for ? new Date(data.scheduled_for) : null;
    if (scheduledFor && scheduledFor.getTime() < Date.now()) {
      throw new Error("Scheduled time must be in the future.");
    }

    const { data: updated, error } = await supabase
      .from("publish_jobs")
      .update({
        status: scheduledFor ? "scheduled" : "approved",
        title: data.title,
        description: data.description ?? null,
        tags: data.tags,
        privacy: data.privacy,
        made_for_kids: data.madeForKids,
        thumbnail_id: data.thumbnail_id ?? null,
        scheduled_for: scheduledFor?.toISOString() ?? null,
        approved_by: userId,
        approved_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { publishJob: updated };
  });

const executePublishJobSchema = z.object({
  publish_job_id: z.string().uuid(),
});

/**
 * Executes an approved (or due scheduled) publish job: uploads the video via
 * the existing resumable YouTube uploader, then sets the thumbnail.
 * Only runs for jobs in approved/scheduled status — drafts can never execute.
 */
export const executePublishJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => executePublishJobSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: job } = await supabase
      .from("publish_jobs")
      .select("*")
      .eq("id", data.publish_job_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!job) throw new Error("Publish job not found");
    if (!["approved", "scheduled"].includes(job.status)) {
      throw new Error(`Job is not ready to publish (current: ${job.status}).`);
    }
    if (job.status === "scheduled" && job.scheduled_for && new Date(job.scheduled_for).getTime() > Date.now()) {
      throw new Error("This job is scheduled for later — it will publish automatically at its scheduled time.");
    }
    if (job.made_for_kids === null || job.made_for_kids === undefined) {
      throw new Error("Please confirm whether this video is made for kids.");
    }

    // Mark uploading (atomic guard against double-execution).
    const { data: claimed } = await supabase
      .from("publish_jobs")
      .update({ status: "uploading" })
      .eq("id", job.id)
      .in("status", ["approved", "scheduled"])
      .select()
      .maybeSingle();
    if (!claimed) throw new Error("This job is already being published.");

    if (!job.video_job_id) throw new Error("Publish job has no video attached.");
    try {
      // Reuse the existing resumable uploader (handles scope, tokens, retries).
      const { publishVideoJob } = await import("./youtube-publish.server");
      const { videoId } = await publishVideoJob(supabaseAdmin, {
        userId,
        videoJobId: job.video_job_id,
        title: job.title ?? "Vidora video",
        description: job.description ?? "",
        tags: job.tags,
        privacy: job.privacy as "private" | "unlisted" | "public",
        madeForKids: job.made_for_kids,
        publishAt: job.scheduled_for,
      });

      // Set the selected thumbnail (with burned overlay) if one was chosen.
      if (job.thumbnail_id) {
        const { setVideoThumbnail } = await import("./youtube-publish.server");
        await setVideoThumbnail(supabaseAdmin, {
          userId,
          videoId,
          thumbnailId: job.thumbnail_id,
        }).catch((e) => {
          // Thumbnail failure shouldn't fail the publish — log and continue.
          console.warn(`[vidora] thumbnail set failed for ${videoId}:`, e instanceof Error ? e.message : e);
        });
      }

      const { data: updated } = await supabase
        .from("publish_jobs")
        .update({
          status: "published",
          youtube_video_id: videoId,
          youtube_url: `https://youtu.be/${videoId}`,
        })
        .eq("id", job.id)
        .select()
        .single();
      return { videoId, url: `https://youtu.be/${videoId}`, publishJob: updated };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Publish failed";
      await supabase
        .from("publish_jobs")
        .update({ status: "failed", error: message.slice(0, 500) })
        .eq("id", job.id);
      throw error instanceof Error ? error : new Error(message);
    }
  });

const cancelPublishJobSchema = z.object({
  publish_job_id: z.string().uuid(),
});

/** Cancels a draft/approved/scheduled publish job. Published jobs can't be uncanceled. */
export const cancelPublishJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => cancelPublishJobSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: updated, error } = await supabase
      .from("publish_jobs")
      .update({ status: "canceled" })
      .eq("id", data.publish_job_id)
      .eq("user_id", userId)
      .in("status", ["draft", "approved", "scheduled"])
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) throw new Error("Job can't be canceled in its current state.");
    return { ok: true };
  });

/** Lists the user's publish jobs, newest first. */
export const listPublishJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("publish_jobs")
      .select("id, status, title, privacy, scheduled_for, youtube_video_id, youtube_url, error, approved_at, created_at, project_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { jobs: data };
  });

const thumbnailsForProjectSchema = z.object({
  project_id: z.string().uuid(),
});

/** Lists thumbnails for a project with signed view URLs. */
export const listThumbnails = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => thumbnailsForProjectSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: thumbs, error } = await supabase
      .from("thumbnails")
      .select("id, variant, aspect, url, final_url, text_overlay, selected, created_at")
      .eq("project_id", data.project_id)
      .eq("user_id", userId)
      .order("aspect")
      .order("variant");
    if (error) throw new Error(error.message);

    // Sign each storage path for viewing.
    const withUrls = await Promise.all(
      (thumbs ?? []).map(async (t) => {
        const path = (t.final_url ?? t.url) as string;
        const { data: signed } = await supabase.storage
          .from("generated-videos")
          .createSignedUrl(path, 3600);
        return { ...t, viewUrl: signed?.signedUrl ?? null };
      }),
    );
    return { thumbnails: withUrls };
  });

const seoForProjectSchema = z.object({
  project_id: z.string().uuid(),
});

/** Fetches saved SEO metadata for a project. */
export const getSEOMetadata = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => seoForProjectSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: seo, error } = await supabase
      .from("seo_metadata")
      .select("*")
      .eq("project_id", data.project_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { seo };
  });

const selectSEOTitleSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().trim().min(1).max(100),
});

/** Updates the selected title / edited description / tags. */
export const updateSEOMetadata = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: unknown) =>
      selectSEOTitleSchema
        .extend({
          description: z.string().trim().max(4900).optional(),
          tags: z.array(z.string().trim().max(60)).max(30).optional(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("seo_metadata")
      .update({
        selected_title: data.title,
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.tags !== undefined ? { tags: data.tags } : {}),
      })
      .eq("project_id", data.project_id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
