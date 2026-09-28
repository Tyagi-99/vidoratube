import { describe, expect, it } from "vitest";
import {
  ACTIVE_VOICE_LANGUAGES,
  VOICE_CATEGORIES,
  VOICE_CHARACTERS,
  VOICE_LANGUAGES,
  VOICE_MODELS,
  charactersForLanguage,
  defaultCharacterForLanguage,
  voiceCharacter,
  voiceLanguage,
} from "./catalog";

describe("voice catalog integrity", () => {
  it("has 4 active languages (en/hi/es/de) and 8 planned", () => {
    expect(ACTIVE_VOICE_LANGUAGES.map((l) => l.code)).toEqual(["en", "hi", "es", "de"]);
    expect(VOICE_LANGUAGES.filter((l) => l.status === "planned")).toHaveLength(8);
  });

  it("has exactly 10 characters per active language (40 total)", () => {
    for (const code of ["en", "hi", "es", "de"]) {
      expect(charactersForLanguage(code)).toHaveLength(10);
    }
    expect(VOICE_CHARACTERS).toHaveLength(40);
  });

  it("has exactly one default character per active language", () => {
    expect(defaultCharacterForLanguage("en")?.id).toBe("adam");
    expect(defaultCharacterForLanguage("hi")?.id).toBe("niraj");
    expect(defaultCharacterForLanguage("es")?.id).toBe("miguel");
    expect(defaultCharacterForLanguage("de")?.id).toBe("leon-stern");
  });

  it("every active language has a non-empty preview sample", () => {
    for (const lang of ACTIVE_VOICE_LANGUAGES) {
      expect(lang.previewSample.length).toBeGreaterThan(10);
    }
  });

  it("has 17 voice categories", () => {
    expect(VOICE_CATEGORIES).toHaveLength(17);
  });

  it("only Adam and Elli carry provider voice ids from the codebase", () => {
    const mapped = VOICE_CHARACTERS.filter((c) => c.providerVoiceId);
    expect(mapped.map((c) => c.id).sort()).toEqual(["adam", "elli"]);
    expect(voiceCharacter("adam")?.providerVoiceId).toBe("pNInz6obpgDQGcFmaJgB");
    expect(voiceCharacter("elli")?.providerVoiceId).toBe("MF3mGyEYCl7XYWb3QV9V");
    for (const c of mapped) expect(c.status).toBe("mapped");
  });

  it("marks the other 38 characters unmapped with null provider voice id", () => {
    const unmapped = VOICE_CHARACTERS.filter((c) => !c.providerVoiceId);
    expect(unmapped).toHaveLength(38);
    for (const c of unmapped) expect(c.status).toBe("unmapped");
  });

  it("never invents a provider voice id: every id is a known codebase id", () => {
    const known = new Set(["pNInz6obpgDQGcFmaJgB", "MF3mGyEYCl7XYWb3QV9V"]);
    for (const c of VOICE_CHARACTERS) {
      if (c.providerVoiceId) expect(known.has(c.providerVoiceId)).toBe(true);
    }
  });

  it("character ids are unique and scores are within 0..10", () => {
    const ids = VOICE_CHARACTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of VOICE_CHARACTERS) {
      expect(c.score).toBeGreaterThan(0);
      expect(c.score).toBeLessThanOrEqual(10);
      expect(c.categoryTags.length).toBeGreaterThan(0);
    }
  });

  it("voiceLanguage resolves codes", () => {
    expect(voiceLanguage("hi")?.name).toBe("Hindi");
    expect(voiceLanguage("xx")).toBeUndefined();
  });

  it("seeds 5 voice models with per-model supported params", () => {
    expect(VOICE_MODELS).toHaveLength(5);
    const flash = VOICE_MODELS.find((m) => m.id === "eleven_flash_v2_5")!;
    expect(flash.supportedParams).toContain("speaker_boost");
    const openai = VOICE_MODELS.find((m) => m.id === "openai_tts_1")!;
    expect(openai.supportedParams).toEqual(["speed"]);
  });
});
