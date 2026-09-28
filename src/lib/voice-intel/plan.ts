/**
 * Voice Intelligence — synthesis plan (D328).
 *
 * Bridges a persisted {@link VoiceSelection} and the TTS stage: resolves
 * the effective provider voice id (explicit fallback, never silent), the
 * effective model ("auto" → autoSelectModel), and the settings to apply.
 * Pure and client-safe — the server TTS stage and the UI summary panel
 * share this logic.
 */
import { resolveVoiceForSynthesis } from "./availability";
import { voiceLanguage, voiceModel } from "./catalog";
import { autoSelectModel } from "./models";
import type { VoiceSelection, VoiceSettings } from "./types";

export interface SynthesisPlan {
  /** Concrete provider voice id, or null when none is usable (legacy path). */
  voiceId: string | null;
  /** Character id that will effectively speak. */
  characterId: string;
  viaFallback: boolean;
  fallbackNote: string | null;
  modelId: string;
  settings: VoiceSettings;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Runtime guard — the DB column can hold anything; never trust it blindly. */
export function isVoiceSelection(v: unknown): v is VoiceSelection {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as { characterId?: unknown }).characterId === "string" &&
    typeof (v as { languageCode?: unknown }).languageCode === "string" &&
    !!(v as { settings?: unknown }).settings &&
    typeof (v as { settings: { stability?: unknown } }).settings.stability === "number"
  );
}

/**
 * Resolve the effective TTS plan for a narration of `narrationChars`
 * characters. `providerConfigured` must reflect the real server-side key
 * state — never claim readiness when the key is missing/invalid.
 */
export function resolveSynthesisPlan(
  selection: VoiceSelection,
  narrationChars: number,
  providerConfigured: boolean,
): SynthesisPlan {
  const resolution = resolveVoiceForSynthesis({
    characterId: selection.characterId,
    categoryId: selection.categoryId,
    providerConfigured,
  });

  const voiceId =
    resolution.ok && resolution.character.providerVoiceId
      ? resolution.character.providerVoiceId
      : null;

  let modelId = "eleven_multilingual_v2";
  if (selection.modelId && selection.modelId !== "auto") {
    const m = voiceModel(selection.modelId);
    if (m && m.isActive) modelId = m.id;
  } else {
    const lang = voiceLanguage(selection.languageCode);
    const charsPerMinute = lang?.charsPerMinute ?? 800;
    const durationSeconds = Math.max(5, (narrationChars / charsPerMinute) * 60);
    modelId = autoSelectModel({
      durationSeconds,
      categoryId: selection.categoryId,
      languageCode: selection.languageCode,
    }).model.id;
  }

  const s = selection.settings;
  const settings: VoiceSettings = {
    stability: clamp01(s.stability),
    similarityBoost: clamp01(s.similarityBoost),
    style: clamp01(s.style),
    speed: Math.min(1.2, Math.max(0.7, s.speed)),
    speakerBoost: s.speakerBoost,
  };

  if (!resolution.ok) {
    return {
      voiceId: null,
      characterId: selection.characterId,
      viaFallback: false,
      fallbackNote: resolution.reason,
      modelId,
      settings,
    };
  }
  return {
    voiceId,
    characterId: resolution.character.id,
    viaFallback: resolution.viaFallback,
    fallbackNote: resolution.viaFallback ? resolution.reason : null,
    modelId,
    settings,
  };
}
