/**
 * F20 Video Studio — server functions.
 *
 * Scene list (with narration, visual prompt, asset thumb, status, duration
 * ESTIMATE), per-scene editor mutations, per-scene regeneration (audio OR
 * visual → new `scene_versions` row; never a whole-video re-render),
 * scene reorder/add/delete, and assemble → the client then calls the
 * EXISTING `enqueueServerRender` path (which already creates durable jobs —
 * D93) with the prepared timeline.
 *
 * Provider-touching cores are dynamically imported inside handlers so the
 * client-bundled module graph stays light (D86 pattern).
 */
import { createServerFn } from "@tanstack/react-start";
// NOTE: no node:crypto import — this module is client-bundled. Use the
// universal Web Crypto API instead (browsers, Node 19+, workers).
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAppUser } from "../../server-auth";
import type { Database, Json } from "@/integrations/supabase/types";
import { quoteMultiAspectRender } from "../../billing/per-minute";
import { buildSceneManifest, estimateSceneDurationSec } from "./manifest";
import { asStudioDb } from "./tables";
import { sceneCheckpointState } from "../checkpoints/checkpoints";
import type {
  StudioProject,
  StudioScene,
  AssembleSceneInput,
  QuoteSummary,
  SceneManifestJson,
} from "./types";

const ProjectIdSchema = z.object({ projectId: z.string().uuid() });

async function getOwnedProject(
  supabase: SupabaseClient<Database>,
  userId: string,
  projectId: string,
) {
  const { data, error } = await supabase
    .from("projects")
    .select("id,title,aspect_ratio,settings")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Project not found");
  return data;
}

/**
 * Scene list for a project: scene_number, narration, visual_prompt, asset
 * thumb, status, duration ESTIMATE — plus voiceover audio, caption cues,
 * version count, and F21 checkpoint state for the status chips.
 */
export const listStudioScenes = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => ProjectIdSchema.parse(i))
  .handler(async ({ data, context }): Promise<StudioProject> => {
    const { supabase, userId } = context;
    const project = await getOwnedProject(supabase, userId, data.projectId);

    const { data: scenes, error: scenesError } = await supabase
      .from("scenes")
      .select(
        "id,project_id,scene_number,narration,visual_type,visual_prompt,asset_url,asset_thumb_url,asset_source,duration,status",
      )
      .eq("project_id", project.id)
      .eq("user_id", userId)
      .order("scene_number", { ascending: true });
    if (scenesError) throw new Error(scenesError.message);

    const { data: voiceovers } = await supabase
      .from("voiceovers")
      .select("scene_id,audio_url")
      .eq("project_id", project.id);
    const { data: captions } = await supabase
      .from("captions")
      .select("scene_id,cues")
      .eq("project_id", project.id);

    // scene_versions counts (generated types lag the table — narrow client).
    const { data: versions } = await asStudioDb(supabase)
      .from("scene_versions")
      .select("scene_id,version_number")
      .in(
        "scene_id",
        (scenes ?? []).map((s: { id: string }) => s.id),
      );
    const versionCount = new Map<string, number>();
    for (const v of versions ?? []) {
      versionCount.set(v.scene_id, (versionCount.get(v.scene_id) ?? 0) + 1);
    }

    // F21: latest durable render job for this project carries the checkpoint.
    const { data: jobRows } = await asStudioDb(supabase)
      .from("generation_jobs")
      .select("id,job_type,status,attempt_count,max_attempts,updated_at,checkpoint")
      .eq("project_id", project.id)
      .in("job_type", ["server_render", "studio_render"])
      .order("created_at", { ascending: false })
      .limit(1);
    const jobRow = jobRows?.[0] ?? null;
    const checkpoint = (jobRow?.checkpoint ?? null) as never;

    const audioByScene = new Map(
      (voiceovers ?? []).map((v: { scene_id: string | null; audio_url: string | null }) => [
        v.scene_id,
        v.audio_url,
      ]),
    );
    const cuesByScene = new Map(
      (captions ?? []).map((c: { scene_id: string | null; cues: unknown }) => [
        c.scene_id,
        Array.isArray(c.cues) ? c.cues : [],
      ]),
    );

    const studioScenes: StudioScene[] = (scenes ?? []).map(
      (s: {
        id: string;
        project_id: string;
        scene_number: number;
        narration: string;
        visual_type: string;
        visual_prompt: string | null;
        asset_url: string | null;
        asset_thumb_url: string | null;
        asset_source: unknown;
        duration: unknown;
        status: string;
      }) => ({
        id: s.id,
        projectId: s.project_id,
        sceneNumber: s.scene_number,
        narration: s.narration,
        visualPrompt: s.visual_prompt,
        visualType: s.visual_type,
        assetUrl: s.asset_url,
        assetThumbUrl: s.asset_thumb_url,
        assetSource: (s.asset_source ?? {}) as Json,
        durationSecEstimate: estimateSceneDurationSec(
          s.narration,
          typeof s.duration === "number" ? s.duration : Number(s.duration) || null,
        ),
        status: s.status,
        audioUrl: audioByScene.get(s.id) ?? null,
        cues: ((cuesByScene.get(s.id) ?? []) as { start: number; end: number; text: string }[]).map(
          (c) => ({
            start: Number(c.start) || 0,
            end: Number(c.end) || 0,
            text: String(c.text ?? ""),
          }),
        ),
        checkpoint: sceneCheckpointState(checkpoint, s.id),
        versionCount: versionCount.get(s.id) ?? 0,
      }),
    );

    const manifest = buildSceneManifest(
      project.id,
      null,
      studioScenes.map((s) => ({
        sceneId: s.id,
        sceneNumber: s.sceneNumber,
        narration: s.narration,
        visualPrompt: s.visualPrompt,
        assetUrl: s.assetUrl,
        assetSource: s.assetSource,
        durationSec: s.durationSecEstimate,
        status: s.status,
        checkpoint: s.checkpoint ? { state: s.checkpoint.state } : null,
      })),
    );

    return {
      project: {
        id: project.id,
        title: project.title,
        aspectRatio: project.aspect_ratio,
        settings: project.settings ?? {},
      },
      scenes: studioScenes,
      // JSON-safe view of the pinned SceneManifest (see types.ts).
      manifest: manifest as unknown as SceneManifestJson,
      renderJob: jobRow
        ? {
            jobId: jobRow.id,
            jobType: jobRow.job_type,
            status: jobRow.status,
            attemptCount: jobRow.attempt_count,
            maxAttempts: jobRow.max_attempts,
            updatedAt: jobRow.updated_at,
          }
        : null,
    };
  });

