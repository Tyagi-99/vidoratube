import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildThumbnailPrompt,
  THUMBNAIL_VARIANTS,
  validateTextOverlay,
  type ThumbnailAspect,
} from "./thumbnails";
import { rankTitles, buildDescription, suggestTags } from "./seo";
import {
  approvalScopeForPrivacy,
  recordApproval,
  recordPublishWarning,
  requirePublishApproval,
} from "./publish-approval";
import {
  evaluatePublishGate,
  lowScoreWarningMessage,
  publishBlockedMessage,
  type PublishPrivacy,
} from "./safety";
import { getProjectStrictGate } from "./creation/claims/strict-gate";

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

    const { requestThumbnailImage, uploadThumbnail, hashThumbnailPrompt } =
      await import("./thumbnails.server");
    const aspects: ThumbnailAspect[] = ["16:9", "9:16"];
    const created: { variant: number; aspect: ThumbnailAspect; url: string }[] = [];

    for (const aspect of aspects) {
      for (let variant = 1; variant <= THUMBNAIL_VARIANTS; variant++) {
        const prompt = buildThumbnailPrompt({
          videoTitle: data.video_title,
          videoTopic: data.video_topic,
          ...(data.style_hint ? { styleHint: data.style_hint } : {}),
          variant,
          aspect,
        });
        const bytes = await requestThumbnailImage(prompt, {
          admin: supabaseAdmin,
          userId,
          projectId: data.project_id,
        });
        const url = await uploadThumbnail(
          supabaseAdmin,
          userId,
          data.project_id,
          variant,
          aspect,
          bytes,
        );
        const { error } = await supabase.from("thumbnails").upsert(
          {
            user_id: userId,
            project_id: data.project_id,
            variant,
            aspect,
            url,
            prompt,
            // Provenance: AI-generated variant, exact prompt fingerprint.
            prompt_hash: hashThumbnailPrompt(prompt),
            is_ai_generated: true,
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
  chapters: z
    .array(z.object({ time: z.string(), label: z.string() }))
    .max(30)
    .default([]),
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
    const copy = await generateSEOCopy(
      {
        videoTitle: data.video_title,
        scriptSummary: data.script_summary,
        primaryKeyword: data.primary_keyword,
        chapters: data.chapters,
      },
      { admin: supabaseAdmin, userId, projectId: data.project_id },
    );

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
  /**
   * Phase 4, Stream A (D162): idempotency key for retried creates. When
   * supplied and a job with this key already exists, the existing job is
   * returned instead of inserting a duplicate. Generated server-side when
   * omitted (the column default backstops direct inserts).
   */
  idempotency_key: z.string().trim().min(1).max(128).optional(),
});

/**
 * Generates a fresh idempotency key for a publish job.
 */
export function newPublishJobIdempotencyKey(): string {
  return `job_${crypto.randomUUID()}`;
}

/** Creates a draft publish job. Drafts never publish without approval. */
export const createPublishJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createPublishJobSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Idempotent create: a retried request with the same key resolves to the
    // existing job instead of duplicating it.
    if (data.idempotency_key) {
      const { data: existing } = await supabase
        .from("publish_jobs")
        .select("*")
        .eq("user_id", userId)
        .eq("idempotency_key", data.idempotency_key)
        .maybeSingle();
      if (existing) return { publishJob: existing, idempotent: true as const };
    }

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
        idempotency_key: data.idempotency_key ?? newPublishJobIdempotencyKey(),
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
  /**
   * DEPRECATED (Sprint 7-8 C): acknowledging the risk no longer unblocks
   * anything. Score < 50 BLOCKS public publishing outright; private/unlisted
   * proceed with a recorded warning. Accepted for backward compatibility
   * with in-flight clients; ignored by the server.
   */
  safety_override: z.boolean().default(false),
});

/**
 * Shared strict-gate assertion for every publish path (P3 Stream B / D99).
 * Both approval AND execution call this, so the "confirmed-only" rule lives
 * in exactly one place. Fail-closed: the gate throws on query errors, and
 * strict mode defaults to OFF so existing projects are unaffected unless
 * the owner opts in.
 */
