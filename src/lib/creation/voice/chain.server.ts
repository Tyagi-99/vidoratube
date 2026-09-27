/**
 * F17 Voice Studio — TTS fallback chain (Stream D, Phase 3).
 *
 * SERVER-ONLY. Follows the Phase-1 `generateVideoWithFallback` pattern
 * (src/lib/providers/video.server.ts) exactly:
 *
 *   - Ordered chain: ElevenLabs (primary) → OpenAI TTS (fallback) →
 *     Lovable AI gateway (last resort, passthrough estimate).
 *   - ONE attempt per provider, then move on. A failed paid call is never
 *     retried blindly.
 *   - Returns the first success; every provider failing (or none
 *     configured) yields the honest error/unconfigured result — never fake
 *     success.
 *   - Adapters return TtsResult envelopes and never throw; the chain
 *     additionally converts a throwing adapter into an error result.
 *
 * `opts.providers` exists so tests can inject fakes. Production always
 * resolves from `resolveTtsChain()`. Fakes must never appear in prod code —
 * only test files may pass this option.
 */
import type { TtsProvider, TtsResult } from "./types";
import { openAiTtsProvider, openAiTtsConfigured } from "../../providers/openai-tts.server";

/** Re-exported so the fallback-chain fakes used by UI/tests share one handle. */
export { openAiTtsProvider };
export type { TtsProvider };
import {
  synthesizeWithTelemetry,
  elevenLabsConfigured,
  ttsUnitCostUsd,
  DEFAULT_VOICE_ID,
  DEFAULT_VOICE_MODEL,
} from "../../providers/voice.server";
import { GATEWAY_TTS_USD_PER_CHAR, recordApiCost } from "../../api-cost";
import type { CostCtx } from "../../api-cost";

function errorResult(
  provider: string,
  code: string,
  message: string,
  latencyMs: number,
  characters: number,
): TtsResult {
  return {
    ok: false,
    audio: null,
    provider,
    model: null,
    latencyMs,
    characters,
    unitCostUsd: null,
    error: { code, message },
  };
}

/** ElevenLabs adapter wrapping the existing telemetry path. */
export const elevenLabsTtsProvider: TtsProvider = {
  id: "elevenlabs",
  label: "ElevenLabs",
  configured: elevenLabsConfigured,
  async synthesize(text, opts): Promise<TtsResult> {
    const started = Date.now();
    const voiceId = opts.voiceId || DEFAULT_VOICE_ID;
    const model = opts.model || DEFAULT_VOICE_MODEL;
    try {
      const result = await synthesizeWithTelemetry(text, { voiceId, model }, {});
      if (result.ok && result.output) {
        return {
          ok: true,
          audio: result.output,
          provider: "elevenlabs",
          model: result.model,
          latencyMs: Date.now() - started,
          characters: text.length,
          unitCostUsd: ttsUnitCostUsd(model),
          error: null,
        };
      }
      return errorResult(
        "elevenlabs",
        result.error?.code ?? "elevenlabs_tts_failed",
        result.error?.message ?? "ElevenLabs TTS failed",
        Date.now() - started,
        text.length,
      );
    } catch (err) {
      return errorResult(
        "elevenlabs",
        "elevenlabs_tts_failed",
        err instanceof Error ? err.message : "ElevenLabs TTS failed",
        Date.now() - started,
        text.length,
      );
    }
  },
};

/** Lovable AI gateway TTS (gpt-4o-mini-tts) — last-resort fallback. */
export const GATEWAY_TTS_MODEL = "openai/gpt-4o-mini-tts";

function gatewayConfigured(): boolean {
  return Boolean(process.env["LOVABLE_API_KEY"]);
}

export const gatewayTtsProvider: TtsProvider = {
  id: "gateway",
  label: "Lovable AI gateway",
  configured: gatewayConfigured,
  async synthesize(text, opts): Promise<TtsResult> {
    const started = Date.now();
    if (!gatewayConfigured()) {
      return errorResult(
        "gateway",
        "unconfigured",
        "Lovable AI gateway is not configured.",
        0,
        text.length,
      );
    }
    try {
      const { providerFetch } = await import("../../providers/http.server");
      const res = await providerFetch("Gateway", "https://ai.gateway.lovable.dev/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env["LOVABLE_API_KEY"]}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: GATEWAY_TTS_MODEL,
          input: text.slice(0, 4000),
          voice: opts.voiceId || "alloy",
          response_format: "mp3",
        }),
        timeoutMs: 120_000,
      });
      const audio = await res.arrayBuffer();
      return {
        ok: true,
        audio,
        provider: "gateway",
        model: GATEWAY_TTS_MODEL,
        latencyMs: Date.now() - started,
        characters: text.length,
        // Gateway cost is a passthrough ESTIMATE (D20), not a list price.
        unitCostUsd: GATEWAY_TTS_USD_PER_CHAR,
        error: null,
      };
    } catch (err) {
      return errorResult(
        "gateway",
        "gateway_tts_failed",
        err instanceof Error ? err.message : "Gateway TTS failed",
        Date.now() - started,
        text.length,
      );
    }
  },
};

