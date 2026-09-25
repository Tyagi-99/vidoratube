/**
 * Stock module — shared types for visual source selection (Sprint 5-6).
 *
 * Cinema Mode is the premium, stock-driven render tier. For every scene the
 * visuals are picked by a STRICT priority, encoded in SOURCE_PRIORITY:
 *
 *   1. user_upload — footage the user owns and uploaded. Always wins.
 *   2. stock       — licensed Pexels/Pixabay assets, with provenance recorded.
 *   3. ai_hero     — AI-generated hero shots, capped at AI_HERO_RUNTIME_CAP
 *                    of finished runtime (see source-select.ts).
 *
 * The priority is enforced in code by planSceneSources (pure, unit-tested)
 * and honoured at generation time by resolveSceneVisual's userFootageUrl
 * short-circuit. Pure types live here so both the planner and the UI
 * (RenderPanel quote) share one vocabulary.
 */
export const SOURCE_PRIORITY = ["user_upload", "stock", "ai_hero"] as const;

/** Visual source tier for one scene, in strict priority order. */
export type SceneSourceTier = (typeof SOURCE_PRIORITY)[number];

/** One scene as seen by the source planner. */
export interface SourceSceneInput {
  /** Scene id (scenes.id) — used as the provenance scene link. */
  sceneId: string;
  /** Finished seconds this scene occupies on the timeline. */
  durationSeconds: number;
  /**
   * Tier 1: URL of user-uploaded footage for this scene. When present it
   * wins over stock and AI unconditionally — rights first.
   */
  userFootageUrl?: string | null | undefined;
  /**
   * Tier 2: search terms for licensed stock lookup (one or more).
   * A scene with queries is stock-eligible.
   */
  searchQueries?: string[];
  /**
   * Tier 2 hint from the visual plan: visual_type starts with "STOCK_".
   * Kept separate from searchQueries so a plan can mark a scene
   * stock-eligible even before queries are written.
   */
  stockEligible?: boolean;
  /** Existing visual_type (e.g. "AI_IMAGE") — used for quote hero math. */
  visualType?: string | null;
}

/** The planner's decision for one scene. */
export interface SceneSourceDecision {
  sceneId: string;
  tier: SceneSourceTier;
  durationSeconds: number;
  /**
   * Tier 1: the winning user-footage URL (present when tier === "user_upload").
   */
  userFootageUrl?: string | null | undefined;
  /** Tier 2: the queries tried, in order (present when tier === "stock"). */
  searchQueries: string[];
  /**
   * Post-cap seconds of AI hero on this scene (0 unless tier === "ai_hero").
   * "Trim" policy scales this down proportionally when the plan exceeds the cap.
   */
  aiHeroSeconds: number;
  /** Attached by resolveStockForPlan for tier === "stock". */
  stockAsset?: import("../providers/stock.server").StockAsset | null | undefined;
  /** True when the asset came from the mock provider (preview only). */
  mockAsset: boolean;
  /** True when the hero cap trimmed this scene's AI seconds. */
  heroTrimmed: boolean;
  /**
   * Tier 3 scenes that found no stock fell back here after a failed
   * stock lookup (documented in the plan, not silent).
   */
  stockFallback?: boolean | undefined;
}

/** Whole-plan result of planSceneSources / resolveStockForPlan. */
export interface SourcePlan {
  decisions: SceneSourceDecision[];
  /** Finished runtime in seconds across all scenes. */
  totalSeconds: number;
  /** Post-cap AI hero seconds across the plan. */
  aiHeroSeconds: number;
  /** Cap in seconds: totalSeconds * capRatio. */
  heroCapSeconds: number;
  /** Cap ratio used (default AI_HERO_RUNTIME_CAP). */
  capRatio: number;
  /** Hero-cap policy used ("trim" | "reject"). */
  heroPolicy: "trim" | "reject";
  /** True when the trim policy reduced at least one scene. */
  heroTrimmed: boolean;
  /** True when every stock asset came from the mock provider. */
  stockMock: boolean;
}