export async function assertPublishStrictGate(
  supabase: any,
  userId: string,
  projectId: string,
): Promise<void> {
  const strictGate = await getProjectStrictGate(supabase, userId, projectId);
  if (strictGate.blocked) {
    throw new Error(strictGate.message);
  }
}

/**
 * HUMAN APPROVAL GATE. The only transition from draft -> approved.
 * This is the deliberate user action that authorizes a YouTube publish.
 * There is no code path that publishes without this.
 *
 * Sprint 7-8 C: approving also writes a server-side approval record
 * (approvals table) that executePublishJob MUST find before uploading.
 * Safety: score < 50 BLOCKS public publishing (no override);
 * private/unlisted proceed with a warning noted on the approval.
 */
export const approvePublishJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => approvePublishJobSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return runApprovePublishJob({ supabase, supabaseAdmin, userId, input: data });
  });

export type ApprovePublishInput = z.infer<typeof approvePublishJobSchema>;

/**
 * Core of approvePublishJob, exported for tests. `supabase` is the caller's
 * RLS-scoped client; `supabaseAdmin` is the service-role client used for the
 * approval record (which has no client write policies by design).
 */
export async function runApprovePublishJob({
  supabase,
  supabaseAdmin,
  userId,
  input,
}: {
  supabase: any;
  supabaseAdmin: any;
  userId: string;
  input: ApprovePublishInput;
}): Promise<{ publishJob: any; safetyWarning: string | null }> {
  const { data: job } = await supabase
    .from("publish_jobs")
    .select("id, status, project_id, video_job_id")
    .eq("id", input.publish_job_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!job) throw new Error("Publish job not found");
  if (job.status !== "draft") {
    throw new Error(`Only draft jobs can be approved (current: ${job.status}).`);
  }

  // SAFETY GATE (server-enforced, D62): a high-risk score (< 50) BLOCKS
  // public publishing with no override path. Private/unlisted may proceed;
  // the warning is recorded at execute time. No score on record = allowed
  // (scoring is advisory, not mandatory).
  const { data: latestScore } = await supabase
    .from("safety_scores")
    .select("score")
    .eq("project_id", job.project_id)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const safetyScore: number | null = latestScore?.score ?? null;
  const gate = evaluatePublishGate(safetyScore, input.privacy as PublishPrivacy);
  if (gate.blocked) {
    throw new Error(publishBlockedMessage(gate.score as number));
  }

  // STRICT EVIDENCE GATE (server-enforced, P3 Stream B / D99): shared
  // assertion — see assertPublishStrictGate below.
  await assertPublishStrictGate(supabase, userId, job.project_id);

  if (input.thumbnail_id) {
    const { data: thumb } = await supabase
      .from("thumbnails")
      .select("id")
      .eq("id", input.thumbnail_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!thumb) throw new Error("Thumbnail not found");
  }

  const scheduledFor = input.scheduled_for ? new Date(input.scheduled_for) : null;
  if (scheduledFor && scheduledFor.getTime() < Date.now()) {
    throw new Error("Scheduled time must be in the future.");
  }

  const { data: updated, error } = await supabase
    .from("publish_jobs")
    .update({
      status: scheduledFor ? "scheduled" : "approved",
      title: input.title,
      description: input.description ?? null,
      tags: input.tags,
      privacy: input.privacy,
      made_for_kids: input.madeForKids,
      thumbnail_id: input.thumbnail_id ?? null,
      scheduled_for: scheduledFor?.toISOString() ?? null,
      approved_by: userId,
      approved_at: new Date().toISOString(),
      safety_score: safetyScore,
    })
    .eq("id", job.id)
    .select()
    .single();
  if (error) throw new Error(error.message);

  // Server-side approval record: this is what executePublishJob checks.
  // Written with the service role — clients have no write policies on the
  // approvals table, so this row cannot be forged.
  const warning = gate.warning ? lowScoreWarningMessage(gate.score as number) : null;
  await recordApproval(supabaseAdmin, {
    userId,
    projectId: job.project_id,
    videoId: job.video_job_id ?? null,
    publishJobId: job.id,
    approverId: userId,
    scope: approvalScopeForPrivacy(input.privacy),
    notes: warning,
  });

  return { publishJob: updated, safetyWarning: warning };
}

