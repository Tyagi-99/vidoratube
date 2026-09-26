/**
 * Sprint 3-4: chapter-mode render orchestration (server functions).
 *
 * - `enqueueChapterRender`: script in → split into 4–8 chapters, one
 *   continuity brief, cached paragraph narration (only misses synthesized),
 *   one `renders` row per aspect (each with its own `render_chapters` rows),
 *   exact per-minute quote reserved up front like every server render.
 * - `rerenderChapter`: re-render ONE chapter with new script text. Only that
 *   chapter is marked queued; unchanged paragraphs reuse cached narration;
 *   the parent render is re-queued and the worker re-stitches all chapters.
 *   No new billing reserve: the chapter rows are internal and the parent's
 *   original quote still covers the finished minutes (see docs/DECISIONS.md
 *   D25). `finalize_render_billing` is idempotent, so the re-render's
 *   completion settles as a no-op.
 */
import { createServerFn } from "@tanstack/react-start";
// NOTE: no node:crypto import — this module is client-bundled. Use the
// universal Web Crypto API instead (browsers, Node 19+, workers).
const randomUUID = () => crypto.randomUUID();
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAppUser } from "../server-auth";
import type { Database, Json } from "@/integrations/supabase/types";
import { quoteMultiAspectRender } from "../billing/per-minute";
import {
  ASPECT_RESOLUTIONS,
  resolveRenderAspects,
  type AspectRatio,
} from "../server-renders.functions";
import { buildContinuityBrief, type ContinuityBrief } from "./brief";
import { splitIntoParagraphs, splitScriptIntoChapters, type Chapter } from "./split";
import {
  makeSupabaseTtsDeps,
  synthesizeCachedParagraphs,
  type CachedParagraph,
} from "./tts-cache.server";
import { DEFAULT_VOICE_ID, DEFAULT_VOICE_MODEL } from "../providers/voice.server";

type ChapterRowInsert = Database["public"]["Tables"]["render_chapters"]["Insert"];
type RenderRowInsert = Database["public"]["Tables"]["renders"]["Insert"];

const ChapterEnqueueSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().max(200).default("Untitled video"),
  /** Full narration script; split deterministically into 4–8 chapters. */
  script: z.string().min(1).max(200_000),
  aspect: z.enum(["16:9", "9:16", "1:1"]).optional(),
  aspects: z.array(z.enum(["16:9", "9:16", "1:1"])).min(1).max(3).optional(),
  fps: z.number().int().min(24).max(60).default(30),
  burnCaptions: z.boolean().default(true),
  voiceId: z.string().max(100).default(DEFAULT_VOICE_ID),
  voiceModel: z.string().max(100).default(DEFAULT_VOICE_MODEL),
  languageCode: z.string().max(16).default("en"),
  /** Premium voice doubles the per-minute quote (same rule as scenes path). */
  premiumVoice: z.boolean().default(false),
  mode: z.enum(["story", "cinema"]).default("story"),
});

/**
 * Build the `render_chapters` insert rows for one parent render row.
 * Pure (no I/O) — unit-testable without a database.
 */
export function buildChapterRows(
  renderId: string,
  chapters: Chapter[],
  narration: Map<number, CachedParagraph[]>,
): ChapterRowInsert[] {
  return chapters.map((c) => {
    const paras = narration.get(c.index) ?? [];
    return {
      id: randomUUID(),
      render_id: renderId,
      chapter_index: c.index,
      title: c.title,
      script_text: c.scriptText,
      paragraphs: paras.map((p) => ({
        text: p.text,
        audio_path: p.audioPath,
        duration_seconds: p.durationSeconds,
      })),
      status: "queued",
      attempts: 0,
      max_attempts: 3,
    };
  });
}

/**
 * The parent `renders` row for chapter mode.
 *
 * The worker's RenderJobMetaSchema requires at least one scene, so the row
 * carries a single synthetic scene whose duration is the total estimated
 * narration time. It exists only so quote math, legacy billing paths, and
 * the browser fallback (which ignores chapterMode rows) keep working
 * unchanged; the real per-chapter media plan lives in `render_chapters`.
 */
