/**
 * Voice Intelligence — cross-stream contract (D327).
 *
 * Client-safe input/output types for the Voice Intelligence server
 * functions. Stream B implements the functions in
 * voice-intel.functions.ts; Stream C builds the UI against these types.
 * Neither stream may change these shapes without coordinator approval.
 */
import type {
  VoiceCharacter,
  VoiceModel,
  VoiceSelection,
} from "./types";
import type { VoiceAvailability } from "./availability";

/** A saved, reusable voice configuration. */
export interface VoiceProfile {
  id: string;
  name: string;
  selection: VoiceSelection;
  createdAt: string;
}

export type PreviewErrorCode =
  | "UNMAPPED_VOICE"
  | "NO_TTS_PROVIDER"
  | "TTS_FAILED"
  | "TTS_QUOTA_EXHAUSTED";

export type PreviewVoiceResult =
  | {
      ok: true;
      audioUrl: string;
      cached: boolean;
      characterId: string;
      viaFallback: boolean;
      fallbackNote: string | null;
    }
  | {
      ok: false;
      code: PreviewErrorCode;
      message: string;
      /** Explicit alternative the UI can offer one-click. Never silent. */
      fallbackCharacterId: string | null;
    };

export interface CompareVoiceItem {
  characterId: string;
  audioUrl: string | null;
  error: string | null;
}

export type CompareVoicesResult = { results: CompareVoiceItem[] };

export type SynthesizeNarrationResult =
  | {
      ok: true;
      jobId: string;
      audioUrl: string;
      durationSeconds: number;
      provider: string;
      model: string;
      characters: number;
    }
  | {
      ok: false;
      code:
        | PreviewErrorCode
        | "INSUFFICIENT_CREDITS"
        | "BUDGET_EXCEEDED"
        | "UNKNOWN_COST"
        | "VOICE_NOT_FOUND";
      message: string;
      fallbackCharacterId: string | null;
    };

export interface VoiceAvailabilityInfo {
  characterId: string;
  availability: VoiceAvailability;
  providerConfigured: boolean;
}

export interface TtsProviderStatus {
  providers: { id: string; label: string; configured: boolean; role: string }[];
  anyConfigured: boolean;
}

export interface VoiceCharactersPayload {
  characters: VoiceCharacter[];
  models: VoiceModel[];
}

export type { VoiceSelection };
