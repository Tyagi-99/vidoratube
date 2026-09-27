/**
 * F23 — 30-second Quick Create: stage pipeline spec (pure, no I/O).
 *
 * One-screen flow that runs the whole short-form pipeline as a stage
 * pipeline with per-stage status: idea → research/sources → script →
 * scenes → voiceover → stock visuals → assemble → QC → captions →
 * music → render.
 *
 * Honesty contract (pinned in `../contracts`):
 * - Free stages (idea scoring, research linking, script templating, scene
 *   splitting, QC, captions) run fully and deterministically.
 * - Paid stages NEVER fake completion: without a configured provider key
 *   they resolve to `skipped_unconfigured`; with a key but no explicit
 *   founder spend approval they resolve to `skipped_needs_spend_approval`
 *   and carry the exact ESTIMATE-labeled credit cost of the real call.
 * - Music resolves to `skipped_unconfigured` until a music source (BYO
 *   upload or stock-music key) is configured — no silent tracks are
 *   presented as "music added".
 */
import type { QuickCreateStageStatus } from "../contracts";

/** Mirror of USD_PER_CREDIT_REFERENCE in credits/estimates.server.ts
 *  (server-only module; this pure module must stay importable anywhere).
 *  $0.245/credit, Studio plan reference — ESTIMATE basis, never a promise. */
export const USD_PER_CREDIT = 49 / 200;

export function usdToCreditsEstimate(usd: number | null): number | null {
  if (usd === null || !Number.isFinite(usd) || usd < 0) return null;
  return Math.ceil(usd / USD_PER_CREDIT);
}

export const QUICK_CREATE_STAGE_KEYS = [
  "idea",
  "research",
  "script",
  "scenes",
  "voiceover",
  "visuals",
  "assemble",
  "qc",
  "captions",
  "music",
  "render",
] as const;
export type QuickCreateStageKey = (typeof QUICK_CREATE_STAGE_KEYS)[number];

export type StageCostKind = "free" | "paid";

export type StageSpec = {
  key: QuickCreateStageKey;
  label: string;
  blurb: string;
  costKind: StageCostKind;
};

export const QUICK_CREATE_STAGE_SPECS: Record<QuickCreateStageKey, StageSpec> = {
  idea: {
    key: "idea",
    label: "Idea",
    blurb: "Create the idea and score it (F8, deterministic).",
    costKind: "free",
  },
  research: {
    key: "research",
    label: "Research & sources",
    blurb: "Persist ≥2 sources; extract + link factual claims (F11, deterministic).",
    costKind: "free",
  },
  script: {
    key: "script",
    label: "Script",
    blurb: "Assemble the 25–35s script from the hook + verified facts (template, deterministic).",
    costKind: "free",
  },
  scenes: {
    key: "scenes",
    label: "Scenes",
    blurb: "Split the script into 5–7 scenes and build the pinned SceneManifest (F20).",
    costKind: "free",
  },
  voiceover: {
    key: "voiceover",
    label: "Voiceover",
    blurb: "Paid TTS (ElevenLabs / OpenAI / gateway). Runs for real only with spend approval.",
    costKind: "paid",
  },
  visuals: {
    key: "visuals",
    label: "Stock visuals",
    blurb: "Paid image generation or licensed stock. Runs for real only with spend approval.",
    costKind: "paid",
  },
  assemble: {
    key: "assemble",
    label: "Assemble",
    blurb: "Build the assemble timeline + manifest + exact quote (F20 prepare path).",
    costKind: "free",
  },
  qc: {
    key: "qc",
    label: "QC",
    blurb: "Run the pinned QC gate (F20) — blocks on missing visuals/empty narration.",
    costKind: "free",
  },
  captions: {
    key: "captions",
    label: "Captions",
    blurb: "Word/phrase-synced caption cues from narration timing (ESTIMATE until measured).",
    costKind: "free",
  },
  music: {
    key: "music",
    label: "Music",
    blurb: "Subtle ducked music — BYO upload or stock-music key. Skipped until configured.",
    costKind: "free",
  },
  render: {
    key: "render",
    label: "Render",
    blurb: "Server render via the existing enqueue path. Runs for real only with spend approval.",
    costKind: "paid",
  },
};

