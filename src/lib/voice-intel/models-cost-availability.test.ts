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
  friendlyTtsError,
  resolveVoiceForSynthesis,
} from "./availability";
import { voiceCharacter } from "./catalog";

describe("autoSelectModel", () => {
  it("short-form content → Flash (fastest)", () => {
    const { model, reason } = autoSelectModel({
      durationSeconds: 45,
      categoryId: "shorts_reels",
      languageCode: "en",
    });
    expect(model.id).toBe("eleven_flash_v2_5");
    expect(reason).toMatch(/short-form/i);
  });

  it("long-form documentary → Multilingual v2 (quality + consistency)", () => {
    const { model } = autoSelectModel({
      durationSeconds: 1200,
      categoryId: "documentary",
      languageCode: "en",
    });
    expect(model.id).toBe("eleven_multilingual_v2");
  });

  it("emotional narration → v3 (expressive, alpha-labeled)", () => {
    const { model } = autoSelectModel({
      durationSeconds: 600,
      categoryId: "emotional",
      languageCode: "en",
      emotional: true,
    });
    expect(model.id).toBe("eleven_v3");
    expect(model.maturity).toBe("alpha");
  });

  it("medium content defaults to Multilingual v2", () => {
    const { model } = autoSelectModel({
      durationSeconds: 180,
      categoryId: "educational",
      languageCode: "hi",
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
    const niraj = voiceCharacter("niraj")!;
    expect(availabilityOf(niraj, true)).toBe("unmapped");
    expect(availabilityLabel("unmapped")).toBe("Not connected yet");
  });

  it("unmapped English voice falls back explicitly to Adam (never silent)", () => {
    const res = resolveVoiceForSynthesis({
      characterId: "sawyer",
      categoryId: "crime_mystery",
      providerConfigured: true,
    });
    expect(res.ok).toBe(true);
    if (res.ok && res.viaFallback) {
      expect(res.character.id).toBe("adam");
      expect(res.reason).toMatch(/Sawyer.*isn't connected/i);
    } else {
      throw new Error("expected an explicit fallback");
    }
  });

  it("hard-fails with a clear reason when no same-language fallback exists", () => {
    const res = resolveVoiceForSynthesis({
      characterId: "niraj",
      providerConfigured: true,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/Niraj/i);
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
