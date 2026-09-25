import { describe, expect, it } from "vitest";
import { VOICE_CATALOG, sortedVoices, voiceById } from "./voices";

describe("voice catalog", () => {
  it("has at least 16 built-in voices: 12 English + 4 Hindi", () => {
    const builtin = VOICE_CATALOG.filter((v) => !v.library);
    expect(builtin.filter((v) => v.languageCode === "en").length).toBeGreaterThanOrEqual(12);
    expect(builtin.filter((v) => v.languageCode === "hi").length).toBeGreaterThanOrEqual(4);
  });

  it("sorts English first (language-neutral default)", () => {
    const sorted = sortedVoices();
    const firstNonEn = sorted.findIndex((v) => v.languageCode !== "en");
    // All English come before any non-English
    expect(firstNonEn).toBeGreaterThan(0);
    for (let i = 0; i < firstNonEn; i++) expect(sorted[i]!.languageCode).toBe("en");
  });

  it("built-in voices have concrete provider ids; library voices do not", () => {
    const builtin = VOICE_CATALOG.filter((v) => !v.library);
    const library = VOICE_CATALOG.filter((v) => v.library);
    expect(builtin.length).toBeGreaterThanOrEqual(10);
    for (const v of builtin) expect(v.providerVoiceId).toBeTruthy();
    for (const v of library) expect(v.providerVoiceId).toBeNull();
  });

  it("voiceById resolves known voices", () => {
    expect(voiceById("aisha")?.language).toBe("Hindi");
    expect(voiceById("george")?.provider).toBe("elevenlabs");
    expect(voiceById("nope")).toBeUndefined();
  });

  it("ids are unique", () => {
    const ids = VOICE_CATALOG.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
