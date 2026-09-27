/**
 * Credit-cost ESTIMATES for pre-flight checks (Phase 1, Credits).
 *
 * SERVER-ONLY. Pure math — no DB access here — but kept in a `.server.ts`
 * module so estimates can never leak into a client bundle.
 *
 * EVERY result carries `isEstimate: true` and `type: "estimate"`. These are
 * ESTIMATES, not invoices: the only authoritative charge is the ledger row
 * written by the debit RPCs in `../credits.ts`. Treat any estimate as an
 * upper-bound guess for gating expensive work, never as the amount billed.
 *
 * Pricing basis (never invented):
 * - Per-minute credit billing: `../billing/per-minute.ts` (1 credit = 1
 *   finished minute, story mode, standard voice; investor-approved
 *   multipliers for premium voice / cinema stock / AI hero shots / etc).
 * - Real provider USD prices: `../api-cost.ts` (ElevenLabs Flash
 *   $0.05/1k chars, Multilingual $0.10/1k chars, gateway TTS $0.016/1k chars,
 *   gateway images $0.03/image, gateway chat Gemini 2.5 Flash token rates,
 *   Shotstack $0.25/rendered minute).
 * - USD -> credits conversion: pinned to the Studio plan unit price,
 *   $49 / 200 credits = $0.245 per credit (`../billing/plans.ts`). This is a
 *   REFERENCE rate for estimates only, and it is surfaced in every
 *   breakdown as `usdPerCreditReference` so callers can see the basis.
 *
 * When a provider publishes no price we can use, `credits` is `null` with
 * `reason: "unknown_provider_pricing"` — we NEVER invent a price.
 */
import {
  ELEVENLABS_TTS_MULTILINGUAL_USD_PER_CHAR,
  ELEVENLABS_TTS_USD_PER_CHAR,
  GATEWAY_IMAGE_USD_PER_IMAGE,
  GATEWAY_TTS_USD_PER_CHAR,
  SHOTSTACK_USD_PER_RENDER_MINUTE,
  chatUnitCostUsd,
  GEMINI_FLASH_INPUT_USD_PER_MTOK,
  GEMINI_FLASH_OUTPUT_USD_PER_MTOK,
} from "../api-cost";
import { renderCreditCost, type RenderCostBreakdown } from "../billing/per-minute";

/** ESTIMATE label: every result from this module carries these two fields. */
export const ESTIMATE_TYPE = "estimate" as const;

/**
 * USD per credit used to translate provider USD costs into credits for
 * ESTIMATES only. Pinned to the Studio plan: $49 / 200 credits
 * (see src/lib/billing/plans.ts). Not a billing rate — the real charge is
 * whatever the debit RPCs write to the ledger.
 */
export const USD_PER_CREDIT_REFERENCE = 49 / 200; // $0.245

/** Speech rate already used in render.server.ts for the gateway fallback. */
export const TTS_WORDS_PER_MINUTE = 150;
/** Rough chars-per-word for the minutes->characters TTS fallback. */
export const TTS_CHARS_PER_WORD = 5;
/** Fallback narration characters per finished minute of TTS audio. */
export const TTS_CHARS_PER_MINUTE = TTS_WORDS_PER_MINUTE * TTS_CHARS_PER_WORD; // 750

export type EstimateJobType = "render" | "tts" | "image" | "llm_chat" | "video_gen";

export type EstimateInput = {
  jobType: EstimateJobType;
  /** Finished minutes (render) or narration minutes (tts fallback). */
  minutes?: number | undefined;
  /** Scene count (image: number of images to generate). */
  scenes?: number | undefined;
  /**
   * Provider key. Known: "elevenlabs", "lovable-ai" (gateway), "gateway",
   * "shotstack", "server_ffmpeg". Anything else -> unknown_provider_pricing
   * where the provider price matters (tts/image/llm_chat).
   */
  provider?: string | undefined;
  /** Model id, e.g. "eleven_flash_v2_5", "eleven_multilingual_v2". */
  model?: string | undefined;
  /** TTS: exact narration character count when known (beats the wpm fallback). */
  characters?: number | undefined;
  /** LLM chat: exact token counts when known. */
  tokens?: { input: number; output: number } | undefined;
  /** Render multipliers (see billing/per-minute.ts). */
  premiumVoice?: boolean | undefined;
  stockFootage?: boolean | undefined;
  aiHeroSeconds?: number | undefined;
  parallax25d?: boolean | undefined;
  dubLanguages?: number | undefined;
  shortsCount?: number | undefined;
};

export type EstimateBreakdown = {
  /** Human-readable ESTIMATE line items. */
  lines: string[];
  /** Provider USD cost behind the credit estimate, when a USD price applies. */
  usdReference?: number | undefined;
  /** USD-per-credit rate the estimate used (see USD_PER_CREDIT_REFERENCE). */
  usdPerCreditReference?: number | undefined;
  /** "list-price" | "gateway-passthrough-estimate" — never claim exactness. */
  costBasis?: string | undefined;
  /** Render jobs: the full per-minute breakdown. */
  render?: RenderCostBreakdown | undefined;
};

