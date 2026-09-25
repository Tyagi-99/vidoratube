import { describe, expect, it } from "vitest";
import {
  gatePassed,
  primaryFontName,
  userSelectableVoices,
  LANGUAGE_QUALITY_GATES,
} from "./languages";
import { VOICE_CATALOG } from "./voices";

describe("primaryFontName", () => {
  it("takes the first family from a CSS stack", () => {
    expect(primaryFontName('"Noto Sans JP", system-ui')).toBe("Noto Sans JP");
    expect(primaryFontName("'Noto Sans Arabic', system-ui")).toBe(
      "Noto Sans Arabic",
    );
    expect(primaryFontName("Inter, sans-serif")).toBe("Inter");
  });

  it("falls back to Inter for generic families (ASS needs a real font)", () => {
    expect(primaryFontName("system-ui")).toBe("Inter");
    expect(primaryFontName("sans-serif")).toBe("Inter");
    expect(primaryFontName("")).toBe("Inter");
  });
});

describe("userSelectableVoices", () => {
  it("keeps every current catalog voice (none are BETA placeholders)", () => {
    expect(userSelectableVoices()).toHaveLength(VOICE_CATALOG.length);
  });

  it("drops voices explicitly marked non-selectable", () => {
    const voices = [
      ...VOICE_CATALOG.slice(0, 2),
      {
        id: "beta-x-1",
        name: "Beta X 1",
        language: "X",
        languageCode: "xx",
        gender: "feminine" as const,
        provider: "elevenlabs" as const,
        providerVoiceId: null,
        selectable: false,
        description: "BETA placeholder",
      },
    ];
    const shown = userSelectableVoices(voices);
    expect(shown).toHaveLength(2);
    expect(shown.every((v) => v.selectable !== false)).toBe(true);
  });
});

describe("LANGUAGE_QUALITY_GATES (CI mirror of language_quality_gates)", () => {
  it("covers all 12 launch languages", () => {
    const codes = LANGUAGE_QUALITY_GATES.map((g) => g.code).sort();
    expect(codes).toEqual(
      ["ar", "bn", "de", "en", "es", "fr", "hi", "id", "ja", "pt", "ur", "zh"].sort(),
    );
  });

  it("passes the gate only for languages with all three checks + evidence", () => {
    const en = LANGUAGE_QUALITY_GATES.find((g) => g.code === "en")!;
    expect(en.status).toBe("live");
    expect(gatePassed(en)).toBe(true);
    for (const g of LANGUAGE_QUALITY_GATES.filter((x) => x.code !== "en")) {
      expect(g.status).toBe("beta");
      expect(gatePassed(g)).toBe(false);
    }
  });

  it("records non-empty honest evidence on every check", () => {
    for (const g of LANGUAGE_QUALITY_GATES) {
      for (const check of [g.goldenScripts, g.backTranslation, g.nativeReview]) {
        expect(check.evidence.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