const executePublishJobSchema = z.object({
  publish_job_id: z.string().uuid(),
});

/**
 * Executes an approved (or due scheduled) publish job: uploads the video via
 * the existing resumable YouTube uploader, then sets the thumbnail.
 * Only runs for jobs in approved/scheduled status — drafts can never execute.
 *
 * Sprint 7-8 C (D61): TWO hard server-side requirements before ANY upload:
 *   1. A human approval RECORD must exist in the approvals table
 *      (requirePublishApproval). The approvals table has no client write
 *      policies, so a forged publish_jobs row can never satisfy this.
 *      (The adapter-level gate in publishing-gates.server.ts, workstream A,
 *      additionally re-checks approved_by/approved_at on the job row.)
 *   2. The CURRENT latest safety score is re-checked: < 50 BLOCKS public;
 *      private/unlisted proceed with a recorded warning.
 * P3 Stream B adds a third:
 *   3. The strict evidence gate is re-checked: with
 *      projects.research_strict_mode ON, ANY claim lacking a human CONFIRM
 *      blocks execution (fail-closed, D99).
 */
export const executePublishJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => executePublishJobSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return runExecutePublishJob({
      supabase,
      supabaseAdmin,
      userId,
      publishJobId: data.publish_job_id,
    });
  });

/** Platform upload, injectable so tests can prove the gate without uploading. */
export interface PublishUploader {
  publishVideoJob: (admin: any, input: any) => Promise<{ videoId: string }>;
  setVideoThumbnail: (admin: any, input: any) => Promise<void>;
}

/**
 * Core of executePublishJob, exported for tests. `uploader` defaults to the
 * real YouTube uploader; tests inject a mock.
 */