export function buildChapterRenderRow(params: {
  userId: string;
  groupId: string;
  aspect: AspectRatio;
  title: string;
  fps: number;
  burnCaptions: boolean;
  mode: "story" | "cinema";
  totalSeconds: number;
  expectedCredits: number;
  expectedMinutes: number;
  brief: ContinuityBrief;
}): RenderRowInsert {
  const p = params;
  return {
    id: randomUUID(),
    user_id: p.userId,
    project_id: null,
    type: "full",
    engine: "server_ffmpeg",
    format: "mp4",
    status: "queued",
    stage: "queued",
    progress: 0,
    aspect_ratio: p.aspect,
    resolution: ASPECT_RESOLUTIONS[p.aspect],
    reserved_minutes: p.expectedMinutes,
    meta: {
      chapterMode: true,
      continuityBrief: p.brief,
      scenes: [
        {
          id: "chapter-mode",
          number: 0,
          narration: "",
          image: null,
          audio: null,
          duration: Math.max(1, p.totalSeconds),
          cues: [],
        },
      ],
      title: p.title,
      aspect: p.aspect,
      fps: p.fps,
      burnCaptions: p.burnCaptions,
      musicUrl: null,
      musicVolume: 0.15,
      musicDucking: true,
      voiceoverUrl: null,
      group_id: p.groupId,
      mode: p.mode,
      expected_credits: p.expectedCredits,
      expected_minutes: p.expectedMinutes,
    },
  };
}

/** Patch applied to a chapter row by `rerenderChapter`. Pure for testing. */
export function buildRerenderChapterPatch(params: {
  scriptText: string;
  paragraphs: CachedParagraph[];
}): {
  script_text: string;
  paragraphs: Json;
  status: string;
  attempts: number;
  started_at: null;
  finished_at: null;
  output_path: null;
  error: null;
  claimed_at: null;
  claimed_by: null;
} {
  return {
    script_text: params.scriptText,
    paragraphs: params.paragraphs.map((p) => ({
      text: p.text,
      audio_path: p.audioPath,
      duration_seconds: p.durationSeconds,
    })),
    status: "queued",
    attempts: 0,
    started_at: null,
    finished_at: null,
    output_path: null,
    error: null,
    claimed_at: null,
    claimed_by: null,
  };
}

const RERENDER_BUCKET = "generated-videos";

async function synthesizeParagraphsCached(
  paragraphs: string[],
  voice: { voiceId: string; voiceModel: string; languageCode: string },
  supabaseAdmin: SupabaseClient<Database>,
  bucket: string,
): Promise<CachedParagraph[]> {
  const { synthesize, mp3Duration } = await import("../providers/voice.server");
  const deps = makeSupabaseTtsDeps(
    supabaseAdmin,
    { provider: "elevenlabs", voiceId: voice.voiceId, languageCode: voice.languageCode },
    bucket,
    async (text) => {
      const buf = await synthesize(text, {
        voiceId: voice.voiceId,
        model: voice.voiceModel,
      });
      const audio = Buffer.from(buf);
      return { audio, durationSeconds: mp3Duration(buf, text) };
    },
  );
  return synthesizeCachedParagraphs(paragraphs, deps);
}

/** Enqueue a chapter-mode (long-form) server render. Rate-limited like scenes path. */
export const enqueueChapterRender = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => ChapterEnqueueSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { reserveRenderBilling } = await import("../billing.functions");

    const chapters = splitScriptIntoChapters(data.script);
    if (chapters.length === 0) throw new Error("Script produced no chapters.");

    const brief = buildContinuityBrief({
      voiceId: data.voiceId,
      languageCode: data.languageCode,
      voiceModel: data.voiceModel,
    });

    // Narration for every paragraph, cached: only misses hit ElevenLabs.
    const narration = new Map<number, CachedParagraph[]>();
    let totalSeconds = 0;
    for (const c of chapters) {
      const paras = await synthesizeParagraphsCached(
        c.paragraphs,
        { voiceId: data.voiceId, voiceModel: data.voiceModel, languageCode: data.languageCode },
        supabaseAdmin,
        RERENDER_BUCKET,
      );
      narration.set(c.index, paras);
      totalSeconds += paras.reduce((a, p) => a + p.durationSeconds, 0);
    }
    totalSeconds = Math.max(1, totalSeconds);

    const aspects = resolveRenderAspects(data);
    const quote = quoteMultiAspectRender({
      durationSeconds: totalSeconds,
      mode: data.mode,
      premiumVoice: data.premiumVoice,
      aspectCount: aspects.length,
    });

    const groupId = randomUUID();
    const parentRows = aspects.map((aspect) =>
      buildChapterRenderRow({
        userId,
        groupId,
        aspect,
        title: data.title,
        fps: data.fps,
        burnCaptions: data.burnCaptions,
        mode: data.mode,
        totalSeconds,
        expectedCredits: quote.perAspect.totalCredits,
        expectedMinutes: quote.perAspect.minutes,
        brief,
      }),
    );

    // Reserve the EXACT quote per aspect row BEFORE inserting (same rule as
    // the scenes path: a failed reserve never leaves orphan queued renders).
    for (const row of parentRows) {
      await reserveRenderBilling(supabaseAdmin, userId, row.id!, quote.perAspect.totalCredits);
    }
    const { data: inserted, error } = await supabaseAdmin
      .from("renders")
      .insert(parentRows)
      .select("id");
    if (error) throw new Error(error.message);

    // One chapter set per aspect row: chapters render per-aspect (different
    // dimensions), but TTS audio is shared via the cache.
    const chapterRows = (inserted ?? []).flatMap((r) =>
      buildChapterRows(r.id, chapters, narration),
    );
    const { error: chError } = await supabaseAdmin
      .from("render_chapters")
      .insert(chapterRows);
    if (chError) throw new Error(chError.message);

    return {
      groupId,
      renderIds: (inserted ?? []).map((r) => r.id),
      chapterCount: chapters.length,
      quotedCredits: quote.grandTotal,
    };
  });