export type CostEstimate =
  | {
      /** ESTIMATE — not a charge. */
      isEstimate: true;
      type: typeof ESTIMATE_TYPE;
      credits: number;
      breakdown: EstimateBreakdown;
    }
  | {
      /** ESTIMATE — not a charge. credits unknown: no price invented. */
      isEstimate: true;
      type: typeof ESTIMATE_TYPE;
      credits: null;
      reason: "unknown_provider_pricing" | "insufficient_input_for_estimate";
      breakdown: null;
    };

function unknown(
  reason: "unknown_provider_pricing" | "insufficient_input_for_estimate",
): CostEstimate {
  return { isEstimate: true, type: ESTIMATE_TYPE, credits: null, reason, breakdown: null };
}

/** Credits are whole numbers in the ledger: estimates round UP, never down. */
function usdToCredits(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.ceil(usd / USD_PER_CREDIT_REFERENCE);
}

function isGatewayProvider(provider: string | undefined): boolean {
  const p = (provider ?? "").toLowerCase();
  return p === "lovable-ai" || p === "gateway" || p === "lovable";
}

/** ElevenLabs per-char USD rate from the model id (Flash default). */
function elevenLabsRateUsdPerChar(model: string | undefined): number {
  return (model ?? "").toLowerCase().includes("multilingual")
    ? ELEVENLABS_TTS_MULTILINGUAL_USD_PER_CHAR
    : ELEVENLABS_TTS_USD_PER_CHAR;
}

function estimateRender(input: EstimateInput): CostEstimate {
  // Renders are billed in credits directly (per-minute pricing) — no
  // provider USD price is involved, so an unknown provider is fine here.
  const minutes = Math.max(1, Math.ceil(input.minutes ?? 1));
  // exactOptionalPropertyTypes: only pass defined optionals through.
  const costInput: Parameters<typeof renderCreditCost>[0] = {
    durationSeconds: minutes * 60,
    mode: input.stockFootage ? "cinema" : "story",
  };
  if (input.premiumVoice !== undefined) costInput.premiumVoice = input.premiumVoice;
  if (input.stockFootage !== undefined) costInput.stockFootage = input.stockFootage;
  if (input.aiHeroSeconds !== undefined) costInput.aiHeroSeconds = input.aiHeroSeconds;
  if (input.parallax25d !== undefined) costInput.parallax25d = input.parallax25d;
  if (input.dubLanguages !== undefined) costInput.dubLanguages = input.dubLanguages;
  if (input.shortsCount !== undefined) costInput.shortsCount = input.shortsCount;
  const breakdown = renderCreditCost(costInput);
  const provider = (input.provider ?? "").toLowerCase();
  const usdReference =
    provider === "shotstack" ? minutes * SHOTSTACK_USD_PER_RENDER_MINUTE : undefined;
  return {
    isEstimate: true,
    type: ESTIMATE_TYPE,
    credits: breakdown.totalCredits,
    breakdown: {
      lines: [
        `ESTIMATE: ${breakdown.minutes} finished min x mode ${breakdown.modeMultiplier} x voice ${breakdown.voiceMultiplier} = ${breakdown.baseCredits} base credits`,
        ...(breakdown.aiHeroCredits > 0 ? [`ESTIMATE: AI hero shots +${breakdown.aiHeroCredits}`] : []),
        ...(breakdown.parallaxCredits > 0 ? [`ESTIMATE: 2.5D parallax +${breakdown.parallaxCredits}`] : []),
        ...(breakdown.dubbingCredits > 0 ? [`ESTIMATE: dubbing +${breakdown.dubbingCredits}`] : []),
        ...(breakdown.shortsCredits > 0 ? [`ESTIMATE: shorts +${breakdown.shortsCredits}`] : []),
      ],
      ...(usdReference !== undefined ? { usdReference } : {}),
      costBasis: "list-price",
      render: breakdown,
    },
  };
}

