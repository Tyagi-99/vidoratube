import { describe, expect, it } from "vitest";
import { VOICE_CATALOG, sortedVoices, voiceById } from "./voices";

describe("voice catalog", () => {
  it("has 25+ voices", () => {
    expect(VOICE_CATALOG.length).toBeGreaterThanOrEqual(25);
  });

  it("sorts Hindi first, then English", () => {
    const sorted = sortedVoices();
    const firstNonHi = sorted.findIndex((v) => v.languageCode !== "hi");
    const firstNonEn = sorted.findIndex(
      (v) => v.languageCode !== "hi" && v.languageCode !== "en"
    );
    // All Hindi come before any non-Hindi
    expect(firstNonHi).toBeGreaterThan(0);
    for (let i = 0; i < firstNonHi; i++) expect(sorted[i]!.languageCode).toBe("hi");
    // All English come before other languages
    for (let i = firstNonHi; i < firstNonEn; i++)
      expect(sorted[i]!.languageCode).toBe("en");
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