/** Env-driven fallback override. VOICE_TTS_FALLBACK names a REGISTERED id. */
export function ttsFallbackId(): string | null {
  const id = process.env["VOICE_TTS_FALLBACK"];
  return id && id.trim().length > 0 ? id.trim() : null;
}

/** Full ordered chain: ElevenLabs → OpenAI → gateway, then env fallback. */
export function resolveTtsChain(): TtsProvider[] {
  const chain: TtsProvider[] = [elevenLabsTtsProvider, openAiTtsProvider, gatewayTtsProvider];
  const fallbackId = ttsFallbackId();
  if (fallbackId) {
    const fallback = chain.find((p) => p.id === fallbackId);
    if (!fallback) {
      console.warn(
        `[vidora] VOICE_TTS_FALLBACK="${fallbackId}" names no registered TTS adapter — ignoring.`,
      );
    }
    // The three registered adapters already form the full ordered chain;
    // the env var exists for future adapters and unknown ids fail closed.
  }
  return chain;
}

export type TtsChainOptions = {
  /**
   * Override the provider chain. Tests inject fake adapters here; production
   * always resolves from resolveTtsChain(). Fakes must never appear in prod
   * code — only test files may pass this option.
   */
  providers?: TtsProvider[] | undefined;
  /** When set and a call succeeds, one row is recorded to api_usage. */
  costCtx?: CostCtx | null | undefined;
  /** Extra fields merged into the api_usage row's meta. */
  meta?: Record<string, unknown> | undefined;
};

/**
 * Tries each configured provider in chain order, one attempt per provider.
 * Returns the first success; if every provider fails (or none is
 * configured) returns the honest error/unconfigured result — never fake
 * success, never a blind retry of a paid call.
 */
export async function synthesizeSpeechWithFallback(
  text: string,
  settings: { voiceId: string; model: string; speed?: number },
  opts: TtsChainOptions = {},
): Promise<TtsResult> {
  const chain = (opts.providers ?? resolveTtsChain()).filter((p) => p.configured());
  const characters = text.length;

  if (chain.length === 0) {
    return errorResult(
      "none",
      "unconfigured",
      "No TTS provider is configured. Connect ElevenLabs or OpenAI in Settings → Providers.",
      0,
      characters,
    );
  }

  let lastError: TtsResult | null = null;
  for (const provider of chain) {
    let result: TtsResult;
    try {
      result = await provider.synthesize(text, settings);
    } catch (err) {
      result = errorResult(
        provider.id,
        `${provider.id}_tts_failed`,
        err instanceof Error ? err.message : `${provider.label} TTS failed`,
        0,
        characters,
      );
    }
    if (result.ok && result.audio) {
      // Record measured cost on the winning call only — losers never spent.
      if (opts.costCtx && result.unitCostUsd !== null) {
        try {
          await recordApiCost(opts.costCtx.admin, {
            userId: opts.costCtx.userId,
            projectId: opts.costCtx.projectId ?? null,
            provider: result.provider,
            operation: "tts",
            units: result.characters,
            unitCostUsd: result.unitCostUsd,
            meta: {
              ...(opts.meta ?? {}),
              model: result.model,
              latency_ms: result.latencyMs,
              fallback_chain: "elevenlabs→openai→gateway",
              ...(result.provider === "gateway"
                ? { cost_basis: "gateway-passthrough-estimate" }
                : {}),
            },
          });
        } catch {
          // Cost bookkeeping must never fail the user's TTS (D19).
        }
      }
      return result;
    }
    lastError = result;
    // One attempt per provider — move on to the next configured adapter.
  }

  return lastError ?? errorResult("none", "tts_failed", "TTS failed.", 0, characters);
}

/** Whether any TTS provider is configured at all (drives unconfigured UI). */
export function ttsAvailable(): boolean {
  return elevenLabsConfigured() || openAiTtsConfigured() || gatewayConfigured();
}