const RerenderChapterSchema = z.object({
  renderId: z.string().uuid(),
  chapterIndex: z.number().int().min(1),
  /** New script text for this chapter only. */
  scriptText: z.string().min(1).max(50_000),
});

/**
 * Re-render a single chapter with new script text.
 *
 * Only the targeted chapter row goes back to `queued`; unchanged paragraphs
 * reuse cached narration; the parent render is re-queued and the worker
 * re-stitches every chapter into a new final video. No new billing reserve
 * (D25: the parent's original exact quote still covers the finished
 * minutes, and settlement is idempotent).
 */
export const rerenderChapter = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => RerenderChapterSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Ownership + chapter-mode check on the parent render.
    const { data: render, error: renderError } = await supabase
      .from("renders")
      .select("id,user_id,engine,meta")
      .eq("id", data.renderId)
      .eq("user_id", userId)
      .eq("engine", "server_ffmpeg")
      .maybeSingle();
    if (renderError) throw new Error(renderError.message);
    if (!render) throw new Error("Render not found");
    const meta = (render.meta ?? {}) as {
      chapterMode?: boolean;
      continuityBrief?: { voice?: { id?: string; languageCode?: string; model?: string } };
    };
    if (meta.chapterMode !== true) throw new Error("Render is not a chapter-mode render");
    const chapter = await supabase
      .from("render_chapters")
      .select("id,render_id")
      .eq("render_id", data.renderId)
      .eq("chapter_index", data.chapterIndex)
      .maybeSingle();
    if (chapter.error) throw new Error(chapter.error.message);
    if (!chapter.data) throw new Error("Chapter not found");

    const voice = meta.continuityBrief?.voice ?? {};
    const paragraphs = splitIntoParagraphs(data.scriptText);
    const cached = await synthesizeParagraphsCached(
      paragraphs,
      {
        voiceId: voice.id ?? DEFAULT_VOICE_ID,
        voiceModel: voice.model ?? DEFAULT_VOICE_MODEL,
        languageCode: voice.languageCode ?? "en",
      },
      supabaseAdmin,
      RERENDER_BUCKET,
    );

    // Reset only this chapter; the worker's resume logic skips the `done`
    // siblings (valid output_path) and renders just this one.
    const patch = buildRerenderChapterPatch({ scriptText: data.scriptText, paragraphs: cached });
    const { error: patchError } = await supabase
      .from("render_chapters")
      .update(patch)
      .eq("id", chapter.data.id);
    if (patchError) throw new Error(patchError.message);

    // Re-queue the parent so the worker picks it up and re-stitches.
    // attempts resets: this is an explicit user retry, not a crash loop.
    const { error: requeueError } = await supabase
      .from("renders")
      .update({
        status: "queued",
        stage: "queued",
        progress: 0,
        attempts: 0,
        claimed_at: null,
        claimed_by: null,
        cancel_requested: false,
        error: null,
      })
      .eq("id", data.renderId)
      .eq("user_id", userId);
    if (requeueError) throw new Error(requeueError.message);

    return { ok: true, chapterIndex: data.chapterIndex, paragraphs: cached.length };
  });