// NOTE: no trailing type re-export — Database is imported only as a type above.

/** Per-scene editor: narration and/or visual prompt (whitelisted fields only). */
export const updateStudioScene = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        sceneId: z.string().uuid(),
        narration: z.string().max(5000).optional(),
        visualPrompt: z.string().max(5000).nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const patch: { narration?: string; visual_prompt?: string | null; updated_at: string } = {
      updated_at: new Date().toISOString(),
    };
    if (data.narration !== undefined) patch.narration = data.narration;
    if (data.visualPrompt !== undefined) patch.visual_prompt = data.visualPrompt;
    const { data: updated, error } = await context.supabase
      .from("scenes")
      .update(patch)
      .eq("id", data.sceneId)
      .eq("user_id", context.userId)
      .select("id,scene_number,narration,visual_prompt")
      .single();
    if (error) throw new Error(error.message);
    return updated;
  });

/** Per-scene regeneration: narration audio for ONE scene (new scene_versions row). */
export const regenerateSceneAudio = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        sceneId: z.string().uuid(),
        voiceId: z.string().max(100).optional(),
        voiceModel: z.string().max(100).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { regenerateSceneAudioCore } = await import("./regen.server");
    return regenerateSceneAudioCore(supabaseAdmin, context.userId, data.sceneId, {
      ...(data.voiceId !== undefined ? { voiceId: data.voiceId } : {}),
      ...(data.voiceModel !== undefined ? { voiceModel: data.voiceModel } : {}),
    });
  });

/** Per-scene regeneration: visual for ONE scene (new scene_versions row). */
export const regenerateSceneVisual = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        sceneId: z.string().uuid(),
        prompt: z.string().max(5000).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { regenerateSceneVisualCore } = await import("./regen.server");
    return regenerateSceneVisualCore(supabaseAdmin, context.userId, data.sceneId, {
      ...(data.prompt !== undefined ? { prompt: data.prompt } : {}),
    });
  });