/* ------------------------------------------------------------------ */
/* Paid-stage cost ESTIMATES (Phase-1 cost basis, labeled ESTIMATE)    */
/* ------------------------------------------------------------------ */

export type PaidStageEstimateInput = {
  /** Full narration text (voiceover) */
  narrationText?: string | undefined;
  /** Number of scenes needing visuals */
  sceneCount?: number | undefined;
  /** Total video seconds (render) */
  totalSec?: number | undefined;
};

const ELEVENLABS_TTS_USD_PER_CHAR = 0.05 / 1000;
const GATEWAY_IMAGE_USD_PER_IMAGE = 0.03;
const SHOTSTACK_USD_PER_RENDER_MINUTE = 0.25;

/**
 * ESTIMATE-labeled credit cost for a paid quick-create stage, or null when
 * the price is unknown (never invented). Mirrors the Phase-1 estimator
 * basis; callers must label the number ESTIMATE.
 */
export function estimatePaidStageCredits(
  stage: QuickCreateStageKey,
  input: PaidStageEstimateInput,
): number | null {
  switch (stage) {
    case "voiceover": {
      const chars = (input.narrationText ?? "").length;
      if (chars === 0) return null;
      return usdToCreditsEstimate(chars * ELEVENLABS_TTS_USD_PER_CHAR);
    }
    case "visuals": {
      const n = input.sceneCount ?? 0;
      if (n <= 0) return null;
      return usdToCreditsEstimate(n * GATEWAY_IMAGE_USD_PER_IMAGE);
    }
    case "render": {
      const sec = input.totalSec ?? 0;
      if (sec <= 0) return null;
      return usdToCreditsEstimate((sec / 60) * SHOTSTACK_USD_PER_RENDER_MINUTE);
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Music stage (free kind, but needs a configured music source)        */
/* ------------------------------------------------------------------ */

export type MusicStageResolution = {
  status: QuickCreateStageStatus;
  detail: string;
};

/**
 * Music is only "done" when a real track is attached (BYO upload). Until a
 * music source exists it is an honest `skipped_unconfigured` — never a
 * silent timeline presented as scored.
 */
export function resolveMusicStage(musicUrl: string | null, duckDb = 14): MusicStageResolution {
  if (musicUrl) {
    return { status: "done", detail: `Music attached (ducked to −${duckDb}dB under voiceover).` };
  }
  return {
    status: "skipped_unconfigured",
    detail:
      "No music source configured. Upload a track (BYO) or connect a stock-music provider to enable subtle ducked music.",
  };
}

/* ------------------------------------------------------------------ */
/* Honest paid-stage resolution                                        */
/* ------------------------------------------------------------------ */

export type PaidStageGate = {
  /** Provider key / integration configured? */
  providerConfigured: boolean;
  /** Explicit founder spend approval for THIS run? */
  spendApproved: boolean;
  /** ESTIMATE credits for the real call (null when unknown). */
  costEstimateCredits: number | null;
  /** e.g. "ELEVENLABS_API_KEY" — named in the skip detail. */
  providerName: string;
};

export type PaidStageResolution = {
  status: QuickCreateStageStatus;
  detail: string;
};

/**
 * Resolve a paid stage without ever faking it:
 * - no key → skipped_unconfigured
 * - key but no approval → skipped_needs_spend_approval (+ ESTIMATE)
 * - both → "run" (caller performs the REAL provider call, then marks done/failed)
 */
export function resolvePaidStage(gate: PaidStageGate): PaidStageResolution {
  if (!gate.providerConfigured) {
    return {
      status: "skipped_unconfigured",
      detail: `${gate.providerName} is not configured. Connect it in Settings → Providers to enable this stage.`,
    };
  }
  if (!gate.spendApproved) {
    const cost =
      gate.costEstimateCredits !== null
        ? ` ESTIMATE: ${gate.costEstimateCredits} credit(s) for the real call.`
        : "";
    return {
      status: "skipped_needs_spend_approval",
      detail: `Spend approval is required before this paid stage runs.${cost}`,
    };
  }
  return { status: "running", detail: "Spend approved — running the real provider call." };
}
