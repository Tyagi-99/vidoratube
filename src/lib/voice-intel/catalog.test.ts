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

  it("maps all 40 characters to account-verified provider voices", () => {
    const mapped = VOICE_CHARACTERS.filter((c) => c.providerVoiceId);
    expect(mapped.map((c) => c.id).sort()).toEqual([
      "aakash", "adam", "agustin", "alberto-rodriguez", "antonio", "benjamin",
      "bunty", "carmelo", "christian", "darian", "david-martin", "devi",
      "el-faraon", "elara", "elli", "enrique-mondragon", "fernando-martinez", "finley",
      "florence", "helmut-stieglbauer", "jade", "kali-devi", "krishna-gupta", "lawrence",
      "leon-stern", "miguel", "mila", "monika-sogam", "niraj", "otto",
      "raju", "sara-martin", "sawyer", "sissi", "talia", "thorsten",
      "toby", "vikram", "vikrant", "warren",
    ]);
    expect(voiceCharacter("adam")?.providerVoiceId).toBe("pNInz6obpgDQGcFmaJgB");
    expect(voiceCharacter("elli")?.providerVoiceId).toBe("MF3mGyEYCl7XYWb3QV9V");
    expect(voiceCharacter("sawyer")?.providerVoiceId).toBe("IKne3meq5aSn9XLyUdCD");
    expect(voiceCharacter("darian")?.providerVoiceId).toBe("cjVigY5qzO86Huf0OWal");
    expect(voiceCharacter("finley")?.providerVoiceId).toBe("bIHbv24MWmeRgasZH58o");
    expect(voiceCharacter("jade")?.providerVoiceId).toBe("hpp4J3VqNfWAUOO0d1Us");
    expect(voiceCharacter("elara")?.providerVoiceId).toBe("pFZP5JQG7iQjIQuC4Bku");
    expect(voiceCharacter("talia")?.providerVoiceId).toBe("cgSgspJ2msm6clMCkdW9");
    expect(voiceCharacter("lawrence")?.providerVoiceId).toBe("pqHfZKP75CvOlQylNhV4");
    expect(voiceCharacter("warren")?.providerVoiceId).toBe("nPczCjzI2devNBz1zQrb");
    expect(voiceCharacter("florence")?.providerVoiceId).toBe("EXAVITQu4vr4xnSDxMaL");
    expect(voiceCharacter("niraj")?.providerVoiceId).toBe("k0gtD0Bbpi6hL40jfHfm");
    expect(voiceCharacter("raju")?.providerVoiceId).toBe("HH8sIQq8WOcER3Nu118i");
    expect(voiceCharacter("aakash")?.providerVoiceId).toBe("JlfM9BOUS7FcsHfTqsAy");
    expect(voiceCharacter("bunty")?.providerVoiceId).toBe("3OUAuH7CeDSQhCCijs1Y");
    expect(voiceCharacter("monika-sogam")?.providerVoiceId).toBe("OtEfb2LVzIE45wdYe54M");
    expect(voiceCharacter("kali-devi")?.providerVoiceId).toBe("Be3X8pg7kLN4vyyMC3QN");
    expect(voiceCharacter("krishna-gupta")?.providerVoiceId).toBe("T3s9anIvGvoeogXyFyMt");
    expect(voiceCharacter("devi")?.providerVoiceId).toBe("o6qTxWUeRyzRYZyUNDVJ");
    expect(voiceCharacter("vikram")?.providerVoiceId).toBe("F8IvasoAdpDhOjLm5YBm");
    expect(voiceCharacter("vikrant")?.providerVoiceId).toBe("Aano0MRpH01ekWzUtv60");
    expect(voiceCharacter("miguel")?.providerVoiceId).toBe("DdKbXdRlBmj7Ty7N0FVr");
    expect(voiceCharacter("alberto-rodriguez")?.providerVoiceId).toBe("hyKxCTlAqtnW188CgltM");
    expect(voiceCharacter("david-martin")?.providerVoiceId).toBe("uCQe5kObQIjtylU0HL3m");
    expect(voiceCharacter("carmelo")?.providerVoiceId).toBe("YqZLNYWZm98oKaaLZkUA");
    expect(voiceCharacter("fernando-martinez")?.providerVoiceId).toBe("MjtZn5tagxL1RO6w9ER5");
    expect(voiceCharacter("enrique-mondragon")?.providerVoiceId).toBe("Wl3O9lmFSMgGFTTwuS6f");
    expect(voiceCharacter("antonio")?.providerVoiceId).toBe("94zOad0g7T7K4oa7zhDq");
    expect(voiceCharacter("agustin")?.providerVoiceId).toBe("zR7eV8hMFnxhSSAcCYW0");
    expect(voiceCharacter("sara-martin")?.providerVoiceId).toBe("uDhfdG2VwEjWZ4JYzggn");
    expect(voiceCharacter("el-faraon")?.providerVoiceId).toBe("K3TeN3ZVK8WnOeJ0NYqZ");
    expect(voiceCharacter("leon-stern")?.providerVoiceId).toBe("re2r5d74PqDzicySNW0I");
    expect(voiceCharacter("helmut-stieglbauer")?.providerVoiceId).toBe("Fghah4fztZORbiKfIGAs");
    expect(voiceCharacter("christian")?.providerVoiceId).toBe("z1EhmmPwF0ENGYE8dBE6");
    expect(voiceCharacter("otto")?.providerVoiceId).toBe("FTNCalFNG5bRnkkaP5Ug");
    expect(voiceCharacter("mila")?.providerVoiceId).toBe("dCnu06FiOZma2KVNUoPZ");
    expect(voiceCharacter("benjamin")?.providerVoiceId).toBe("MbbPUteESkJWr4IAaW35");
    expect(voiceCharacter("toby")?.providerVoiceId).toBe("aTTiK3YzK3dXETpuDE2h");
    expect(voiceCharacter("sissi")?.providerVoiceId).toBe("7eVMgwCnXydb3CikjV7a");
    expect(voiceCharacter("thorsten")?.providerVoiceId).toBe("PnDjdkPdsPizyMoHbJma");
    for (const c of mapped) expect(c.status).toBe("mapped");
  });

  it("leaves no character unmapped: all 40 have a provider voice id", () => {
    const unmapped = VOICE_CHARACTERS.filter((c) => !c.providerVoiceId);
    expect(unmapped).toHaveLength(0);
  });

  it("never invents a provider voice id: every id is an account-verified id", () => {
    const known = new Set([
      "pNInz6obpgDQGcFmaJgB", "MF3mGyEYCl7XYWb3QV9V",
      "IKne3meq5aSn9XLyUdCD", "cjVigY5qzO86Huf0OWal", "bIHbv24MWmeRgasZH58o",
      "hpp4J3VqNfWAUOO0d1Us", "pFZP5JQG7iQjIQuC4Bku", "cgSgspJ2msm6clMCkdW9",
      "pNInz6obpgDQGcFmaJgB", "MF3mGyEYCl7XYWb3QV9V", "IKne3meq5aSn9XLyUdCD",
      "cjVigY5qzO86Huf0OWal", "bIHbv24MWmeRgasZH58o", "hpp4J3VqNfWAUOO0d1Us",
      "pFZP5JQG7iQjIQuC4Bku", "cgSgspJ2msm6clMCkdW9", "pqHfZKP75CvOlQylNhV4",
      "nPczCjzI2devNBz1zQrb", "EXAVITQu4vr4xnSDxMaL", "k0gtD0Bbpi6hL40jfHfm",
      "HH8sIQq8WOcER3Nu118i", "JlfM9BOUS7FcsHfTqsAy", "3OUAuH7CeDSQhCCijs1Y",
      "OtEfb2LVzIE45wdYe54M", "Be3X8pg7kLN4vyyMC3QN", "T3s9anIvGvoeogXyFyMt",
      "o6qTxWUeRyzRYZyUNDVJ", "F8IvasoAdpDhOjLm5YBm", "Aano0MRpH01ekWzUtv60",
      "DdKbXdRlBmj7Ty7N0FVr", "hyKxCTlAqtnW188CgltM", "uCQe5kObQIjtylU0HL3m",
      "YqZLNYWZm98oKaaLZkUA", "MjtZn5tagxL1RO6w9ER5", "Wl3O9lmFSMgGFTTwuS6f",
      "94zOad0g7T7K4oa7zhDq", "zR7eV8hMFnxhSSAcCYW0", "uDhfdG2VwEjWZ4JYzggn",
      "K3TeN3ZVK8WnOeJ0NYqZ", "re2r5d74PqDzicySNW0I", "Fghah4fztZORbiKfIGAs",
      "z1EhmmPwF0ENGYE8dBE6", "FTNCalFNG5bRnkkaP5Ug", "dCnu06FiOZma2KVNUoPZ",
      "MbbPUteESkJWr4IAaW35", "aTTiK3YzK3dXETpuDE2h", "7eVMgwCnXydb3CikjV7a",
      "PnDjdkPdsPizyMoHbJma",
    ]);
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

  it("seeds 6 voice models with per-model supported params", () => {
    expect(VOICE_MODELS).toHaveLength(6);
    const flash = VOICE_MODELS.find((m) => m.id === "eleven_flash_v2_5")!;
    expect(flash.supportedParams).toContain("speaker_boost");
    const openai = VOICE_MODELS.find((m) => m.id === "openai_tts_1")!;
    expect(openai.supportedParams).toEqual(["speed"]);
  });
});
