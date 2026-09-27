/**
 * Phase 3 (Creation) shared contracts — coordinator-owned.
 *
 * Pinned before streams A–F fan out so every stream builds against the same
 * shapes. Streams may EXTEND these (new optional fields) but must not change
 * or remove existing fields. D94 applies: scores are deterministic and
 * explainable; anything labeled ESTIMATE is an estimate, never a promise.
 */
import { z } from "zod";

/* ── Scene manifest (competitor pattern #2: scene manifest + per-scene
        repair + checkpoint/resume). Stream E owns the producer; Stream F
        consumes. ─────────────────────────────────────────────────────── */

export const SceneStatusSchema = z.enum([
  "draft",
  "assets_ready",
  "narration_ready",
  "rendered",
  "failed",
]);
export type SceneStatus = z.infer<typeof SceneStatusSchema>;

export const SceneManifestSceneSchema = z.object({
  sceneId: z.string().uuid(),
  sceneNumber: z.number().int().positive(),
  /** Narration text for this scene (word-synced captions derive from it). */
  narration: z.string(),
  visualPrompt: z.string().nullable(),
  assetUrl: z.string().nullable(),
  /** e.g. { kind: 'generated'|'stock'|'upload', provider, rights } */
  assetSource: z.record(z.string(), z.unknown()).default({}),
  /** ESTIMATE until measured from real narration audio. */
  durationSecEstimate: z.number().positive(),
  status: SceneStatusSchema,
  /** Durable checkpoint payload (Phase 1 durable-jobs); null when none. */
  checkpoint: z.record(z.string(), z.unknown()).nullable().default(null),
});
export type SceneManifestScene = z.infer<typeof SceneManifestSceneSchema>;

export const SceneManifestSchema = z.object({
  projectId: z.string().uuid(),
  renderId: z.string().uuid().nullable(),
  scenes: z.array(SceneManifestSceneSchema),
});
export type SceneManifest = z.infer<typeof SceneManifestSchema>;

export const SceneRepairKindSchema = z.enum([
  "narration",
  "visual",
  "audio",
  "timing",
]);
export type SceneRepairKind = z.infer<typeof SceneRepairKindSchema>;

export const SceneRepairRequestSchema = z.object({
  sceneId: z.string().uuid(),
  repairKind: SceneRepairKindSchema,
  note: z.string().max(500).default(""),
});
export type SceneRepairRequest = z.infer<typeof SceneRepairRequestSchema>;

/* ── QC gate (used by F23 quick-create and F20 studio) ─────────────────── */

export const QCCheckSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  /** Human-readable detail; never fabricated — 'insufficient data' when thin. */
  detail: z.string(),
});
export type QCCheck = z.infer<typeof QCCheckSchema>;

export const QCResultSchema = z.object({
  passed: z.boolean(),
  checks: z.array(QCCheckSchema),
  blocking: z.array(z.string()),
});
export type QCResult = z.infer<typeof QCResultSchema>;

/* ── Idea scoring (F8; mirrors Phase-2 D94/D96 explainability rules) ────── */

export const IdeaScoreFactorSchema = z.object({
  key: z.string(),
  label: z.string(),
  /** 0..1 normalized contribution */
  value: z.number().min(0).max(1),
  weight: z.number().min(0).max(1),
  /** What data this factor came from; 'insufficient_data' when thin. */
  evidence: z.string(),
});
export type IdeaScoreFactor = z.infer<typeof IdeaScoreFactorSchema>;

export const IdeaScoreSchema = z.object({
  total: z.number().min(0).max(100),
  factors: z.array(IdeaScoreFactorSchema),
  confidence: z.enum(["high", "medium", "low"]),
  /** Short AI-labeled or rule-labeled verdict; never a virality guarantee. */
  verdict: z.string(),
});
export type IdeaScore = z.infer<typeof IdeaScoreSchema>;

/* ── Title scoring (F14; stats-disciplined, feeds Phase-4 experiments) ──── */

export const TitleScoreSchema = z.object({
  total: z.number().min(0).max(100),
  factors: z.object({
    length: z.number().min(0).max(25),
    keyword: z.number().min(0).max(25),
    curiosity: z.number().min(0).max(25),
    clarity: z.number().min(0).max(25),
  }),
  /** Which factors lacked data (e.g. no keyword corpus) — shown in UI. */
  weakEvidence: z.array(z.string()).default([]),
});
export type TitleScore = z.infer<typeof TitleScoreSchema>;

/* ── Quick-create orchestration (F23; Stream F) ─────────────────────────── */

export const QuickCreateStageStatusSchema = z.enum([
  "pending",
  "running",
  "done",
  "failed",
  /** Honest skips: surfaced in UI, never silently faked. */
  "skipped_unconfigured",
  "skipped_needs_spend_approval",
]);
export type QuickCreateStageStatus = z.infer<
  typeof QuickCreateStageStatusSchema
>;

export const QuickCreateStageSchema = z.object({
  stage: z.string(),
  status: QuickCreateStageStatusSchema,
  detail: z.string().default(""),
  /** ESTIMATE-labeled credit cost; null when unknown (never invented). */
  costEstimateCredits: z.number().nullable().default(null),
});
export type QuickCreateStage = z.infer<typeof QuickCreateStageSchema>;
