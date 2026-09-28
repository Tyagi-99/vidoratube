/**
 * Voice Intelligence — model selection + recommended settings (D327).
 *
 * The voice CHARACTER (who speaks) and the voice MODEL (how the provider
 * renders it) are independent choices. Auto mode picks a model from the
 * content shape; the settings engine maps content categories onto the
 * selected model's real parameter ranges (ElevenLabs 0..1, speed 0.7..1.2).
 * The UI must only render controls listed in the model's `supportedParams`.
 */
import { VOICE_MODELS, voiceModel } from "./catalog";
import type {
  VoiceCategoryId,
  VoiceModel,
  VoiceSettings,
} from "./types";

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  stability: 0.55,
  similarityBoost: 0.75,
  style: 0.35,
  speed: 1.0,
  speakerBoost: true,
};

const CATEGORY_SETTINGS: Partial<Record<VoiceCategoryId, VoiceSettings>> = {
  documentary: { stability: 0.75, similarityBoost: 0.7, style: 0.35, speed: 0.95, speakerBoost: true },
  news: { stability: 0.8, similarityBoost: 0.6, style: 0.25, speed: 1.0, speakerBoost: false },
  educational: { stability: 0.7, similarityBoost: 0.7, style: 0.3, speed: 0.97, speakerBoost: true },
  shorts_reels: { stability: 0.5, similarityBoost: 0.75, style: 0.65, speed: 1.08, speakerBoost: true },
  entertainment: { stability: 0.5, similarityBoost: 0.75, style: 0.6, speed: 1.05, speakerBoost: true },
  emotional: { stability: 0.45, similarityBoost: 0.8, style: 0.7, speed: 0.95, speakerBoost: true },
  horror: { stability: 0.4, similarityBoost: 0.8, style: 0.7, speed: 0.92, speakerBoost: true },
  storytelling: { stability: 0.55, similarityBoost: 0.8, style: 0.55, speed: 0.97, speakerBoost: true },
  cinematic: { stability: 0.5, similarityBoost: 0.8, style: 0.65, speed: 0.96, speakerBoost: true },
  crime_mystery: { stability: 0.55, similarityBoost: 0.8, style: 0.55, speed: 0.95, speakerBoost: true },
  motivational: { stability: 0.5, similarityBoost: 0.75, style: 0.65, speed: 1.03, speakerBoost: true },
  conversational: { stability: 0.45, similarityBoost: 0.7, style: 0.5, speed: 1.0, speakerBoost: true },
  podcast: { stability: 0.6, similarityBoost: 0.75, style: 0.4, speed: 0.98, speakerBoost: true },
  soft_calm: { stability: 0.6, similarityBoost: 0.8, style: 0.45, speed: 0.92, speakerBoost: true },
  lifestyle_beauty: { stability: 0.5, similarityBoost: 0.75, style: 0.55, speed: 1.02, speakerBoost: true },
  business_finance: { stability: 0.7, similarityBoost: 0.65, style: 0.3, speed: 0.98, speakerBoost: true },
  technology_ai: { stability: 0.65, similarityBoost: 0.7, style: 0.35, speed: 1.0, speakerBoost: true },
};

/**
 * AI-recommended TTS settings for a content category, clamped to the
 * selected model's real parameter ranges. Unknown categories fall back
 * to the neutral default.
 */
export function recommendedSettings(
  categoryId: VoiceCategoryId | null | undefined,
  modelId?: string | null,
): VoiceSettings {
  const base = (categoryId && CATEGORY_SETTINGS[categoryId]) || DEFAULT_VOICE_SETTINGS;
  const model = modelId ? voiceModel(modelId) : undefined;
  const supported = new Set(model?.supportedParams ?? []);
  const hasModel = Boolean(model);
  return {
    stability: hasModel && !supported.has("stability") ? DEFAULT_VOICE_SETTINGS.stability : clamp01(base.stability),
    similarityBoost: hasModel && !supported.has("similarity_boost") ? DEFAULT_VOICE_SETTINGS.similarityBoost : clamp01(base.similarityBoost),
    style: hasModel && !supported.has("style") ? DEFAULT_VOICE_SETTINGS.style : clamp01(base.style),
    speed: hasModel && !supported.has("speed") ? 1.0 : clamp(base.speed, 0.7, 1.2),
    speakerBoost: hasModel && !supported.has("speaker_boost") ? false : base.speakerBoost,
  };
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export interface AutoModelInput {
  durationSeconds: number;
  categoryId: VoiceCategoryId | null;
  languageCode: string;
  /** True for emotionally-driven scripts (drama, horror, heartfelt stories). */
  emotional?: boolean;
}

export interface AutoModelChoice {
  model: VoiceModel;
  reason: string;
}

const SHORT_FORM_SECONDS = 90;
const LONG_FORM_SECONDS = 300;

/**
 * Auto — Recommended model selection (spec §Auto Model Mode):
 * short-form → fastest generation; long-form → quality + consistency;
 * highly emotional → most expressive.
 */
export function autoSelectModel(input: AutoModelInput): AutoModelChoice {
  const { durationSeconds, categoryId, languageCode, emotional = false } = input;
  const byId = (id: string) => voiceModel(id)!;

  const supportsLang = (m: VoiceModel) =>
    m.supportedLanguages.includes(languageCode);

  if (durationSeconds <= SHORT_FORM_SECONDS || categoryId === "shorts_reels") {
    const m = byId("eleven_flash_v2_5");
    return {
      model: m,
      reason: `Short-form content (${Math.round(durationSeconds)}s) — Flash prioritizes generation speed.`,
    };
  }
  if (
    emotional ||
    (categoryId !== null &&
      ["emotional", "horror", "cinematic", "storytelling"].includes(categoryId) &&
      durationSeconds > 120)
  ) {
    const m = byId("eleven_v3");
    return {
      model: supportsLang(m) ? m : byId("eleven_multilingual_v2"),
      reason:
        "Emotionally-driven narration — v3 prioritizes expressiveness (alpha model).",
    };
  }
  if (durationSeconds >= LONG_FORM_SECONDS) {
    const m = byId("eleven_multilingual_v2");
    return {
      model: m,
      reason: `Long-form (${Math.round(durationSeconds / 60)} min) — Multilingual v2 prioritizes quality and voice consistency.`,
    };
  }
  return {
    model: byId("eleven_multilingual_v2"),
    reason: "Balanced default — quality multilingual narration.",
  };
}

/** Models a character may use, active only, stable first. */
export function compatibleModels(characterSupported: string[]): VoiceModel[] {
  return VOICE_MODELS.filter((m) => m.isActive && characterSupported.includes(m.id)).sort(
    (a, b) => Number(a.maturity !== "stable") - Number(b.maturity !== "stable"),
  );
}
