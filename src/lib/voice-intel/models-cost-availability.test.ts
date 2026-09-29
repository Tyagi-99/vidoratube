import { describe, expect, it } from "vitest";
import {
  autoSelectModel,
  compatibleModels,
  recommendedSettings,
} from "./models";
import { estimateVoiceCost, formatNarrationDuration } from "./cost";
import {
  availabilityLabel,
  availabilityOf,
  bestFallback,
  friendlyTtsError,
  resolveVoiceForSynthesis,
} from "./availability";
import { voiceCharacter } from "./catalog";
import type { VoiceCharacter } from "./types";

describe("autoSelectModel", () => {
  it("short-form content → Eleven v4 (fastest + most emotive)", () => {
    const { model, reason } = autoSelectModel({
      durationSeconds: 45,
      categoryId: "shorts_reels",
      languageCode: "en",
    });
    expect(model.id).toBe("eleven_v4");
    expect(reason).toMatch(/eleven v4/i);
  });

  it("long-form documentary → Eleven v4 (quality + consistency)", () => {
    const { model } = autoSelectModel({
      durationSeconds: 1200,
      categoryId: "documentary",
      languageCode: "en",
    });
    expect(model.id).toBe("eleven_v4");
  });

  it("emotional narration → Eleven v4 (most expressive)", () => {
    const { model } = autoSelectModel({
      durationSeconds: 600,
      categoryId: "emotional",
      languageCode: "en",
      emotional: true,
    });
    expect(model.id).toBe("eleven_v4");
    expect(model.expressiveness).toBe("very_high");
  });

  it("medium content defaults to Eleven v4", () => {
    const { model } = autoSelectModel({
      durationSeconds: 180,
      categoryId: "educational",
      languageCode: "hi",
    });
    expect(model.id).toBe("eleven_v4");
  });

  it("falls back to Multilingual v2 for languages v4 does not support", () => {
    const { model } = autoSelectModel({
      durationSeconds: 180,
      categoryId: "educational",
      languageCode: "xx",
    });
    expect(model.id).toBe("eleven_multilingual_v2");
  });
});

describe("recommendedSettings", () => {
  it("documentary is stable and measured", () => {
    const s = recommendedSettings("documentary");
    expect(s.stability).toBeGreaterThanOrEqual(0.7);
    expect(s.speed).toBeLessThanOrEqual(1);
  });

  it("shorts are fast and expressive", () => {
    const s = recommendedSettings("shorts_reels");
    expect(s.speed).toBeGreaterThan(1);
    expect(s.style).toBeGreaterThan(0.5);
  });

  it("clamps to supported params (OpenAI model only supports speed)", () => {
    const s = recommendedSettings("emotional", "openai_tts_1");
    // speed is supported → keeps the category's pace; everything else
    // falls back to neutral/off.
    expect(s.speed).toBe(0.95);
    expect(s.stability).toBe(0.55);
    expect(s.speakerBoost).toBe(false);
  });

  it("compatibleModels lists stable models first", () => {
    const models = compatibleModels(["eleven_v3", "eleven_flash_v2_5"]);
    expect(models[0]!.id).toBe("eleven_flash_v2_5");
  });
});

describe("estimateVoiceCost", () => {
  it("800 chars ≈ 1 minute ≈ 1 credit", () => {
    const est = estimateVoiceCost("x".repeat(800), { modelId: "eleven_flash_v2_5", languageCode: "en" });
    expect(est.minutes).toBe(1);
    expect(est.credits).toBe(1);
    expect(est.characters).toBe(800);
  });

  it("rounds credits up for partial minutes", () => {
    const est = estimateVoiceCost("x".repeat(900), { languageCode: "en" });
    expect(est.credits).toBe(2);
  });

  it("multilingual models cost 2x the base tier", () => {
    const flash = estimateVoiceCost("x".repeat(1000), { modelId: "eleven_flash_v2_5" });
    const multi = estimateVoiceCost("x".repeat(1000), { modelId: "eleven_multilingual_v2" });
    expect(multi.usd).toBeCloseTo(flash.usd * 2, 6);
  });

  it("eleven_v4 uses the promo rate ($0.022/1k) while the discount is live", () => {
    const est = estimateVoiceCost("x".repeat(1000), { modelId: "eleven_v4" });
    expect(est.usd).toBeCloseTo(0.022, 6);
  });

  it("formats narration duration as m:ss", () => {
    expect(formatNarrationDuration(2.5)).toBe("2:30");
    expect(formatNarrationDuration(0.5)).toBe("0:30");
  });
});

describe("availability", () => {
  it("mapped voice with provider configured is ready", () => {
    const adam = voiceCharacter("adam")!;
    expect(availabilityOf(adam, true)).toBe("ready");
    expect(availabilityOf(adam, false)).toBe("needs_key");
  });

  it("unmapped voice is never reported ready", () => {
    // Synthetic unmapped character: the live catalog has none left, so the
    // availability logic is exercised without depending on catalog data.
    const ghost = {
      ...voiceCharacter("niraj")!,
      providerVoiceId: null,
      status: "unmapped" as const,
    };
    expect(availabilityOf(ghost, true)).toBe("unmapped");
    expect(availabilityLabel("unmapped")).toBe("Not connected yet");
  });

  it("bestFallback picks the best same-language mapped voice when one exists", () => {
    // Synthetic Hindi pool: the fallback mechanism is exercised with injected
    // candidates because the live catalog currently has no partially-mapped language.
    const requested = voiceCharacter("niraj")!;
    const candidates: VoiceCharacter[] = [
      {
        ...requested, id: "hindi-a", name: "Hindi A",
        providerVoiceId: "voice-a", status: "mapped" as const,
        score: 8.0, categoryTags: ["documentary"], isDefault: false,
      },
      {
        ...requested, id: "hindi-b", name: "Hindi B",
        providerVoiceId: "voice-b", status: "mapped" as const,
        score: 9.5, categoryTags: ["crime_mystery"], isDefault: true,
      },
    ];
    const pick = bestFallback(requested, "crime_mystery", candidates);
    expect(pick?.id).toBe("hindi-b"); // category match + higher score + default bonus
  });

  it("bestFallback returns null when no same-language mapped voice exists", () => {
    const requested = voiceCharacter("niraj")!;
    expect(bestFallback(requested, null, [])).toBeNull();
    // English candidates never serve a Hindi request.
    expect(bestFallback(requested, null, [voiceCharacter("adam")!])).toBeNull();
  });

  it("mapped Hindi voice resolves directly with its own provider voice id", () => {
    const res = resolveVoiceForSynthesis({
      characterId: "niraj",
      providerConfigured: true,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.viaFallback).toBe(false);
      expect(res.character.id).toBe("niraj");
      expect(res.character.providerVoiceId).toBe("k0gtD0Bbpi6hL40jfHfm");
    }
  });

  it("unknown character id fails cleanly", () => {
    const res = resolveVoiceForSynthesis({ characterId: "nope", providerConfigured: true });
    expect(res.ok).toBe(false);
  });

  it("friendly errors never leak raw provider codes", () => {
    expect(friendlyTtsError("UNMAPPED_VOICE")).not.toMatch(/UNMAPPED_VOICE/);
    expect(friendlyTtsError("NO_TTS_PROVIDER")).toMatch(/ElevenLabs API key/);
    expect(friendlyTtsError("SOME_NEW_CODE")).toMatch(/retry/i);
  });
});