export async function runExecutePublishJob({
  supabase,
  supabaseAdmin,
  userId,
  publishJobId,
  uploader,
}: {
  supabase: any;
  supabaseAdmin: any;
  userId: string;
  publishJobId: string;
  uploader?: PublishUploader;
}): Promise<{
  videoId: string;
  url: string;
  publishJob: any;
  safetyWarning: string | null;
}> {
  const { data: job } = await supabase
    .from("publish_jobs")
    .select("*")
    .eq("id", publishJobId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!job) throw new Error("Publish job not found");
  if (!["approved", "scheduled"].includes(job.status)) {
    throw new Error(`Job is not ready to publish (current: ${job.status}).`);
  }
  if (
    job.status === "scheduled" &&
    job.scheduled_for &&
    new Date(job.scheduled_for).getTime() > Date.now()
  ) {
    // No auto-publishing anywhere in the system: a scheduled job waits for
    // its time, then still requires this human-invoked execution.
    throw new Error(
      "This job is scheduled for a future time — it can only be published once that time arrives.",
    );
  }
  if (job.made_for_kids === null || job.made_for_kids === undefined) {
    throw new Error("Please confirm whether this video is made for kids.");
  }
  if (!job.video_job_id) throw new Error("Publish job has no video attached.");

  // HARD REQUIREMENT 1: a human approval record must exist for this job +
  // scope. No approval row (e.g. a forged publish_jobs row) = rejection.
  // Runs BEFORE the uploading claim so a gate failure leaves the job in
  // `approved`/`scheduled` and retryable instead of burning it into `failed`.
  await requirePublishApproval(supabaseAdmin, {
    userId,
    publishJobId: job.id,
    scope: approvalScopeForPrivacy(job.privacy),
  });

  // HARD REQUIREMENT 2: re-check the CURRENT latest safety score — a low
  // score recorded after approval must still block a public publish.
  const { data: latestScore } = await supabaseAdmin
    .from("safety_scores")
    .select("score")
    .eq("project_id", job.project_id)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const execGate = evaluatePublishGate(latestScore?.score ?? null, job.privacy as PublishPrivacy);
  if (execGate.blocked) {
    throw new Error(publishBlockedMessage(execGate.score as number));
  }
  const execWarning = execGate.warning ? lowScoreWarningMessage(execGate.score as number) : null;

  // HARD REQUIREMENT 3 (P3 Stream B / D99): re-check the strict evidence
  // gate at execution time — claims confirmed after approval keep it
  // green; a strict-mode project with unconfirmed claims cannot upload.
  await assertPublishStrictGate(supabase, userId, job.project_id);

  // Mark uploading (atomic guard against double-execution). All gates have
  // passed at this point, so a claim failure here means a true race.
  const { data: claimed } = await supabase
    .from("publish_jobs")
    .update({ status: "uploading" })
    .eq("id", job.id)
    .in("status", ["approved", "scheduled"])
    .select()
    .maybeSingle();
  if (!claimed) throw new Error("This job is already being published.");

  try {
    if (execWarning) {
      await recordPublishWarning(supabaseAdmin, {
        userId,
        projectId: job.project_id,
        publishJobId: job.id,
        kind: "safety-low-score",
        message: execWarning,
      });
    }

    // Reuse the existing resumable uploader (handles scope, tokens, retries).
    const up: PublishUploader = uploader ?? (await import("./youtube-publish.server"));
    const { videoId } = await up.publishVideoJob(supabaseAdmin, {
      userId,
      videoJobId: job.video_job_id,
      title: job.title ?? "Vidora video",
      description: job.description ?? "",
      tags: job.tags,
      privacy: job.privacy as "private" | "unlisted" | "public",
      madeForKids: job.made_for_kids,
      publishAt: job.scheduled_for,
      // Sprint 7–8: the adapter re-checks the human-approval record on this
      // job immediately before uploading (integration point for the
      // server-enforced approvals table).
      publishJobId: job.id,
      projectId: job.project_id,
    });

    // Set the selected thumbnail (with burned overlay) if one was chosen.
    if (job.thumbnail_id) {
      await up
        .setVideoThumbnail(supabaseAdmin, {
          userId,
          videoId,
          thumbnailId: job.thumbnail_id,
        })
        .catch((e) => {
          // Thumbnail failure shouldn't fail the publish — log and continue.
          console.warn(
            `[vidora] thumbnail set failed for ${videoId}:`,
            e instanceof Error ? e.message : e,
          );
        });
    }

    const { data: updated } = await supabase
      .from("publish_jobs")
      .update({
        status: "published",
        youtube_video_id: videoId,
        youtube_url: `https://youtu.be/${videoId}`,
        published_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .select()
      .single();
    return {
      videoId,
      url: `https://youtu.be/${videoId}`,
      publishJob: updated,
      safetyWarning: execWarning,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Publish failed";
    await supabase
      .from("publish_jobs")
      .update({ status: "failed", error: message.slice(0, 500) })
      .eq("id", job.id);
    throw error instanceof Error ? error : new Error(message);
  }
}

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
      .select(
        "id, status, title, privacy, scheduled_for, youtube_video_id, youtube_url, error, approved_at, created_at, project_id",
      )
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
      .select(
        "id, variant, aspect, url, final_url, text_overlay, selected, created_at, model, license, is_ai_generated",
      )
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
  .inputValidator((input: unknown) =>
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

const uploadFinalThumbnailSchema = z.object({
  thumbnail_id: z.string().uuid(),
  /** JPEG data URL (data:image/jpeg;base64,...) with the overlay burned in. Max ~2MB. */
  image_data_url: z.string().startsWith("data:image/jpeg;base64,").max(3_000_000),
});

/**
 * Stores the client-burned final thumbnail (text overlay applied via canvas).
 * Updates final_url so YouTube thumbnails.set uses the burned version.
 */
export const uploadFinalThumbnailImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => uploadFinalThumbnailSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: thumb } = await supabase
      .from("thumbnails")
      .select("id, project_id, variant, aspect")
      .eq("id", data.thumbnail_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!thumb) throw new Error("Thumbnail not found");

    const bytes = Uint8Array.from(Buffer.from(data.image_data_url.split(",")[1]!, "base64"));
    const { uploadFinalThumbnail } = await import("./thumbnails.server");
    const path = await uploadFinalThumbnail(
      supabaseAdmin,
      userId,
      thumb.project_id,
      thumb.variant,
      thumb.aspect,
      bytes,
    );
    const { error } = await supabase
      .from("thumbnails")
      .update({ final_url: path })
      .eq("id", thumb.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
