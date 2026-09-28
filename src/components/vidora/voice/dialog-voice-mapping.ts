/**
 * Voice Intelligence — Stream C UI helper.
 *
 * Maps a VoiceSelection onto the legacy voice key the Script-to-Video
 * render pipeline understands (see src/lib/render.server.ts
 * ELEVENLABS_VOICE_MAP / VOICE_MAP). The mapping is NEVER silent: when the
 * selected character cannot be consumed by the pipeline, the returned
 * `note` says so explicitly and names the voice that will actually be
 * used. The summary panel renders this note; the dialog passes
 * `legacyKey` as the job's `voice`.
 */
import {
  resolveVoiceForSynthesis,
  voiceCharacter,
  voiceLanguage,
} from "@/lib/voice-intel";
import { DEFAULT_VOICE_SETTINGS } from "@/lib/voice-intel/models";
import type { VoiceSelection } from "@/lib/voice-intel/types";

/** Characters with a voice key the legacy pipeline maps 1:1. */
const CHARACTER_TO_LEGACY_KEY: Record<string, string> = {
  // Adam's provider id (pNInz6obpgDQGcFmaJgB) is ELEVENLABS_VOICE_MAP["sirius"].
  adam: "sirius",
};

/** Known-good legacy key used when no direct mapping exists. */
const FALLBACK_LEGACY_KEY = "sirius";

export interface DialogVoiceResolution {
  /** Legacy voice key for the render pipeline's `voice` field. */
  legacyKey: string;
  /** Character id that will effectively voice the video. */
  effectiveCharacterId: string;
  /** True when the requested character could not be used directly. */
  viaFallback: boolean;
  /** Explicit human-readable note; null when the pick maps cleanly. */
  note: string | null;
}

/** Sensible default selection before the section reports its first state. */
export const FALLBACK_VOICE_SELECTION: VoiceSelection = {
  languageCode: "en",
  categoryId: null,
  characterId: "adam",
  modelId: "auto",
  settings: { ...DEFAULT_VOICE_SETTINGS },
  customised: false,
};

export function resolveDialogVoiceKey(
  selection: VoiceSelection,
  /**
   * Real ElevenLabs readiness from the backend (getVoiceProviderStatus).
   * Defaults to false (conservative) when the caller has no status yet —
   * never claim a mapped provider voice until the backend confirms it.
   */
  providerConfigured = false,
): DialogVoiceResolution {
  const requested = voiceCharacter(selection.characterId);
  const requestedName = requested?.name ?? "This voice";
  const directKey = requested
    ? CHARACTER_TO_LEGACY_KEY[requested.id]
    : undefined;

  // Clean path: mapped character with a pipeline key.
  if (requested && requested.providerVoiceId && directKey) {
    return {
      legacyKey: directKey,
      effectiveCharacterId: requested.id,
      viaFallback: false,
      note: null,
    };
  }

  const resolution = resolveVoiceForSynthesis({
    characterId: selection.characterId,
    categoryId: selection.categoryId,
    providerConfigured,
  });

  if (resolution.ok && !resolution.viaFallback) {
    // Provider-mapped but unknown to the legacy pipeline (e.g. Elli):
    // the pipeline would silently substitute its own default, so say so.
    return {
      legacyKey: FALLBACK_LEGACY_KEY,
      effectiveCharacterId: resolution.character.id,
      viaFallback: true,
      note: `${resolution.character.name} isn't wired into the video pipeline yet — this video will use a standard narration voice. Your selection is saved and will apply automatically once it's connected.`,
    };
  }

  if (resolution.ok && resolution.viaFallback) {
    const fb = resolution.character;
    return {
      legacyKey: CHARACTER_TO_LEGACY_KEY[fb.id] ?? FALLBACK_LEGACY_KEY,
      effectiveCharacterId: fb.id,
      viaFallback: true,
      note: `${requestedName} isn't connected to a narration provider yet — this video will use ${fb.name}.`,
    };
  }

  // No compatible provider voice in this language at all.
  const langName =
    voiceLanguage(selection.languageCode)?.name ?? selection.languageCode;
  return {
    legacyKey: FALLBACK_LEGACY_KEY,
    effectiveCharacterId: selection.characterId,
    viaFallback: true,
    note: `${requestedName} isn't connected to a narration provider yet, and no ${langName} provider voice is available — this video will use a standard narration voice. Your selection is saved and will apply automatically once a voice is connected.`,
  };
}
