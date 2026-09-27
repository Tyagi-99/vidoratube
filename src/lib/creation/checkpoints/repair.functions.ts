/**
 * F21 Render Checkpoints — scene-level repair (pinned SceneRepairRequest).
 *
 * Repair semantics (D100 — the pinned contract has BOTH "narration" and
 * "audio", so the distinction must be explicit):
 *   - "narration": the narration TEXT is wrong → user edits it in the studio
 *     editor, then regenerates audio from the new text (paid, via the
 *     existing regenerateSceneAudio flow with its own preflight/debit).
 *   - "audio": the text is fine but the audio is bad → regenerate audio
 *     from the existing narration (paid, same flow).
 *   - "visual": regenerate the scene's image (paid, regenerateSceneVisual).
 *   - "timing": duration estimate is wrong → recomputeSceneTimingCore (free).
 *
 * This function NEVER calls a provider and NEVER spends credits. It does
 * the free part of every repair: invalidate EXACTLY this scene's checkpoint
 * entry (siblings keep "done" so the next run skips them and re-runs only
 * this scene), and for "timing" it also runs the free recompute core.
 * Paid kinds return `nextStep` guidance — the client calls the existing
 * studio regen functions, which carry their own preflight + debit.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "../../server-auth";
import type { SceneRepairRequest } from "../contracts";
import { asStudioDb } from "../video-studio/tables";
import {
  STUDIO_CHECKPOINT_KEY,
  getStudioCheckpoint,
  invalidateSceneCheckpoint,
  summarizeCheckpoint,
} from "./checkpoints";

const RepairSchema = z.object({
  sceneId: z.string().uuid(),
  repairKind: z.enum(["narration", "visual", "audio", "timing"]),
  note: z.string().max(500),
});

const TIMING_ONLY_MIN = 0.5;
const TIMING_ONLY_MAX = 600;

/** Scene checkpoint status for a project (drives the status chips). */
export const fetchSceneCheckpointStatus = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ projectId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("id", data.projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!project) throw new Error("Project not found");
    const { data: scenes } = await supabase
      .from("scenes")
      .select("id,scene_number")
      .eq("project_id", project.id)
      .order("scene_number", { ascending: true });
    const { data: jobs } = await asStudioDb(supabase)
      .from("generation_jobs")
      .select("id,checkpoint,updated_at")
      .eq("project_id", project.id)
      .in("job_type", ["server_render", "studio_render"])
      .order("created_at", { ascending: false })
      .limit(1);
    // The checkpoint subtree is validated by getStudioCheckpoint (never trusted raw).
    const job = jobs?.[0] ?? null;
    const orderedIds = (scenes ?? []).map((s: { id: string }) => s.id);
    return {
      jobId: job?.id ?? null,
      studio: getStudioCheckpoint(
        (job?.checkpoint ?? null) as Parameters<typeof getStudioCheckpoint>[0],
      ),
      summary: summarizeCheckpoint(
        orderedIds,
        (job?.checkpoint ?? null) as Parameters<typeof getStudioCheckpoint>[0],
      ),
    };
  });

/** Invalidate one scene's checkpoint entry (repair). Never a full re-render. */
export const repairScene = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => RepairSchema.parse(i))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      ok: true;
      jobId: string | null;
      invalidated: boolean;
      nextStep: string;
    }> => {
      const request: SceneRepairRequest = data;
      const { supabase, userId } = context;

      const { data: scene } = await supabase
        .from("scenes")
        .select("id,project_id,narration")
        .eq("id", request.sceneId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!scene) throw new Error("Scene not found");

      const { data: jobs } = await asStudioDb(supabase)
        .from("generation_jobs")
        .select("id,checkpoint")
        .eq("project_id", (scene as { project_id: string }).project_id)
        .in("job_type", ["server_render", "studio_render"])
        .order("created_at", { ascending: false })
        .limit(1);
      const job = jobs?.[0] ?? null;

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const jobId: string | null = job?.id ?? null;
      let invalidated = false;

      if (job) {
        const { saveCheckpoint } = await import("../../jobs/durable-jobs.server");
        const invalidatedSubtree = invalidateSceneCheckpoint(
          (job.checkpoint ?? null) as Parameters<typeof invalidateSceneCheckpoint>[0],
          request.sceneId,
          `${request.repairKind}: ${request.note}`,
        );
        // saveCheckpoint deep-merges: siblings keep their "done" state, so
        // only this scene re-runs on retry.
        await saveCheckpoint(supabaseAdmin, job.id, {
          [STUDIO_CHECKPOINT_KEY]: invalidatedSubtree as never,
        });
        invalidated = true;
      }

      // Free timing fix runs here; paid kinds are returned as guidance.
      if (request.repairKind === "timing") {
        const { recomputeSceneTimingCore } = await import("../video-studio/regen.server");
        const match = request.note.match(/(\d+(?:\.\d+)?)\s*s/);
        const durationSec = match ? Number(match[1]) : null;
        if (durationSec == null || durationSec < TIMING_ONLY_MIN || durationSec > TIMING_ONLY_MAX) {
          throw new Error(
            'Timing repair needs the corrected duration in the note, e.g. "should be 4.5s"',
          );
        }
        const result = await recomputeSceneTimingCore(
          supabaseAdmin,
          userId,
          request.sceneId,
          durationSec,
        );
        if (!result.ok) throw new Error(result.error ?? "Timing repair failed");
      }

      const nextStep =
        request.repairKind === "narration"
          ? "Edit the narration in the scene editor, then use Regenerate audio — the new audio costs TTS credits (quoted before you confirm)."
          : request.repairKind === "audio"
            ? "Use Regenerate audio on this scene — it re-synthesizes from the existing narration (quoted before you confirm)."
            : request.repairKind === "visual"
              ? "Use Regenerate visual on this scene (quoted before you confirm)."
              : "Timing corrected — no audio or visual re-render needed.";

      return { ok: true, jobId, invalidated, nextStep };
    },
  );
