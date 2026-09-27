/**
 * F20 Video Studio — scene manifest producer (contract: coordinator-owned
 * `src/lib/creation/contracts.ts`; Stream E PRODUCES the SceneManifest shape,
 * Stream F consumes it).
 *
 * Pure functions only: DB rows in, a zod-validated SceneManifest out.
 * Duration values are ESTIMATES until measured from real narration audio
 * (D94: labeled, never promised).
 */
import {
  SceneManifestSchema,
  type SceneManifest,
  type SceneManifestScene,
  type SceneStatus,
} from "../contracts";
import type { Json } from "@/integrations/supabase/types";
import type { StudioScene } from "./types";

/** Narration speech rate used across the codebase (estimates.server.ts). */
export const STUDIO_WORDS_PER_MINUTE = 150;

/**
 * Duration ESTIMATE for a scene: the stored scene duration when it looks
 * sane, otherwise derived from narration word count at 150 wpm (+0.5s pad,
 * matching the browser renderer's measured-audio fallback).
 */
export function estimateSceneDurationSec(
  narration: string,
  storedDurationSec: number | null | undefined,
): number {
  if (typeof storedDurationSec === "number" && storedDurationSec > 0) {
    return storedDurationSec;
  }
  const words = narration.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 6;
  return Math.min(120, Math.max(1.5, (words / STUDIO_WORDS_PER_MINUTE) * 60 + 0.5));
}

/**
 * Map the free-text `scenes.status` column onto the pinned SceneStatus enum.
 * Unknown values degrade to "draft" — never invented.
 */
export function mapSceneStatus(status: string | null | undefined): SceneStatus {
  switch ((status ?? "").toLowerCase()) {
    case "assets_ready":
      return "assets_ready";
    case "narration_ready":
      return "narration_ready";
    case "rendered":
      return "rendered";
    case "failed":
      return "failed";
    default:
      return "draft";
  }
}

export interface ManifestSceneInput {
  sceneId: string;
  sceneNumber: number;
  narration: string;
  visualPrompt: string | null;
  assetUrl: string | null;
  /** scenes.asset_source is a Json column; non-objects degrade to {} below. */
  assetSource: Json;
  durationSec: number | null | undefined;
  status: string | null | undefined;
  checkpoint: Record<string, unknown> | null;
}

/** assetSource is documented as an object (kind/provider/rights); be strict. */
function toAssetSource(value: Json): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Build the pinned SceneManifest for a project's scenes. Throws (zod) only
 * when the shape itself is violated — callers pass rows straight through.
 */
export function buildSceneManifest(
  projectId: string,
  renderId: string | null,
  inputs: ManifestSceneInput[],
): SceneManifest {
  const scenes: SceneManifestScene[] = inputs.map((s) => ({
    sceneId: s.sceneId,
    sceneNumber: s.sceneNumber,
    narration: s.narration,
    visualPrompt: s.visualPrompt,
    assetUrl: s.assetUrl,
    assetSource: toAssetSource(s.assetSource),
    durationSecEstimate: estimateSceneDurationSec(s.narration, s.durationSec),
    status: mapSceneStatus(s.status),
    checkpoint: s.checkpoint,
  }));
  return SceneManifestSchema.parse({ projectId, renderId, scenes });
}

/** Convenience: manifest straight from studio rows (checkpoint state included). */
export function manifestFromStudioScenes(
  projectId: string,
  renderId: string | null,
  scenes: StudioScene[],
): SceneManifest {
  return buildSceneManifest(
    projectId,
    renderId,
    scenes.map((s) => ({
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
}
