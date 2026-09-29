import { describe, expect, it } from "vitest";
import { resolveSynthesisPlan } from "./plan";
import { DEFAULT_VOICE_SETTINGS } from "./models";
import type { VoiceSelection } from "./types";

const base: VoiceSelection = {
  languageCode: "en",
  categoryId: "documentary",
  characterId: "adam",
  modelId: "auto",
  settings: { ...DEFAULT_VOICE_SETTINGS },
  customised: false,
};

describe("resolveSynthesisPlan", () => {
  it("resolves Adam to his provider voice id with an auto model", () => {
    const plan = resolveSynthesisPlan(base, 5000, true);
    expect(plan.voiceId).toBe("pNInz6obpgDQGcFmaJgB");
    expect(plan.viaFallback).toBe(false);
    expect(plan.modelId).toBe("eleven_multilingual_v2");
  });

  it("honours an explicit model choice", () => {
    const plan = resolveSynthesisPlan(
      { ...base, modelId: "eleven_flash_v2_5" },
      5000,
      true,
    );
    expect(plan.modelId).toBe("eleven_flash_v2_5");
  });

  it("auto model picks Flash for short-form", () => {
    const plan = resolveSynthesisPlan(
      { ...base, categoryId: "shorts_reels" },
      400,
      true,
    );
    expect(plan.modelId).toBe("eleven_flash_v2_5");
  });

  it("falls back to an unknown model id safely", () => {
    const plan = resolveSynthesisPlan(
      { ...base, modelId: "eleven_nonexistent_v9" },
      5000,
      true,
    );
    expect(plan.modelId).toBe("eleven_multilingual_v2");
  });

  it("mapped voice resolves to its own provider voice id with no fallback", () => {
    const plan = resolveSynthesisPlan(
      { ...base, characterId: "sawyer", categoryId: "crime_mystery" },
      5000,
      true,
    );
    expect(plan.viaFallback).toBe(false);
    expect(plan.characterId).toBe("sawyer");
    expect(plan.voiceId).toBe("IKne3meq5aSn9XLyUdCD");
  });

  it("no usable voice in the language yields null voiceId (legacy path)", () => {
    const plan = resolveSynthesisPlan({ ...base, languageCode: "hi", characterId: "niraj" }, 5000, true);
    expect(plan.voiceId).toBeNull();
    expect(plan.fallbackNote).toMatch(/Niraj/i);
  });

  it("clamps out-of-range settings defensively", () => {
    const plan = resolveSynthesisPlan(
      {
        ...base,
        settings: { stability: 5, similarityBoost: -1, style: 0.5, speed: 9, speakerBoost: true },
      },
      5000,
      true,
    );
    expect(plan.settings.stability).toBe(1);
    expect(plan.settings.similarityBoost).toBe(0);
    expect(plan.settings.speed).toBe(1.2);
  });
});
