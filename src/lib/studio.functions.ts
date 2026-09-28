import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "./server-auth";
import { deriveTopicFromSource, validateProjectSource } from "./studio/project-sources";

/* ------------------------------- schemas -------------------------------- */

const createSchema = z.object({
  topic: z.string().trim().max(300).default(""),
  script: z.string().trim().max(40000).optional(),
  mode: z.enum(["stock", "image", "video"]).default("stock"),
  category: z.string().trim().max(120).optional(),
  preset: z.enum(["sleep", "documentary", "war_history"]).default("documentary"),
  visual_style: z.string().trim().max(60).default("cinematic_realistic"),
  language: z.string().trim().max(40).default("English"),
  duration_minutes: z.number().int().min(1).max(60).default(5),
  aspect_ratio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
  /* Phase 6 Stream E (P5): multi-source ingestion — provenance columns. */
  source_kind: z.enum(["topic", "draft", "transcript", "article", "url"]).default("topic"),
  source_text: z.string().trim().max(100000).optional(),
  source_url: z.string().trim().max(2048).optional(),
});

const idSchema = z.object({ id: z.string().uuid() });

/* -------------------------------- reads --------------------------------- */

export const listCategories = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("categories")
      .select("group_name, name, slug")
      .eq("active", true)
      .order("sort_order");
    return data ?? [];
  });

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("projects")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getProject = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => idSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: project, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!project) throw new Error("Project not found");

    const [{ data: scenes }, { data: voices }, { data: caps }] = await Promise.all([
      supabase.from("scenes").select("*").eq("project_id", project.id).order("scene_number"),
      supabase.from("voiceovers").select("*").eq("project_id", project.id),
      supabase.from("captions").select("*").eq("project_id", project.id),
    ]);

    return { project, scenes: scenes ?? [], voiceovers: voices ?? [], captions: caps ?? [] };
  });

export const getUsageSummary = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("api_usage")
      .select("provider, operation, units, estimated_cost")
      .eq("user_id", context.userId)
      .limit(1000);
    const rows = data ?? [];
    const byProvider: Record<string, { units: number; cost: number; calls: number }> = {};
    for (const r of rows) {
      const bucket = (byProvider[r.provider] ??= { units: 0, cost: 0, calls: 0 });
      bucket.units += Number(r.units);
      bucket.cost += Number(r.estimated_cost);
      bucket.calls += 1;
    }
    return byProvider;
  });

/* ------------------------------- mutations ------------------------------- */

export const createProject = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => createSchema.parse(i))
  .handler(async ({ data, context }) => {
    if (data.mode === "video") throw new Error("Complete Video Mode is coming soon.");
    // Phase 6 Stream E (P5): source validation — URL is reference-only, never fetched.
    const sourceErrors = validateProjectSource({
      topic: data.topic,
      script: data.script,
      sourceKind: data.source_kind,
      sourceText: data.source_text,
      sourceUrl: data.source_url,
    });
    if (sourceErrors.length > 0) throw new Error(sourceErrors[0]);
    const topic =
      data.topic ||
      (data.source_kind === "topic"
        ? ""
        : deriveTopicFromSource(data.source_text ?? ""));

    const { data: project, error } = await context.supabase
      .from("projects")
      .insert({
        user_id: context.userId,
        topic: topic,
        script: data.script ?? null,
        title: (topic || "Untitled project").slice(0, 120),
        mode: data.mode,
        category: data.category ?? null,
        preset: data.preset,
        visual_style: data.visual_style,
        language: data.language,
        duration_minutes: data.duration_minutes,
        aspect_ratio: data.aspect_ratio,
        source_kind: data.source_kind,
        source_text: data.source_text?.trim() ? data.source_text : null,
        source_url: data.source_url?.trim() ? data.source_url : null,
        status: "draft",
        stage: "created",
        step: "Ready to generate",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return project;
  });

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => idSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("projects")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const duplicateProject = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => idSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { data: source, error } = await context.supabase
      .from("projects")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!source) throw new Error("Project not found");

    const { data: copy, error: insertError } = await context.supabase
      .from("projects")
      .insert({
        user_id: context.userId,
        topic: source.topic,
        script: source.script,
        title: `${source.title} (copy)`,
        mode: source.mode,
        category: source.category,
        preset: source.preset,
        visual_style: source.visual_style,
        language: source.language,
        duration_minutes: source.duration_minutes,
        aspect_ratio: source.aspect_ratio,
        settings: source.settings,
      })
      .select()
      .single();
    if (insertError) throw new Error(insertError.message);
    return copy;
  });