/**
 * Scene reorder. Two-pass renumbering (negative temps first) so the
 * UNIQUE(project_id, scene_number) constraint can never collide mid-write.
 */
export const reorderStudioScenes = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        sceneIds: z.array(z.string().uuid()).min(1).max(200),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await getOwnedProject(supabase, userId, data.projectId);
    const { data: rows, error } = await supabase
      .from("scenes")
      .select("id")
      .eq("project_id", data.projectId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    const known = new Set((rows ?? []).map((r: { id: string }) => r.id));
    if (data.sceneIds.length !== known.size || !data.sceneIds.every((id) => known.has(id))) {
      throw new Error("Scene order must contain exactly the project's scenes");
    }
    // Pass 1: move everything to unique negative temps.
    for (const [index, id] of data.sceneIds.entries()) {
      const { error: e1 } = await supabase
        .from("scenes")
        .update({ scene_number: -(index + 1) })
        .eq("id", id);
      if (e1) throw new Error(e1.message);
    }
    // Pass 2: assign final 1-based numbers.
    for (const [index] of data.sceneIds.entries()) {
      const { error: e2 } = await supabase
        .from("scenes")
        .update({ scene_number: index + 1, updated_at: new Date().toISOString() })
        .eq("scene_number", -(index + 1))
        .eq("project_id", data.projectId);
      if (e2) throw new Error(e2.message);
    }
    return { ok: true as const, count: data.sceneIds.length };
  });

/** Add a scene after a given scene number (later scenes shift down safely). */
export const addStudioScene = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        afterSceneNumber: z.number().int().min(0).max(200).default(0),
        narration: z.string().max(5000).default(""),
        visualPrompt: z.string().max(5000).nullable().default(null),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await getOwnedProject(supabase, userId, data.projectId);
    const insertAt = data.afterSceneNumber + 1;
    // Shift later scenes down in DESCENDING order — with the unique
    // (project_id, scene_number) constraint, descending increments never
    // collide (5→6 before 4→5).
    const { data: later, error: laterError } = await supabase
      .from("scenes")
      .select("id,scene_number")
      .eq("project_id", data.projectId)
      .gte("scene_number", insertAt)
      .order("scene_number", { ascending: false });
    if (laterError) throw new Error(laterError.message);
    for (const row of later ?? []) {
      const { error } = await supabase
        .from("scenes")
        .update({ scene_number: (row as { scene_number: number }).scene_number + 1 })
        .eq("id", (row as { id: string }).id);
      if (error) throw new Error(error.message);
    }
    const { data: created, error: insertError } = await supabase
      .from("scenes")
      .insert({
        project_id: data.projectId,
        user_id: userId,
        scene_number: insertAt,
        narration: data.narration,
        visual_prompt: data.visualPrompt,
        status: "draft",
      })
      .select("id,scene_number")
      .single();
    if (insertError) throw new Error(insertError.message);
    return created;
  });

/** Delete a scene, then close the numbering gap (two-pass renumber). */
export const deleteStudioScene = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        sceneId: z.string().uuid(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await getOwnedProject(supabase, userId, data.projectId);
    const { error: delError } = await supabase
      .from("scenes")
      .delete()
      .eq("id", data.sceneId)
      .eq("project_id", data.projectId)
      .eq("user_id", userId);
    if (delError) throw new Error(delError.message);
    const { data: remaining, error: listError } = await supabase
      .from("scenes")
      .select("id")
      .eq("project_id", data.projectId)
      .order("scene_number", { ascending: true });
    if (listError) throw new Error(listError.message);
    const ids = (remaining ?? []).map((r: { id: string }) => r.id);
    for (const [index, id] of ids.entries()) {
      const { error } = await supabase
        .from("scenes")
        .update({ scene_number: -(index + 1) })
        .eq("id", id);
      if (error) throw new Error(error.message);
    }
    for (const [index] of ids.entries()) {
      const { error } = await supabase
        .from("scenes")
        .update({ scene_number: index + 1, updated_at: new Date().toISOString() })
        .eq("scene_number", -(index + 1))
        .eq("project_id", data.projectId);
      if (error) throw new Error(error.message);
    }
    return { ok: true as const, remaining: ids.length };
  });

