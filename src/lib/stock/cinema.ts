/**
 * Cinema Mode treatment spec (Sprint 5-6).
 *
 * Cinema is the premium, stock-driven render tier. Where Story Mode shapes
 * the render around five narrative beats, Cinema shapes it around the
 * footage itself:
 *
 *   - premium stock-driven visuals: motion prefers real footage (STOCK_VIDEO)
 *     over stills; the source-selection planner (stock/source-select.ts)
 *     fills scenes by strict priority user_upload → licensed stock → AI hero.
 *   - richer motion on stills: slow, deliberate moves that cycle per scene
 *     (slow push-in → lateral drift → slow pull-back) instead of one
 *     project-wide setting, plus a stronger parallax treatment (0.9).
 *   - more deliberate pacing: dip-to-black transitions (0.6s) between scenes
 *     instead of quick crossfades — the cut breathes.
 *
 * Pricing is NOT duplicated here: per-minute.ts renderCreditCost is the
 * single source of truth (cinema + stockFootage → ×1.5). The tests assert
 * the treatment constants stay consistent with that pricing.
 *
 * Honest boundaries (also stated in the RenderPanel UI):
 * - the browser treatment below is real today;
 * - live per-scene stock search activates with PEXELS_API_KEY / PIXABAY_API_KEY
 *   set; without keys the planner uses clearly-marked mock assets;
 * - the automated per-scene stock pipeline in the Studio is Shipping next.
 */
import type { StoryBeat } from "../story-template";

/** Stronger parallax on stills than the 0.5 browser default. */
export const CINEMA_PARALLAX_INTENSITY = 0.9;

/** Deliberate pacing: dip-to-black between scenes (0.6s fades in the renderer). */
export const CINEMA_TRANSITION = "dip_to_black" as const;

type CinemaMotion = StoryBeat["motion"];

/**
 * Slow, deliberate motion cycling per scene index: a push-in, then a
 * lateral drift, then a pull-back — the classic three-shot cadence.
 * Deterministic so re-renders and resume stay stable.
 */
const CINEMA_MOTION_CYCLE: readonly CinemaMotion[] = ["slow_zoom", "slow_pan", "zoom_out"] as const;

export function cinemaSceneMotion(sceneIndex: number): CinemaMotion {
  const i = Math.max(0, Math.floor(sceneIndex)) % CINEMA_MOTION_CYCLE.length;
  return CINEMA_MOTION_CYCLE[i]!;
}

export interface CinemaSceneTreatment {
  /** Browser motion for the scene (non-parallax path). */
  motion: CinemaMotion;
  /** Scene transition — deliberate dip-to-black. */
  transition: typeof CINEMA_TRANSITION;
  /**
   * Parallax intensity when 2.5D is on. The browser renderer applies this
   * only if the caller enabled parallax25d (the paid add-on).
   */
  parallaxIntensity: number;
}

/** Full per-scene treatment for a Cinema Mode render. */
export function cinemaTreatmentForScene(sceneIndex: number): CinemaSceneTreatment {
  return {
    motion: cinemaSceneMotion(sceneIndex),
    transition: CINEMA_TRANSITION,
    parallaxIntensity: CINEMA_PARALLAX_INTENSITY,
  };
}

/**
 * Cinema copy for the RenderPanel toggle — states only what is real today.
 * Anything not yet real is labelled "Shipping next" with a date.
 */
export const CINEMA_MODE_BLURB =
  "Premium stock-driven visuals with slow cinematic motion and dip-to-black pacing. " +
  "Server renders bill licensed stock footage ×1.5 per finished minute; AI hero shots " +
  "are capped at 10% of runtime and billed 1 credit per 10 seconds. " +
  "Live stock search activates with Pexels/Pixabay API keys. " +
  "Automated per-scene stock planning: Shipping next (Oct 2026).";
