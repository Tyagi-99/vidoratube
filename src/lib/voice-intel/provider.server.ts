/**
 * Voice Intelligence — provider layer (Stream B).
 *
 * VoiceProvider adapters plus the TTS plumbing used by the Voice
 * Intelligence server functions. ElevenLabs is the live primary: validation
 * and model listing go through the shared `providerFetch` helper (with its
 * honest ProviderError status mapping), synthesis delegates to the existing
 * TTS chain. Every other provider is an honest, interface-conformant stub
 * whose configured() returns false until someone wires it for real.
 */
import { ProviderError, providerFetch } from "../providers/http.server";
import {
  elevenLabsTtsProvider,
  synthesizeSpeechWithFallback,
} from "../creation/voice/chain.server";

/** Live ElevenLabs model descriptor (subset of the API response we need). */
export type ProviderModelInfo = {
  id: string;
  label: string;
};

export type ProviderVoiceValidation =
  | { ok: true; status: "ready" }
  | { ok: false; status: "legacy" | "needs_key" | "unavailable"; detail?: string };

/** A voice provider adapter. `configured()` is false until a real key exists. */
export interface VoiceProvider {
  id: "elevenlabs" | "openai" | "google" | "azure" | "cartesia" | "playht";
  label: string;
  configured(): boolean;
  /** Live model list; [] when unconfigured so callers fall back to seeds. */
  listModels(): Promise<ProviderModelInfo[]>;
  /** Validate a provider voice id; honest status mapping (404 → legacy). */
  validateVoice(voiceId: string): Promise<ProviderVoiceValidation>;
  synthesize: typeof elevenLabsTtsProvider.synthesize;
}

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1";

function elevenLabsKey(): string | null {
  const key = (process.env["ELEVENLABS_API_KEY"] ?? "").trim();
  return key.length > 0 ? key : null;
}

async function listElevenLabsModels(): Promise<ProviderModelInfo[]> {
  const key = elevenLabsKey();
  if (!key) return [];
  const res = await providerFetch("ElevenLabs", `${ELEVENLABS_API_BASE}/models`, {
    headers: { "xi-api-key": key },
  });
  const body = (await res.json()) as Array<{
    model_id?: string;
    name?: string;
    display_name?: string;
  }>;
  return body
    .map((m) => ({
      id: String(m.model_id ?? m.name ?? ""),
      label: String(m.display_name ?? m.name ?? ""),
    }))
    .filter((m) => m.id.length > 0);
}

async function validateElevenLabsVoice(voiceId: string): Promise<ProviderVoiceValidation> {
  const key = elevenLabsKey();
  if (!key) return { ok: false, status: "needs_key", detail: "no API key configured" };
  try {
    const res = await providerFetch("ElevenLabs", `${ELEVENLABS_API_BASE}/voices/${voiceId}`, {
      headers: { "xi-api-key": key },
    });
    if (!res.ok)
      return { ok: false, status: "unavailable", detail: `unexpected status ${res.status}` };
    return { ok: true, status: "ready" };
  } catch (err) {
    if (err instanceof ProviderError) {
      if (err.status === 404) return { ok: false, status: "legacy", detail: err.message };
      if (err.status === 401 || err.status === 403)
        return { ok: false, status: "needs_key", detail: err.message };
      return { ok: false, status: "unavailable", detail: err.message };
    }
    return {
      ok: false,
      status: "unavailable",
      detail: err instanceof Error ? err.message : "request failed",
    };
  }
}

/** Live ElevenLabs adapter — synthesis delegates to the shared TTS chain. */
export const elevenLabsVoiceProvider: VoiceProvider = {
  id: "elevenlabs",
  label: "ElevenLabs",
  configured: () => elevenLabsKey() !== null,
  listModels: listElevenLabsModels,
  validateVoice: validateElevenLabsVoice,
  synthesize: elevenLabsTtsProvider.synthesize,
};

function stubProvider(
  id: Exclude<VoiceProvider["id"], "elevenlabs">,
  label: string,
): VoiceProvider {
  return {
    id,
    label,
    configured: () => false,
    listModels: async () => [],
    validateVoice: async () => ({
      ok: false,
      status: "needs_key",
      detail: `${label} is not wired up yet`,
    }),
    synthesize: async () =>
      // Chain with zero providers → the honest "unconfigured" result.
      synthesizeSpeechWithFallback("", { voiceId: "", model: "" }),
  };
}

/** Honest stubs — every one reports configured() === false. */
export const openAiVoiceProvider = stubProvider("openai", "OpenAI");
export const googleVoiceProvider = stubProvider("google", "Google Cloud TTS");
export const azureVoiceProvider = stubProvider("azure", "Azure Speech");
export const cartesiaVoiceProvider = stubProvider("cartesia", "Cartesia");
export const playHtVoiceProvider = stubProvider("playht", "PlayHT");

export const VOICE_PROVIDERS: VoiceProvider[] = [
  elevenLabsVoiceProvider,
  openAiVoiceProvider,
  googleVoiceProvider,
  azureVoiceProvider,
  cartesiaVoiceProvider,
  playHtVoiceProvider,
];

export function voiceProvider(id: VoiceProvider["id"]): VoiceProvider | null {
  return VOICE_PROVIDERS.find((p) => p.id === id) ?? null;
}
