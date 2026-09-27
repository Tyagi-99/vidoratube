/**
 * F20 Video Studio — shared types.
 *
 * The studio reads the project's `scenes` rows (the mutable head), joins
 * per-scene voiceover audio + caption cues, and overlays durable checkpoint
 * state from the project's latest render job (F21). Per-scene regeneration
 * writes a new `scene_versions` row — the scene row itself stays the live
 * head — and never re-renders the whole video for a scene fix.
 */
import type { SceneStatus } from "../contracts";
import type { Json } from "@/integrations/supabase/types";

/** One studio row: scene + its production state. */
export interface StudioScene {
  id: string;
  projectId: string;
  sceneNumber: number;
  narration: string;
  visualPrompt: string | null;
  visualType: string;
  assetUrl: string | null;
  assetThumbUrl: string | null;
  /** scenes.asset_source is a Json column. */
  assetSource: Json;
  /** ESTIMATE until measured from real narration audio. */
  durationSecEstimate: number;
  status: string;
  /** Latest narration audio for this scene (voiceovers.scene_id). */
  audioUrl: string | null;
  /** Caption cues for this scene (captions.scene_id). */
  cues: { start: number; end: number; text: string }[];
  /** Durable checkpoint state from the latest render job, if any (F21). */
  checkpoint: SceneCheckpointState | null;
  /** Number of entries in scene_versions for this scene. */
  versionCount: number;
}

/** Per-scene checkpoint state surfaced as UI status chips (F21). */
export type SceneCheckpointState =
  | { state: "pending" }
  | { state: "done"; completedAt: string; durationSec: number | null }
  | { state: "failed"; error: string }
  | { state: "invalidated"; reason: string };

/** The project's latest render job carrying studio checkpoints. */
export interface StudioRenderJob {
  jobId: string;
  jobType: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  updatedAt: string;
}

export interface StudioProject {
  project: {
    id: string;
    title: string;
    aspectRatio: string;
    /** projects.settings is a Json column. */
    settings: Json;
  };
  scenes: StudioScene[];
  /**
   * The pinned SceneManifest. Typed as a JSON-safe view (instead of the
   * zod-inferred `Record<string, unknown>` fields) so TanStack Start's
   * compile-time serializability check accepts the server-fn return — the
   * runtime value is identical and still parses via SceneManifestSchema.
   */
  manifest: SceneManifestJson;
  renderJob: StudioRenderJob | null;
}

/** JSON-safe view of the pinned SceneManifest (see StudioProject.manifest). */
export interface SceneManifestJson {
  projectId: string;
  renderId: string | null;
  scenes: {
    sceneId: string;
    sceneNumber: number;
    narration: string;
    visualPrompt: string | null;
    assetUrl: string | null;
    assetSource: Json;
    durationSecEstimate: number;
    status: SceneStatus;
    checkpoint: Json;
  }[];
}

/** Assemble input accepted by prepareStudioAssemble (mirrors the enqueue scene shape). */
export interface AssembleSceneInput {
  id: string;
  number: number;
  narration: string;
  image: string | null;
  audio: string | null;
  duration: number;
  cues: { word: string; start: number; end: number }[];
}

/** Exact-quote summary surfaced next to a plan/timeline (credits, never invented). */
export interface QuoteSummary {
  grandTotalCredits: number;
  perAspectCredits: number;
  minutesPerAspect: number;
}
