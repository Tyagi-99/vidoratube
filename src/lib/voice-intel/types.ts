/**
 * Voice Intelligence Layer — core types (D326).
 *
 * A "voice character" is a casting persona (Adam, Niraj, Miguel…), NOT a
 * provider voice. The character carries personality/category metadata used
 * by the recommendation engine; the actual synthesis goes through
 * `provider` + `providerVoiceId`. Characters with `providerVoiceId: null`
 * are `unmapped`: curated and rankable, but they cannot synthesize until
 * a provider voice is assigned (Voice Studio / admin). The availability
 * layer never silently substitutes — it returns an explicit fallback.
 */

export type VoiceCharacterStatus =
  | "verified" // provider id checked against a real provider account
  | "mapped" // provider id from the codebase (high-confidence, not live-checked)
  | "unmapped" // curated persona, no provider voice assigned yet
  | "legacy" // provider id no longer resolves at the provider
  | "unavailable"; // provider reports the voice unavailable right now

export type TtsProviderKind =
  | "elevenlabs"
  | "openai"
  | "google"
  | "azure"
  | "cartesia"
  | "playht";

export type VoiceGender = "masculine" | "feminine" | "neutral";

/** Stable ids for the 17 content categories (spec §Voice Category System). */
export const VOICE_CATEGORY_IDS = [
  "cinematic",
  "storytelling",
  "emotional",
  "documentary",
  "crime_mystery",
  "horror",
  "business_finance",
  "educational",
  "shorts_reels",
  "news",
  "motivational",
  "conversational",
  "podcast",
  "soft_calm",
  "entertainment",
  "lifestyle_beauty",
  "technology_ai",
] as const;
export type VoiceCategoryId = (typeof VOICE_CATEGORY_IDS)[number];

export interface VoiceCategory {
  id: VoiceCategoryId;
  label: string;
  /** Emoji icon used on quick-pick cards (spec §Quick Voice Modes). */
  icon: string;
  blurb: string;
  sort: number;
}

export type LanguageStatus = "active" | "planned";

export interface VoiceLanguage {
  code: string; // "en" | "hi" | "es" | "de" | "fr" …
  name: string; // "English"
  flag: string; // "🇺🇸"
  status: LanguageStatus;
  /** Character id of the smart-default narrator (active languages only). */
  defaultCharacterId: string | null;
  /** Short TTS preview sample in this language (spec §Voice Preview System). */
  previewSample: string;
  /** Approximate characters per minute for duration estimates. */
  charsPerMinute: number;
}

export interface VoiceCharacter {
  /** Stable id, e.g. "adam", "niraj", "leon-stern". */
  id: string;
  name: string;
  languageCode: string;
  gender: VoiceGender;
  /** e.g. "Mexican Spanish", "Argentine", null when n/a. */
  accent: string | null;
  personalityTags: string[];
  categoryTags: VoiceCategoryId[];
  /** Short marketing description shown on the voice card. */
  description: string;
  /** Free-text "best for" lines, e.g. "Faceless YouTube videos". */
  recommendedFor: string[];
  /** Curated quality score, 0–10 (spec values, ESTIMATE-labeled in UI). */
  score: number;
  /** True for the language's smart-default narrator. */
  isDefault: boolean;
  provider: TtsProviderKind;
  /**
   * Concrete provider voice id. Non-null ONLY for ids already present in
   * this codebase (Adam, Elli). Everything else is null + `unmapped`
   * until a real id is assigned and verified. Never invent one.
   */
  providerVoiceId: string | null;
  /** Model ids this character may synthesize with. */
  supportedModels: string[];
  status: VoiceCharacterStatus;
}

export type ModelQuality = 1 | 2 | 3 | 4 | 5;
export type ModelSpeed = "very_fast" | "fast" | "medium" | "slow";
export type ModelExpressiveness = "low" | "medium" | "high" | "very_high";

/** TTS model metadata — configurable seed, refreshable from the provider. */
export interface VoiceModel {
  id: string; // e.g. "eleven_multilingual_v2"
  provider: TtsProviderKind;
  label: string; // "Eleven Multilingual v2"
  quality: ModelQuality;
  speed: ModelSpeed;
  expressiveness: ModelExpressiveness;
  multilingual: boolean;
  /** Languages the model is known to handle well (codes). */
  supportedLanguages: string[];
  bestFor: string;
  /** Multiplier over the provider's base per-character rate. */
  costMultiplier: number;
  /** Advanced controls the UI may offer for this model. */
  supportedParams: VoiceParam[];
  /** Alpha/beta models are labeled, never silently defaulted. */
  maturity: "stable" | "beta" | "alpha";
  isActive: boolean;
}

/** Advanced voice controls. Only shown when the model supports them. */
export const VOICE_PARAMS = [
  "stability",
  "similarity_boost",
  "style",
  "speed",
  "speaker_boost",
] as const;
export type VoiceParam = (typeof VOICE_PARAMS)[number];

export interface VoiceSettings {
  stability: number; // 0..1 (ElevenLabs)
  similarityBoost: number; // 0..1
  style: number; // 0..1 (expressiveness)
  speed: number; // 0.7..1.2
  speakerBoost: boolean;
}

/** What the user picked — persisted on the project. */
export interface VoiceSelection {
  languageCode: string;
  categoryId: VoiceCategoryId | null;
  characterId: string;
  /** Model id, or "auto" for Auto-Recommended. */
  modelId: string;
  settings: VoiceSettings;
  /** True when the user explicitly overrode the recommendation. */
  customised: boolean;
}

export interface RankedVoice {
  character: VoiceCharacter;
  rank: number;
  /** 0..1 blend of curated score + category/personality match. */
  matchScore: number;
  reasons: string[];
}

/** Result of resolving a character to something synthesizable. */
export type VoiceResolution =
  | { ok: true; character: VoiceCharacter; viaFallback: false }
  | {
      ok: true;
      character: VoiceCharacter;
      viaFallback: true;
      requestedId: string;
      reason: string;
    }
  | { ok: false; requestedId: string; reason: string };

export interface VoiceCostEstimate {
  characters: number;
  minutes: number;
  /** Whole credits, rounded up (1 credit = 1 finished minute). */
  credits: number;
  usd: number;
  modelId: string;
  costMultiplier: number;
}
