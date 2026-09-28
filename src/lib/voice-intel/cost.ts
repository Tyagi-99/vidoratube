/**
 * Voice Intelligence — cost estimation (D327).
 *
 * Pure client-safe estimators. Rates mirror src/lib/api-cost.ts
 * (ELEVENLABS_TTS_USD_PER_CHAR / _MULTILINGUAL_USD_PER_CHAR); the server
 * re-computes with the live model before any debit. 1 credit = 1 finished
 * minute of narration.
 */
import { voiceLanguage, voiceModel } from "./catalog";
import type { VoiceCostEstimate } from "./types";

/** Base USD/char tiers — mirrors src/lib/api-cost.ts. */
export const TTS_USD_PER_CHAR = 0.05 / 1000;
export const TTS_MULTILINGUAL_USD_PER_CHAR = 0.1 / 1000;

export function estimateVoiceCost(
  text: string,
  opts: { modelId?: string | null; languageCode?: string | null } = {},
): VoiceCostEstimate {
  const characters = text.length;
  const lang = voiceLanguage(opts.languageCode ?? undefined);
  const charsPerMinute = lang?.charsPerMinute ?? 800;
  const minutes = characters / charsPerMinute;
  const model = opts.modelId ? voiceModel(opts.modelId) : undefined;
  const multilingual = !model || /multilingual/i.test(model.id) || model.multilingual;
  const baseRate = multilingual ? TTS_MULTILINGUAL_USD_PER_CHAR : TTS_USD_PER_CHAR;
  const costMultiplier = model?.costMultiplier ?? 1;
  return {
    characters,
    minutes: Math.round(minutes * 10) / 10,
    credits: Math.max(1, Math.ceil(minutes)),
    usd: Math.round(characters * baseRate * costMultiplier * 10000) / 10000,
    modelId: model?.id ?? "eleven_multilingual_v2",
    costMultiplier,
  };
}

/** "≈ 2:30" style duration label for the summary panel. */
export function formatNarrationDuration(minutes: number): string {
  const totalSeconds = Math.max(1, Math.round(minutes * 60));
  const m = Math.floor(totalSeconds / 60);
  const s = String(totalSeconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}
