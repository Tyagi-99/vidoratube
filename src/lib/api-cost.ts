/**
 * Sprint 1: real provider-cost recording.
 *
 * Every billable provider call (LLM chat, TTS, image generation, render
 * submission) writes one row to `api_usage` through `recordApiCost`, with
 * the REAL unit cost in USD. The investor requirement is that
 * cost/finished-minute is MEASURED, not estimated, by end of Sprint 2 —
 * these rows are the raw material for getMeasuredCostPerMinute().
 *
 * Pricing sources (checked 2026-09-25):
 * - ElevenLabs TTS: $0.05 per 1,000 characters on the Flash/Turbo API tier
 *   (elevenlabs.io API rate card via cloudzero.com/blog/elevenlabs-pricing
 *   and developer.puter.com, Jun-Sep 2026 roundups). Our default model is
 *   eleven_flash_v2_5 -> Flash tier. Multilingual v2/v3 would be $0.10/1k;
 *   call sites using a non-Flash model should pass the higher rate.
 * - Lovable AI gateway chat: the gateway bills its OWN credits, not USD, so
 *   an exact USD cost is unknowable. We record the underlying model's list
 *   price as a reference: Google Gemini 2.5 Flash, $0.30 / 1M input tokens
 *   and $2.50 / 1M output tokens (Google Cloud Vertex AI pricing). Token
 *   counts come from the gateway's OpenAI-compatible `usage` field when
 *   present, otherwise estimated at 4 chars/token. meta.cost_basis is set
 *   to "gateway-passthrough-estimate" so the admin panel never presents
 *   these as exact invoices.
 * - Lovable AI gateway images (google/gemini-2.5-flash-image): no public
 *   per-image USD price; recorded at a flat $0.03/image estimate, marked
 *   "gateway-passthrough-estimate" in meta.
 * - Lovable AI gateway TTS (gpt-4o-mini-tts): ~$16 per 1M characters
 *   (third-party 2026 comparison), i.e. $0.016/1k chars, marked estimate.
 * - Shotstack render: render-minute plans $0.20-$0.30/min (PAYG $0.30/min;
 *   zapcap.ai comparison, checked May 2026). Recorded at $0.25/rendered
 *   minute on production (SHOTSTACK_ENV=v1); $0 on the stage sandbox,
 *   which is free.
 *
 * Never fabricate precision: when the cost basis is an estimate, say so in
 * meta. When a provider publishes an exact rate, cite it above.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/* ------------------------------- pricing -------------------------------- */

/** ElevenLabs TTS, Flash/Turbo API tier: $0.05 / 1k characters. */
export const ELEVENLABS_TTS_USD_PER_CHAR = 0.05 / 1000;
/** ElevenLabs TTS, Multilingual v2/v3 API tier: $0.10 / 1k characters. */
export const ELEVENLABS_TTS_MULTILINGUAL_USD_PER_CHAR = 0.1 / 1000;

/** OpenAI TTS, gpt-4o-mini-tts list price: $0.60 / 1M characters. */
export const OPENAI_TTS_USD_PER_CHAR = 0.6 / 1_000_000;

/** Gemini 2.5 Flash list price, USD per 1M tokens (Google Cloud, 2026). */
export const GEMINI_FLASH_INPUT_USD_PER_MTOK = 0.3;
export const GEMINI_FLASH_OUTPUT_USD_PER_MTOK = 2.5;

/** OpenAI gpt-4o-mini list price, USD per 1M tokens (platform.openai.com, 2026). */
export const OPENAI_GPT4O_MINI_INPUT_USD_PER_MTOK = 0.15;
export const OPENAI_GPT4O_MINI_OUTPUT_USD_PER_MTOK = 0.6;

/** Gateway image generation: flat estimate per image (see header). */
export const GATEWAY_IMAGE_USD_PER_IMAGE = 0.03;
/** Gateway TTS (gpt-4o-mini-tts): ~$16/1M chars -> per-char rate. */
export const GATEWAY_TTS_USD_PER_CHAR = 0.016 / 1000;

/** Shotstack production render: $0.25 per rendered minute. */
export const SHOTSTACK_USD_PER_RENDER_MINUTE = 0.25;

/** Render-pipeline operations that feed the measured cost-per-minute. */
export const RENDER_COST_OPERATIONS = [
  "llm_plan",
  "llm_script",
  "tts",
  "image_generation",
  "stock_search",
  "render_submit",
  "thumbnail",
  "seo_copy",
] as const;

/* --------------------------------- types --------------------------------- */

export type ApiCostInput = {
  userId: string;
  /** Project the cost belongs to, when the call site knows one. */
  projectId?: string | null | undefined;
  provider: string;
  operation: string;
  /** Billable units: characters, tokens, images, rendered minutes, ... */
  units: number;
  /** Real USD cost per unit (see pricing sources above). */
  unitCostUsd: number;
  meta?: Record<string, unknown> | undefined;
};

/** OpenAI-compatible usage block returned by the Lovable AI gateway. */
export type GatewayUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

/** Pulls token counts out of a gateway chat-completions payload. */
export function extractUsage(payload: unknown): GatewayUsage | null {
  const u = (
    payload as {
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
    }
  )?.usage;
  if (!u) return null;
  const inputTokens = Number(u.prompt_tokens ?? 0);
  const outputTokens = Number(u.completion_tokens ?? 0);
  const totalTokens = Number(u.total_tokens ?? inputTokens + outputTokens);
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return null;
  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
    totalTokens,
  };
}

/** Rough token estimate for text when the gateway omits usage (~4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Blended USD/token rate for a chat call, derived from the real
 * input/output split so that units * rate == inputCost + outputCost exactly.
 */
