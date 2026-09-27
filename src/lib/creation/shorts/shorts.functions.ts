/**
 * F24 Shorts Repurposing — server functions.
 *
 * `planShort` builds a deterministic 9:16 recut plan (scenes, tightened
 * script, title, hashtags, exact quote). The client then enqueues through
 * the EXISTING `enqueueServerRender` server function with
 * `aspects: ["9:16"]`, `parentId: <source project>` and `kind: "short"` —
 * one enqueue path (D93), linked to the source project (D54).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "../../server-auth";
import { quoteMultiAspectRender } from "../../billing/per-minute";
import type { QuoteSummary } from "../video-studio/types";
import { planShortRecut, type ShortPlan } from "./shorts";

/** Plan a 9:16 short recut from selected scenes of a project. */
export const planShort = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        sceneIds: z.array(z.string().uuid()).min(1).max(60),
        maxDurationSec: z.number().int().min(10).max(180).default(60),
      })
      .parse(i),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      plan: ShortPlan;
      quote: QuoteSummary;
      /** Scenes shaped for enqueueServerRender's SceneSchema (cues omitted — recut). */
      enqueueScenes: {
        id: string;
        number: number;
        narration: string;
        image: string | null;
        audio: null;
        duration: number;
        cues: [];
      }[];
    }> => {
      const { supabase, userId } = context;
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("id,title")
        .eq("id", data.projectId)
        .eq("user_id", userId)
        .maybeSingle();
      if (projectError) throw new Error(projectError.message);
      if (!project) throw new Error("Project not found");

      const { data: scenes, error: scenesError } = await supabase
        .from("scenes")
        .select("id,scene_number,narration,asset_url")
        .eq("project_id", project.id)
        .eq("user_id", userId)
        .in("id", data.sceneIds);
      if (scenesError) throw new Error(scenesError.message);
      if (!scenes || scenes.length === 0) throw new Error("Selected scenes not found");

      type SceneRow = {
        id: string;
        scene_number: number;
        narration: string;
        asset_url: string | null;
      };
      const plan = planShortRecut({
        projectId: project.id,
        projectTitle: project.title ?? "Untitled",
        maxDurationSec: data.maxDurationSec,
        scenes: (scenes as SceneRow[]).map((s) => ({
          sceneId: s.id,
          sceneNumber: s.scene_number,
          narration: s.narration,
          assetUrl: s.asset_url,
          durationSecEstimate: 0,
          selected: true,
        })),
      });

      const quote = quoteMultiAspectRender({
        durationSeconds: plan.estimatedDurationSec,
        mode: "story",
        stockFootage: false,
        aiHeroSeconds: 0,
        aspectCount: 1,
        parallax25d: false,
      });

      return {
        plan,
        quote: {
          grandTotalCredits: quote.grandTotal,
          perAspectCredits: quote.perAspect.totalCredits,
          minutesPerAspect: quote.perAspect.minutes,
        },
        enqueueScenes: plan.scenes.map((s, index) => ({
          id: s.sceneId,
          number: index + 1,
          narration: s.recutNarration,
          image: s.image,
          audio: null,
          duration: s.durationSecEstimate,
          cues: [] as [],
        })),
      };
    },
  );
