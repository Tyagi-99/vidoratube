/**
 * OpenAI TTS provider adapter (F17 Voice Studio, Stream D, Phase 3).
 *
 * Fallback adapter in the voice-studio TTS chain: ElevenLabs is the primary
 * (see src/lib/providers/voice.server.ts), OpenAI `gpt-4o-mini-tts` is the
 * fallback. Same shape as the ElevenLabs module — `configured()` env gate,
 * raw `synthesize`, and a telemetry-wrapped variant that flows through the
 * standard ProviderResult envelope (never throws).
 *
 * Cost: list price gpt-4o-mini-tts $0.60/1M characters (platform.openai.com,
 * 2026) — a published rate, not an estimate, so estimates.server.ts can price
 * `provider: "openai"` TTS jobs with costBasis "list-price".
 */
import { providerFetch } from "./http.server";
import { withProviderTelemetry } from "./telemetry.server";
import type { ProviderResult } from "./contracts";
import type { CostCtx } from "../api-cost";
import { OPENAI_TTS_USD_PER_CHAR } from "../api-cost";
import type { TtsProvider, TtsResult } from "../creation/voice/types";

export const OPENAI_TTS_MODEL = "gpt-4o-mini-tts";
export const OPENAI_TTS_DEFAULT_VOICE = "alloy";

/** OpenAI's supported tts voices (per API docs; the API 400s otherwise). */
export const OPENAI_TTS_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "onyx",
  "nova",
  "sage",
  "shimmer",
  "verse",
] as const;

export function openAiTtsConfigured(): boolean {
  return Boolean(process.env["OPENAI_API_KEY"]);
}

function key(): string {
  const k = process.env["OPENAI_API_KEY"];
  if (!k) throw new Error("OpenAI TTS is not configured. Set OPENAI_API_KEY.");
  return k;
}

export type OpenAiTtsSettings = {
  voice?: string | undefined;
  model?: string | undefined;
  speed?: number | undefined;
};

function sanitizeVoice(voice: string | undefined): string {
  const v = (voice ?? "").toLowerCase().trim();
  return (OPENAI_TTS_VOICES as readonly string[]).includes(v) ? v : OPENAI_TTS_DEFAULT_VOICE;
}

/** Raw OpenAI TTS call — returns MP3 audio. Throws on HTTP failure. */
export async function synthesizeOpenAi(
  text: string,
  settings: OpenAiTtsSettings = {},
): Promise<ArrayBuffer> {
  const res = await providerFetch("OpenAI", "https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: settings.model || OPENAI_TTS_MODEL,
      input: text,
      voice: sanitizeVoice(settings.voice),
      response_format: "mp3",
      speed: settings.speed ?? 1.0,
    }),
    timeoutMs: 120_000,
  });
  return res.arrayBuffer();
}

export type OpenAiTelemetryOptions = {
  costCtx?: CostCtx | null | undefined;
  meta?: Record<string, unknown> | undefined;
};

/**
 * Telemetry-wrapped OpenAI TTS: returns the ProviderResult envelope and
 * records the measured list-price cost to api_usage on success.
 */
export async function synthesizeOpenAiWithTelemetry(
  text: string,
  settings: OpenAiTtsSettings = {},
  opts: OpenAiTelemetryOptions = {},
): Promise<ProviderResult<ArrayBuffer>> {
  const model = settings.model || OPENAI_TTS_MODEL;
  return withProviderTelemetry(() => synthesizeOpenAi(text, settings), {
    provider: "openai",
    operation: "tts",
    model,
    configured: openAiTtsConfigured(),
    estimate: {
      units: Math.max(1, text.length),
      unitCostUsd: OPENAI_TTS_USD_PER_CHAR,
    },
    usage: { characters: text.length },
    meta: opts.meta,
    costCtx: opts.costCtx ?? null,
  });
}

/** The OpenAI TTS adapter as a chain member (see chain.server.ts). */
export const openAiTtsProvider: TtsProvider = {
  id: "openai",
  label: "OpenAI TTS",
  configured: openAiTtsConfigured,
  async synthesize(text, opts): Promise<TtsResult> {
    const started = Date.now();
    try {
      const result = await synthesizeOpenAiWithTelemetry(
        text,
        { voice: opts.voiceId, model: opts.model, speed: opts.speed },
        {},
      );
      if (result.ok && result.output) {
        return {
          ok: true,
          audio: result.output,
          provider: "openai",
          model: result.model,
          latencyMs: Date.now() - started,
          characters: text.length,
          unitCostUsd: OPENAI_TTS_USD_PER_CHAR,
          error: null,
        };
      }
      return {
        ok: false,
        audio: null,
        provider: "openai",
        model: result.model,
        latencyMs: Date.now() - started,
        characters: text.length,
        unitCostUsd: OPENAI_TTS_USD_PER_CHAR,
        error: result.error ?? {
          code: "openai_tts_failed",
          message: "OpenAI TTS failed",
        },
      };
    } catch (err) {
      // Chain contract: adapters never throw; the chain moves on.
      return {
        ok: false,
        audio: null,
        provider: "openai",
        model: null,
        latencyMs: Date.now() - started,
        characters: text.length,
        unitCostUsd: OPENAI_TTS_USD_PER_CHAR,
        error: {
          code: "openai_tts_failed",
          message: err instanceof Error ? err.message : "OpenAI TTS failed",
        },
      };
    }
  },
};