export function chatUnitCostUsd(
  inputTokens: number,
  outputTokens: number,
  inputRatePerMtok: number,
  outputRatePerMtok: number,
): number {
  const total = inputTokens + outputTokens;
  if (total <= 0) return 0;
  const cost =
    (inputTokens / 1_000_000) * inputRatePerMtok + (outputTokens / 1_000_000) * outputRatePerMtok;
  return cost / total;
}

/**
 * Blended rate for Lovable AI gateway chat calls (Gemini 2.5 Flash list
 * price). The gateway bills its own credits, so USD is a passthrough
 * estimate — call sites must mark cost_basis accordingly.
 */
export function gatewayChatUnitCostUsd(inputTokens: number, outputTokens: number): number {
  return chatUnitCostUsd(
    inputTokens,
    outputTokens,
    GEMINI_FLASH_INPUT_USD_PER_MTOK,
    GEMINI_FLASH_OUTPUT_USD_PER_MTOK,
  );
}

/** Cost-recording context threaded from server-function callers into provider helpers. */
export type CostCtx = {
  admin: SupabaseClient<Database>;
  userId: string;
  projectId?: string | null | undefined;
  /** Billing mode for measured cost-per-minute attribution ("story" | "cinema"). */
  mode?: string | undefined;
};

/**
 * Writes one measured provider-cost row to api_usage.
 *
 * Cost recording must never break the product flow: insert failures are
 * logged and swallowed (the render/plan already happened — losing the cost
 * row is bad, crashing the user's render is worse). estimated_cost is always
 * units * unitCostUsd, computed here so call sites can't drift.
 */
export async function recordApiCost(
  admin: SupabaseClient<Database>,
  input: ApiCostInput,
): Promise<void> {
  const units = Number.isFinite(input.units) && input.units > 0 ? input.units : 0;
  const estimatedCost = units * input.unitCostUsd;
  try {
    const { error } = await admin.from("api_usage").insert({
      user_id: input.userId,
      project_id: input.projectId ?? null,
      provider: input.provider,
      operation: input.operation,
      units,
      estimated_cost: estimatedCost,
      meta: (input.meta ?? {}) as never,
    });
    if (error) {
      console.warn(
        `[vidora] recordApiCost insert failed (${input.provider}/${input.operation}): ${error.message}`,
      );
    }
  } catch (err) {
    console.warn(
      `[vidora] recordApiCost threw (${input.provider}/${input.operation}):`,
      err instanceof Error ? err.message : err,
    );
  }
}

/* --------------------------- YouTube API quota --------------------------- */

/**
 * YouTube Data API v3 quota model (verified against the official quota-cost
 * page, last updated 2026-09-15 UTC). The old single-pool / 1,600-unit model
 * is gone; there are now three daily buckets resetting at midnight PT:
 *
 * - videos.insert: 100 calls/day, 1 quota unit per call (own bucket)
 * - search.list:   100 calls/day, 1 quota unit per call (own bucket)
 * - everything else: 10,000 units/day shared pool
 *
 * YouTube quota is NOT billed in USD — it is a hard daily ceiling with no
 * paid overage. We reuse the api_usage table (rather than a new quota table)
 * so quota consumption is visible next to real spend; rows are marked with
 * meta.cost_basis = "youtube-quota-units-not-usd" and cost 0 so the
 * measured-cost-per-minute math never treats them as money.
 */

export const YOUTUBE_VIDEOS_INSERT_DAILY_CALLS = 100;
export const YOUTUBE_SEARCH_LIST_DAILY_CALLS = 100;
export const YOUTUBE_SHARED_POOL_UNITS_PER_DAY = 10000;

/** Per-call quota costs in the shared pool (official quota-cost table). */
export const YOUTUBE_QUOTA_COST = {
  "videos.insert": { units: 1, bucket: "videos.insert" },
  "videos.update": { units: 50, bucket: "shared-pool" },
  "videos.list": { units: 1, bucket: "shared-pool" },
  "channels.list": { units: 1, bucket: "shared-pool" },
  "thumbnails.set": { units: 50, bucket: "shared-pool" },
  "captions.insert": { units: 400, bucket: "shared-pool" },
  "captions.delete": { units: 50, bucket: "shared-pool" },
  "search.list": { units: 1, bucket: "search.list" },
} as const;

export type YouTubeQuotaOperation = keyof typeof YOUTUBE_QUOTA_COST;

export type YouTubeQuotaInput = {
  userId: string;
  projectId?: string | null | undefined;
  operation: YouTubeQuotaOperation;
};

/**
 * Records one YouTube API call's quota consumption to api_usage.
 * Never throws: quota accounting must not break a publish.
 */
export async function recordYouTubeQuota(
  admin: SupabaseClient<Database>,
  input: YouTubeQuotaInput,
): Promise<void> {
  const cost = YOUTUBE_QUOTA_COST[input.operation];
  await recordApiCost(admin, {
    userId: input.userId,
    projectId: input.projectId ?? null,
    provider: "youtube",
    operation: input.operation,
    units: cost.units,
    unitCostUsd: 0,
    meta: {
      cost_basis: "youtube-quota-units-not-usd",
      quota_bucket: cost.bucket,
      daily_limit:
        cost.bucket === "videos.insert"
          ? YOUTUBE_VIDEOS_INSERT_DAILY_CALLS
          : cost.bucket === "search.list"
            ? YOUTUBE_SEARCH_LIST_DAILY_CALLS
            : YOUTUBE_SHARED_POOL_UNITS_PER_DAY,
    },
  });
}