function estimateTts(input: EstimateInput): CostEstimate {
  const provider = (input.provider ?? "").toLowerCase();
  let rateUsdPerChar: number;
  let costBasis: "list-price" | "gateway-passthrough-estimate";
  let label: string;
  if (provider === "elevenlabs") {
    rateUsdPerChar = elevenLabsRateUsdPerChar(input.model);
    costBasis = "list-price";
    label = `ElevenLabs ${input.model ?? "eleven_flash_v2_5"}`;
  } else if (isGatewayProvider(input.provider)) {
    rateUsdPerChar = GATEWAY_TTS_USD_PER_CHAR;
    costBasis = "gateway-passthrough-estimate";
    label = "Lovable AI gateway TTS (gpt-4o-mini-tts)";
  } else {
    // No published per-char price for this provider — do not invent one.
    return unknown("unknown_provider_pricing");
  }

  const chars =
    input.characters !== undefined && Number.isFinite(input.characters) && input.characters > 0
      ? Math.ceil(input.characters)
      : Math.max(1, Math.ceil(input.minutes ?? 1)) * TTS_CHARS_PER_MINUTE;
  const usedFallback = input.characters === undefined;
  // rateUsdPerChar is USD PER CHARACTER (e.g. 0.05/1000) — no extra /1000.
  const usd = chars * rateUsdPerChar;
  const credits = usdToCredits(usd);
  return {
    isEstimate: true,
    type: ESTIMATE_TYPE,
    credits,
    breakdown: {
      lines: [
        `ESTIMATE: ${chars.toLocaleString()} chars${usedFallback ? ` (~${TTS_WORDS_PER_MINUTE} wpm x ${Math.max(1, Math.ceil(input.minutes ?? 1))} min fallback)` : ""} x $${rateUsdPerChar}/char (${label}) = $${usd.toFixed(4)}`,
        `ESTIMATE: $${usd.toFixed(4)} / $${USD_PER_CREDIT_REFERENCE}/credit (Studio plan reference) = ${credits} credits (rounded up)`,
      ],
      usdReference: Math.round(usd * 10000) / 10000,
      usdPerCreditReference: USD_PER_CREDIT_REFERENCE,
      costBasis,
    },
  };
}

function estimateImage(input: EstimateInput): CostEstimate {
  // Only the Lovable AI gateway has a known per-image price ($0.03/image,
  // gateway-passthrough-estimate). Any other provider: no price invented.
  if (!isGatewayProvider(input.provider)) return unknown("unknown_provider_pricing");
  const images = Math.max(1, Math.ceil(input.scenes ?? 1));
  const usd = images * GATEWAY_IMAGE_USD_PER_IMAGE;
  const credits = usdToCredits(usd);
  return {
    isEstimate: true,
    type: ESTIMATE_TYPE,
    credits,
    breakdown: {
      lines: [
        `ESTIMATE: ${images} image(s) x $${GATEWAY_IMAGE_USD_PER_IMAGE}/image (gateway) = $${usd.toFixed(4)}`,
        `ESTIMATE: $${usd.toFixed(4)} / $${USD_PER_CREDIT_REFERENCE}/credit (Studio plan reference) = ${credits} credits (rounded up)`,
      ],
      usdReference: Math.round(usd * 10000) / 10000,
      usdPerCreditReference: USD_PER_CREDIT_REFERENCE,
      costBasis: "gateway-passthrough-estimate",
    },
  };
}

function estimateLlmChat(input: EstimateInput): CostEstimate {
  // Only the Lovable AI gateway chat has a known token price. Usage (tokens)
  // must be supplied — we do not invent token counts.
  if (!isGatewayProvider(input.provider)) return unknown("unknown_provider_pricing");
  if (!input.tokens) return unknown("insufficient_input_for_estimate");
  const { input: inTok, output: outTok } = input.tokens;
  const total = inTok + outTok;
  if (!Number.isFinite(total) || total <= 0) return unknown("insufficient_input_for_estimate");
  const blended = chatUnitCostUsd(
    inTok,
    outTok,
    GEMINI_FLASH_INPUT_USD_PER_MTOK,
    GEMINI_FLASH_OUTPUT_USD_PER_MTOK,
  );
  const usd = total * blended;
  const credits = usdToCredits(usd);
  return {
    isEstimate: true,
    type: ESTIMATE_TYPE,
    credits,
    breakdown: {
      lines: [
        `ESTIMATE: ${inTok.toLocaleString()} in + ${outTok.toLocaleString()} out tokens x blended $${blended.toExponential(2)}/token (Gemini 2.5 Flash list price) = $${usd.toFixed(4)}`,
        `ESTIMATE: $${usd.toFixed(4)} / $${USD_PER_CREDIT_REFERENCE}/credit (Studio plan reference) = ${credits} credits (rounded up)`,
      ],
      usdReference: Math.round(usd * 10000) / 10000,
      usdPerCreditReference: USD_PER_CREDIT_REFERENCE,
      costBasis: "gateway-passthrough-estimate",
    },
  };
}

/**
 * ESTIMATE the credit cost of a job BEFORE running it.
 *
 * Pure function — no DB access. Returns `credits: null` (never an invented
 * number) when the provider price is unknown or required input is missing.
 * The result is labeled `isEstimate: true` / `type: "estimate"` everywhere
 * it surfaces; the ledger row written by the debit RPC is the only real
 * charge.
 */
export function estimateJobCost(input: EstimateInput): CostEstimate {
  switch (input.jobType) {
    case "render":
      return estimateRender(input);
    case "tts":
      return estimateTts(input);
    case "image":
      return estimateImage(input);
    case "llm_chat":
      return estimateLlmChat(input);
    case "video_gen":
      // No published per-video price in api-cost.ts — never invent one.
      return unknown("unknown_provider_pricing");
    default:
      return unknown("unknown_provider_pricing");
  }
}