const AssembleSchema = z.object({
  projectId: z.string().uuid(),
  aspect: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
  aspects: z
    .array(z.enum(["16:9", "9:16", "1:1"]))
    .min(1)
    .max(3)
    .optional(),
  burnCaptions: z.boolean().default(true),
  musicUrl: z.string().max(500).nullable().default(null),
  storyMode: z.boolean().default(true),
  parallax25d: z.boolean().default(false),
});

/**
 * Assemble: validate the studio timeline and return it in the exact shape
 * `enqueueServerRender` accepts, plus the pinned SceneManifest and the exact
 * quote. The CLIENT then calls the existing enqueueServerRender server fn —
 * one code path for enqueueing, which already creates the durable job (D93)
 * and reserves the exact quote.
 */
export const prepareStudioAssemble = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => AssembleSchema.parse(i))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      scenes: AssembleSceneInput[];
      manifest: SceneManifestJson;
      quote: QuoteSummary;
      missingVisuals: number;
    }> => {
      const { supabase, userId } = context;
      const project = await getOwnedProject(supabase, userId, data.projectId);
      const { data: scenes, error } = await supabase
        .from("scenes")
        .select("id,scene_number,narration,asset_url,duration")
        .eq("project_id", project.id)
        .eq("user_id", userId)
        .order("scene_number", { ascending: true });
      if (error) throw new Error(error.message);
      if (!scenes || scenes.length === 0) throw new Error("This project has no scenes yet");

      const { data: voiceovers } = await supabase
        .from("voiceovers")
        .select("scene_id,audio_url")
        .eq("project_id", project.id);
      const { data: captions } = await supabase
        .from("captions")
        .select("scene_id,cues")
        .eq("project_id", project.id);
      const audioByScene = new Map(
        (voiceovers ?? []).map((v: { scene_id: string | null; audio_url: string | null }) => [
          v.scene_id,
          v.audio_url,
        ]),
      );
      const cuesByScene = new Map(
        (captions ?? []).map((c: { scene_id: string | null; cues: unknown }) => [
          c.scene_id,
          Array.isArray(c.cues) ? c.cues : [],
        ]),
      );

      type SceneRow = {
        id: string;
        scene_number: number;
        narration: string;
        asset_url: string | null;
        duration: unknown;
      };
      const timeline: AssembleSceneInput[] = (scenes as SceneRow[]).map((s) => {
        const cues = (
          (cuesByScene.get(s.id) ?? []) as { start: number; end: number; text: string }[]
        ).map((c) => ({
          word: String(c.text ?? ""),
          start: Number(c.start) || 0,
          end: Number(c.end) || 0,
        }));
        return {
          id: s.id,
          number: s.scene_number,
          narration: s.narration,
          image: s.asset_url,
          audio: audioByScene.get(s.id) ?? null,
          duration: estimateSceneDurationSec(
            s.narration,
            typeof s.duration === "number" ? s.duration : Number(s.duration) || null,
          ),
          cues,
        };
      });

      const manifest = buildSceneManifest(
        project.id,
        null,
        timeline.map((t) => ({
          sceneId: t.id,
          sceneNumber: t.number,
          narration: t.narration,
          visualPrompt: null,
          assetUrl: t.image,
          assetSource: {},
          durationSec: t.duration,
          status: t.image ? "assets_ready" : "draft",
          checkpoint: null,
        })),
      );

      const missingVisuals = timeline.filter((t) => !t.image).length;
      const durationSeconds = timeline.reduce((sum, t) => sum + t.duration, 0);
      const aspects = data.aspects ?? [data.aspect];
      const quote = quoteMultiAspectRender({
        durationSeconds,
        mode: "story",
        stockFootage: false,
        aiHeroSeconds: 0,
        parallax25d: data.parallax25d,
        aspectCount: aspects.length,
      });

      return {
        scenes: timeline,
        // JSON-safe view of the pinned SceneManifest (see types.ts).
        manifest: manifest as unknown as SceneManifestJson,
        quote: {
          grandTotalCredits: quote.grandTotal,
          perAspectCredits: quote.perAspect.totalCredits,
          minutesPerAspect: quote.perAspect.minutes,
        },
        missingVisuals,
      };
    },
  );
