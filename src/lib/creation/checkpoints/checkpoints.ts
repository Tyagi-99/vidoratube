/**
 * F21 Render Checkpoints — durable per-scene checkpoint state on top of the
 * Phase-1 durable jobs (`generation_jobs.checkpoint` JSONB).
 *
 * Pure functions only. The checkpoint payload lives under the "studio" key:
 *
 *   { "studio": { "version": 1, "scenes": {
 *       "<sceneId>": { "status": "done"|"failed"|"invalidated",
 *                       "assetUrl": ..., "narrationAudioUrl": ...,
 *                       "durationSec": ..., "completedAt": ..., "error": ... }
 *   } } }
 *
 * Resume/skip: on retry the executor reads this state and skips scenes whose
 * status is "done" — it continues from the first incomplete scene. Repair
 * (F21 scene-level repair) invalidates exactly one scene's entry so only that
 * scene re-runs. All state is server-side (JSONB); long jobs survive closed
 * browsers and restarts — nothing lives in client memory.
 */
import type { Json } from "@/integrations/supabase/types";
import type { SceneCheckpointState } from "../video-studio/types";

/** Namespace inside generation_jobs.checkpoint for studio render state. */
export const STUDIO_CHECKPOINT_KEY = "studio";

export type StudioSceneCheckpointStatus = "done" | "failed" | "invalidated";

export interface StudioSceneCheckpoint {
  status: StudioSceneCheckpointStatus;
  assetUrl?: string | null;
  narrationAudioUrl?: string | null;
  durationSec?: number | null;
  completedAt?: string | undefined;
  /** Set when status is "failed". */
  error?: string | undefined;
  /** Set when status is "invalidated" (repair). */
  reason?: string | undefined;
}

export interface StudioCheckpoint {
  version: 1;
  scenes: Record<string, StudioSceneCheckpoint>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/** Read the studio checkpoint subtree; null when absent or malformed. */
export function getStudioCheckpoint(checkpoint: Json | null | undefined): StudioCheckpoint | null {
  if (!isRecord(checkpoint)) return null;
  const studio = checkpoint[STUDIO_CHECKPOINT_KEY];
  if (!isRecord(studio)) return null;
  const scenes = isRecord(studio["scenes"]) ? studio["scenes"] : {};
  const clean: Record<string, StudioSceneCheckpoint> = {};
  for (const [sceneId, entry] of Object.entries(scenes)) {
    if (!isRecord(entry)) continue;
    const status = entry["status"];
    if (status !== "done" && status !== "failed" && status !== "invalidated") continue;
    clean[sceneId] = {
      status,
      assetUrl: typeof entry["assetUrl"] === "string" ? entry["assetUrl"] : null,
      narrationAudioUrl:
        typeof entry["narrationAudioUrl"] === "string" ? entry["narrationAudioUrl"] : null,
      durationSec: typeof entry["durationSec"] === "number" ? entry["durationSec"] : null,
      completedAt: typeof entry["completedAt"] === "string" ? entry["completedAt"] : undefined,
      error: typeof entry["error"] === "string" ? entry["error"] : undefined,
      reason: typeof entry["reason"] === "string" ? entry["reason"] : undefined,
    };
  }
  return { version: 1, scenes: clean };
}

/** UI-facing per-scene state (drives the status chips). */
export function sceneCheckpointState(
  checkpoint: Json | null | undefined,
  sceneId: string,
): SceneCheckpointState {
  const studio = getStudioCheckpoint(checkpoint);
  const entry = studio?.scenes[sceneId];
  if (!entry) return { state: "pending" };
  if (entry.status === "done") {
    return {
      state: "done",
      completedAt: entry.completedAt ?? "",
      durationSec: entry.durationSec ?? null,
    };
  }
  if (entry.status === "failed") {
    return { state: "failed", error: entry.error ?? "scene render failed" };
  }
  return { state: "invalidated", reason: entry.reason ?? "invalidated by repair" };
}

/**
 * Skip logic: the id of the first scene that is NOT done, in the caller's
 * scene order. Returns null when every scene is done (nothing to resume).
 * "failed" and "invalidated" scenes are NOT skipped — they re-run.
 */
export function firstIncompleteSceneId(
  orderedSceneIds: string[],
  checkpoint: Json | null | undefined,
): string | null {
  const studio = getStudioCheckpoint(checkpoint);
  for (const sceneId of orderedSceneIds) {
    if (studio?.scenes[sceneId]?.status !== "done") return sceneId;
  }
  return null;
}

/** Record a scene's completion (assets, narration audio URL, timings). */
export function markSceneComplete(
  checkpoint: Json | null | undefined,
  sceneId: string,
  payload: {
    assetUrl?: string | null;
    narrationAudioUrl?: string | null;
    durationSec?: number | null;
  },
): StudioCheckpoint {
  const studio = getStudioCheckpoint(checkpoint) ?? { version: 1 as const, scenes: {} };
  return {
    version: 1,
    scenes: {
      ...studio.scenes,
      [sceneId]: {
        status: "done",
        assetUrl: payload.assetUrl ?? null,
        narrationAudioUrl: payload.narrationAudioUrl ?? null,
        durationSec: payload.durationSec ?? null,
        completedAt: new Date().toISOString(),
      },
    },
  };
}

/** Record a scene's failure (kept so resume retries it, and the UI shows why). */
export function markSceneFailed(
  checkpoint: Json | null | undefined,
  sceneId: string,
  error: string,
): StudioCheckpoint {
  const studio = getStudioCheckpoint(checkpoint) ?? { version: 1 as const, scenes: {} };
  return {
    version: 1,
    scenes: {
      ...studio.scenes,
      [sceneId]: { status: "failed", error: error.slice(0, 500) },
    },
  };
}

/**
 * Scene-level repair: invalidate ONLY this scene's checkpoint entry. Sibling
 * scenes keep their "done" state, so the next run skips them and re-runs
 * just this scene. Returns the new checkpoint subtree (merge into the job's
 * checkpoint via saveCheckpoint — the deep merge preserves siblings).
 */
export function invalidateSceneCheckpoint(
  checkpoint: Json | null | undefined,
  sceneId: string,
  reason: string,
): StudioCheckpoint {
  const studio = getStudioCheckpoint(checkpoint) ?? { version: 1 as const, scenes: {} };
  return {
    version: 1,
    scenes: {
      ...studio.scenes,
      [sceneId]: { status: "invalidated", reason: reason.slice(0, 500) },
    },
  };
}

export interface CheckpointSummary {
  total: number;
  done: number;
  failed: number;
  invalidated: number;
  pending: number;
}

/** Counts per state over the caller's scene list. */
export function summarizeCheckpoint(
  orderedSceneIds: string[],
  checkpoint: Json | null | undefined,
): CheckpointSummary {
  const summary: CheckpointSummary = {
    total: orderedSceneIds.length,
    done: 0,
    failed: 0,
    invalidated: 0,
    pending: 0,
  };
  const studio = getStudioCheckpoint(checkpoint);
  for (const sceneId of orderedSceneIds) {
    const status = studio?.scenes[sceneId]?.status;
    if (status === "done") summary.done += 1;
    else if (status === "failed") summary.failed += 1;
    else if (status === "invalidated") summary.invalidated += 1;
    else summary.pending += 1;
  }
  return summary;
}