const sceneUpdateSchema = z.object({
  id: z.string().uuid(),
  narration: z.string().max(4000).optional(),
  visual_type: z.enum(["STOCK_VIDEO", "STOCK_IMAGE", "AI_IMAGE", "MAP", "GRAPHIC", "TEXT_ONLY"]).optional(),
  visual_prompt: z.string().max(4000).optional(),
  negative_prompt: z.string().max(2000).optional(),
  search_query: z.string().max(600).optional(),
  style_override: z.string().max(60).nullable().optional(),
  character_id: z.string().uuid().nullable().optional(),
  voice_id: z.string().max(120).nullable().optional(),
  transition: z.string().max(40).optional(),
  motion_type: z.string().max(40).optional(),
  duration: z.number().min(1).max(120).optional(),
});

export const updateScene = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => sceneUpdateSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { id, ...rest } = data;
    const patch = Object.fromEntries(
      Object.entries(rest).filter(([, value]) => value !== undefined),
    );
    const { data: scene, error } = await context.supabase
      .from("scenes")
      .update(patch as never)
      .eq("id", id)
      .eq("user_id", context.userId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return scene;
  });

export const deleteScene = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => idSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("scenes")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Regenerates one scene only — visual, voice and captions — without touching the rest. */
export const regenerateScene = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z
      .object({ id: z.string().uuid(), what: z.enum(["visual", "voice", "both"]).default("both") })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // 30 regenerations per hour per user (image + TTS provider spend).
    const { enforcePostgresRateLimit } = await import("./rate-limit");
    await enforcePostgresRateLimit(
      supabaseAdmin,
      `studio:regen:${userId}`,
      { max: 30, windowSeconds: 3600 },
      "You're regenerating scenes too fast. Please wait a bit and try again.",
    );
    const { resolveSceneVisual, generateSceneVoice, buildCues } = await import("./studio.server");

    const { data: scene } = await supabase
      .from("scenes")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!scene) throw new Error("Scene not found");
    const { data: project } = await supabase
      .from("projects")
      .select("*")
      .eq("id", scene.project_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!project) throw new Error("Project not found");

    try {
      if (data.what === "visual" || data.what === "both") {
        // P4: load the scene's character (if any) for prompt consistency.
        let characterName: string | null = null;
        let characterDescription: string | null = null;
        if (scene.character_id) {
          const { data: ch } = await supabaseAdmin
            .from("characters")
            .select("name,description")
            .eq("id", scene.character_id)
            .eq("user_id", userId)
            .maybeSingle();
          if (ch) {
            characterName = ch.name;
            characterDescription = ch.description;
          }
        }
        const visual = await resolveSceneVisual(supabaseAdmin, {
          userId,
          projectId: project.id,
          sceneId: scene.id,
          sceneNumber: scene.scene_number,
          mode: project.mode,
          visualType: scene.visual_type as never,
          searchQuery: scene.search_query,
          imagePrompt: scene.visual_prompt,
          negativePrompt: scene.negative_prompt,
          style: scene.style_override ?? project.visual_style,
          aspectRatio: project.aspect_ratio,
          visualBible: (project.visual_bible ?? {}) as Record<string, unknown>,
          characterName,
          characterDescription,
        });
        await supabase
          .from("scenes")
          .update({
            asset_url: visual.url,
            asset_thumb_url: visual.thumb,
            asset_source: visual.source as never,
            visual_type: visual.visualType,
            status: "ready",
            error: null,
          })
          .eq("id", scene.id);
      }

      if (data.what === "voice" || data.what === "both") {
        const settings = (project.settings ?? {}) as { voice?: Record<string, number | string> };
        // P4: per-scene voice override wins over the project default.
        const voiceSettings = scene.voice_id
          ? { ...settings.voice, voiceId: scene.voice_id }
          : settings.voice;
        const voice = await generateSceneVoice(supabaseAdmin, {
          userId,
          projectId: project.id,
          sceneId: scene.id,
          sceneNumber: scene.scene_number,
          narration: scene.narration,
          settings: voiceSettings as never,
        });
        await supabase.from("scenes").update({ duration: voice.duration }).eq("id", scene.id);
        const captionStyle = ((project.settings ?? {}) as { captionStyle?: string }).captionStyle ?? "documentary";
        await supabaseAdmin.from("captions").delete().eq("scene_id", scene.id);
        await supabaseAdmin.from("captions").insert({
          project_id: project.id,
          scene_id: scene.id,
          user_id: userId,
          style: captionStyle,
          cues: buildCues(scene.narration, voice.duration, captionStyle) as never,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Scene failed";
      await supabase.from("scenes").update({ status: "failed", error: message }).eq("id", scene.id);
      throw new Error(message);
    }

    const { data: fresh } = await supabase.from("scenes").select("*").eq("id", scene.id).maybeSingle();
    return fresh;
  });

/**
 * Drives the pipeline one step per call so nothing blocks a request.
 * The client polls this and renders the real stage list.
 */
export const advanceProject = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => idSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { planProject, resolveSceneVisual, generateSceneVoice, buildCues } = await import("./studio.server");
    const { presetById, VISUAL_BATCH, VOICE_BATCH } = await import("./studio-config");

    const { data: project, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!project) throw new Error("Project not found");
    if (project.status === "completed" || project.status === "failed") return project;

    const save = async (patch: Record<string, unknown>) => {
      const { data: next, error: err } = await supabase
        .from("projects")
        .update(patch as never)
        .eq("id", project.id)
        .select()
        .single();
      if (err) throw new Error(err.message);
      return next;
    };

    try {
      switch (project.stage) {
        case "created":
        case "script": {
          const plan = await planProject(
            {
              topic: project.topic,
              script: project.script,
              mode: project.mode,
              preset: project.preset,
              category: project.category,
              language: project.language,
              durationMinutes: project.duration_minutes,
              style: project.visual_style,
            },
            { admin: supabaseAdmin, userId, projectId: project.id, mode: "story" },
          );
          const preset = presetById(project.preset);

          await supabaseAdmin.from("scenes").delete().eq("project_id", project.id);
          await supabaseAdmin.from("scenes").insert(
            plan.scenes.map((s, index) => ({
              project_id: project.id,
              user_id: userId,
              scene_number: index + 1,
              narration: s.narration,
              visual_type: project.mode === "image" ? "AI_IMAGE" : s.visual_type,
              visual_prompt: s.image_prompt,
              negative_prompt: s.negative_prompt,
              search_query: (s.search_queries ?? []).join(" | "),
              transition: preset.transition,
              motion_type: preset.motion,
              duration: preset.minScene,
              status: "pending",
            })),
          );

          return await save({
            title: plan.title || project.title,
            narration: plan.scenes.map((s) => s.narration).join("\n\n"),
            visual_bible: plan.visual_bible ?? {},
            status: "running",
            stage: "visuals",
            step: "Finding visuals",
          });
        }

        case "visuals": {
          const { data: pending } = await supabase
            .from("scenes")
            .select("*")
            .eq("project_id", project.id)
            .is("asset_url", null)
            .neq("status", "failed")
            .order("scene_number")
            .limit(VISUAL_BATCH);

          if (!pending || pending.length === 0) {
            return await save({ stage: "voice", step: "Recording voiceover" });
          }

          // Scenes are independent, so resolve the whole batch concurrently.
          await Promise.allSettled(
            pending.map(async (scene) => {
              try {
                const visual = await resolveSceneVisual(supabaseAdmin, {
                  userId,
                  projectId: project.id,
                  sceneId: scene.id,
                  sceneNumber: scene.scene_number,
                  mode: project.mode,
                  visualType: scene.visual_type as never,
                  searchQuery: scene.search_query,
                  imagePrompt: scene.visual_prompt,
                  negativePrompt: scene.negative_prompt,
                  style: scene.style_override ?? project.visual_style,
                  aspectRatio: project.aspect_ratio,
                  visualBible: (project.visual_bible ?? {}) as Record<string, unknown>,
                });
                await supabaseAdmin
                  .from("scenes")
                  .update({
                    asset_url: visual.url,
                    asset_thumb_url: visual.thumb,
                    asset_source: visual.source as never,
                    visual_type: visual.visualType,
                    status: "ready",
                    error: null,
                  })
                  .eq("id", scene.id);
              } catch (sceneError) {
                // One failed scene never stops the project.
                await supabaseAdmin
                  .from("scenes")
                  .update({
                    status: "failed",
                    error: sceneError instanceof Error ? sceneError.message : "Visual failed",
                  })
                  .eq("id", scene.id);
              }
            }),
          );
          return await save({ step: "Finding visuals" });
        }

        case "voice": {
          const { data: scenes } = await supabase
            .from("scenes")
            .select("*")
            .eq("project_id", project.id)
            .order("scene_number");
          const { data: done } = await supabase.from("voiceovers").select("scene_id").eq("project_id", project.id);
          const doneIds = new Set((done ?? []).map((d) => d.scene_id));
          const next = (scenes ?? []).filter((s) => !doneIds.has(s.id)).slice(0, VOICE_BATCH);

          if (next.length === 0) {
            const thumb = (scenes ?? []).find((s) => s.asset_thumb_url)?.asset_thumb_url ?? null;
            return await save({ stage: "captions", step: "Writing captions", thumbnail_url: thumb });
          }

          const settings = (project.settings ?? {}) as { voice?: Record<string, unknown> };
          const preset = presetById(project.preset);
          // Voice synthesis is the slowest step, so run a small batch in parallel.
          const results = await Promise.allSettled(
            next.map(async (scene) => {
              const voice = await generateSceneVoice(supabaseAdmin, {
                userId,
                projectId: project.id,
                sceneId: scene.id,
                sceneNumber: scene.scene_number,
                narration: scene.narration,
                settings: (settings.voice ?? {}) as never,
              });
              await supabaseAdmin
                .from("scenes")
                .update({
                  duration: Math.max(preset.minScene * 0.5, voice.duration),
                  status: "ready",
                })
                .eq("id", scene.id);
            }),
          );

          const failures = results.filter((r) => r.status === "rejected");
          if (failures.length === results.length) {
            const reason = (failures[0] as PromiseRejectedResult | undefined)?.reason;
            await supabaseAdmin
              .from("scenes")
              .update({
                status: "failed",
                error: reason instanceof Error ? reason.message : "Voice failed",
              })
              .in(
                "id",
                next.map((s) => s.id),
              );
            throw reason instanceof Error ? reason : new Error("Voice generation failed");
          }
          return await save({ step: "Recording voiceover" });
        }

        case "captions": {
          const { data: scenes } = await supabase
            .from("scenes")
            .select("id, narration, duration")
            .eq("project_id", project.id)
            .order("scene_number");
          const style = ((project.settings ?? {}) as { captionStyle?: string }).captionStyle ??
            presetById(project.preset).captionStyle;

          await supabaseAdmin.from("captions").delete().eq("project_id", project.id);
          await supabaseAdmin.from("captions").insert(
            (scenes ?? []).map((s) => ({
              project_id: project.id,
              scene_id: s.id,
              user_id: userId,
              style,
              cues: buildCues(s.narration, Number(s.duration), style) as never,
            })),
          );
          return await save({ stage: "ready", step: "Assets ready" });
        }

        case "ready": {
          return await save({
            status: "completed",
            stage: "done",
            step: "Ready to export",
            error: null,
          });
        }

        default:
          return project;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generation failed";
      return await save({ status: "failed", stage: "failed", step: "Failed", error: message });
    }
  });
