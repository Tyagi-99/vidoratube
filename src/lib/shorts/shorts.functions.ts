import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "../server-auth";
import { selectShorts, quoteShorts, MAX_SHORTS, type ShortScene } from "./select";
import { assignStoryBeats } from "../story-template";

/**
 * Suggest highlight Shorts for a completed render.
 *
 * Reads the project's scenes + captions, assigns story beats from scene
 * durations (the same assignStoryBeats the render pipeline uses — no
 * per-scene scores are stored anywhere), and runs the documented selection
 * heuristic. Returns the suggested windows plus the exact quote.
 * No credits move here; queueing is a separate step (shipping next).
 */
export const suggestShorts = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        renderId: z.string().uuid(),
        maxCount: z.number().int().min(1).max(MAX_SHORTS).default(MAX_SHORTS),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: render, error: renderError } = await supabase
      .from("renders")
      .select("id, duration, project_id")
      .eq("id", data.renderId)
      .eq("user_id", userId)
      .eq("status", "completed")
      .maybeSingle();
    if (renderError) throw new Error(renderError.message);
    if (!render) throw new Error("Completed render not found");
    if (!render.project_id) throw new Error("Render has no project");
    const projectId = render.project_id;

    const { data: scenes, error: scenesError } = await supabase
      .from("scenes")
      .select("id, scene_number, narration, duration")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .order("scene_number", { ascending: true });
    if (scenesError) throw new Error(scenesError.message);

    const durations = (scenes ?? []).map((s) => Number(s.duration) || 0);
    const beats = assignStoryBeats(durations);

    const { data: captions } = await supabase
      .from("captions")
      .select("scene_id, cues")
      .eq("project_id", projectId)
      .eq("user_id", userId);
    const captionCharsByScene = new Map<string, number>();
    for (const c of captions ?? []) {
      const cues = (c.cues ?? []) as Array<{ text?: string }>;
      const chars = cues.reduce((sum, cue) => sum + (cue.text?.length ?? 0), 0);
      if (c.scene_id) captionCharsByScene.set(c.scene_id, chars);
    }

    let t = 0;
    const shortScenes: ShortScene[] = (scenes ?? []).map((s, i) => {
      const duration = Math.max(0, Number(s.duration) || 0);
      const scene: ShortScene = {
        id: s.id,
        start: t,
        duration,
        captionChars: captionCharsByScene.get(s.id) ?? s.narration?.length ?? 0,
        beatId: beats[i],
      };
      t += duration;
      return scene;
    });

    const result = selectShorts(shortScenes, { maxCount: data.maxCount });
    const quote = quoteShorts(result.windows.length);
    return {
      renderId: render.id,
      windows: result.windows.map((w, i) => ({
        index: i + 1,
        start: Math.round(w.start * 100) / 100,
        end: Math.round(w.end * 100) / 100,
        duration: Math.round((w.end - w.start) * 100) / 100,
        score: Math.round(w.score.total * 100) / 100,
        reason: w.reason,
      })),
      note: result.note,
      quote,
    };
  });
