/**
 * Per-minute credit pricing (Sprint 0).
 *
 * One credit = one finished minute of Story Mode with a standard voice.
 * Multipliers (investor-approved):
 *   - premium voice:            x2 on the base minutes
 *   - cinema stock footage:     x1.5 on the base minutes
 *   - AI hero shots:            billed per second (1 credit per 10s, rounded up)
 *   - 2.5D parallax:            +0.25 credits per finished minute
 *   - dubbing:                  0.5 credits per finished minute per language
 *   - shorts (from long video): 0.5 credits each
 *
 * Credits are whole numbers in the ledger: the total is always rounded UP.
 * Pure functions — fully unit-tested.
 */

export type RenderMode = "story" | "cinema";

export interface RenderCostInput {
  /** Finished video length in seconds. */
  durationSeconds: number;
  mode: RenderMode;
  /** Premium (non-standard) voice selected. */
  premiumVoice?: boolean;
  /** Cinema Mode using licensed stock footage. */
  stockFootage?: boolean;
  /** Seconds of AI-generated hero shots in the video. */
  aiHeroSeconds?: number;
  /** Premium 2.5D parallax treatment. */
  parallax25d?: boolean;
  /** Number of dubbing languages (visuals reused). */
  dubLanguages?: number;
  /** Number of Shorts cut from this video. */
  shortsCount?: number;
}

/** Finished minutes, rounded up (minimum 1). */
export function finishedMinutes(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 1;
  return Math.max(1, Math.ceil(durationSeconds / 60));
}

/** AI hero shots: 1 credit per 10 seconds, rounded up. */
export function aiHeroCredits(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.ceil(seconds / 10);
}

export interface RenderCostBreakdown {
  minutes: number;
  baseCredits: number;
  modeMultiplier: number;
  voiceMultiplier: number;
  aiHeroCredits: number;
  parallaxCredits: number;
  dubbingCredits: number;
  shortsCredits: number;
  /** Whole credits actually charged (rounded up). */
  totalCredits: number;
}

/** Full cost breakdown for a render. The exact cost is shown BEFORE rendering. */
export function renderCreditCost(input: RenderCostInput): RenderCostBreakdown {
  const minutes = finishedMinutes(input.durationSeconds);
  const modeMultiplier = input.mode === "cinema" && input.stockFootage ? 1.5 : 1;
  const voiceMultiplier = input.premiumVoice ? 2 : 1;

  const baseCredits = minutes * modeMultiplier * voiceMultiplier;
  const hero = aiHeroCredits(input.aiHeroSeconds ?? 0);
  const parallax = input.parallax25d ? minutes * 0.25 : 0;
  const dubbing = (input.dubLanguages ?? 0) * minutes * 0.5;
  const shorts = (input.shortsCount ?? 0) * 0.5;

  return {
    minutes,
    baseCredits,
    modeMultiplier,
    voiceMultiplier,
    aiHeroCredits: hero,
    parallaxCredits: parallax,
    dubbingCredits: dubbing,
    shortsCredits: shorts,
    totalCredits: Math.max(1, Math.ceil(baseCredits + hero + parallax + dubbing + shorts)),
  };
}

/** Human-readable cost line, e.g. "4 min story + premium voice = 8 credits". */
export function formatRenderCost(input: RenderCostInput): string {
  const c = renderCreditCost(input);
  const parts = [`${c.minutes} min ${input.mode}`];
  if (input.premiumVoice) parts.push("premium voice x2");
  if (input.mode === "cinema" && input.stockFootage) parts.push("stock x1.5");
  if (c.aiHeroCredits > 0) parts.push(`AI hero ${c.aiHeroCredits} cr`);
  if (c.parallaxCredits > 0) parts.push("2.5D parallax");
  if (c.dubbingCredits > 0) parts.push(`dub x${input.dubLanguages}`);
  if (c.shortsCredits > 0) parts.push(`${input.shortsCount} shorts`);
  return `${parts.join(" + ")} = ${c.totalCredits} credit${c.totalCredits === 1 ? "" : "s"}`;
}
