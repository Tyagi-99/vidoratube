import { describe, expect, it } from "vitest";
import {
  resolveDubLanguage,
  selectDubVoice,
  betaLabel,
  planDubRender,
  quoteDubbing,
  DubError,
  type LanguageRow,
} from "./dubbing";
import { VOICE_CATALOG } from "../voices";

/** Test double for the 12 `languages` rows (mirrors the real seed). */
const LANGUAGES: LanguageRow[] = [
  {
    code: "en",
    nameEn: "English",
    nameNative: "English",
    status: "live",
    captionMaxChars: 42,
    rtl: false,
    fontStack: "system-ui",
  },
  {
    code: "hi",
    nameEn: "Hindi",
    nameNative: "हिन्दी",
    status: "beta",
    captionMaxChars: 42,
    rtl: false,
    fontStack: '"Noto Sans Devanagari", system-ui',
  },
  {
    code: "zh",
    nameEn: "Mandarin Chinese",
    nameNative: "中文",
    status: "beta",
    captionMaxChars: 20,
    rtl: false,
    fontStack: '"Noto Sans SC", system-ui',
  },
  {
    code: "ar",
    nameEn: "Modern Standard Arabic",
    nameNative: "العربية",
    status: "beta",
    captionMaxChars: 42,
    rtl: true,
    fontStack: '"Noto Sans Arabic", system-ui',
  },
];

const SOURCE = {
  id: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  durationSeconds: 300,
  aspectRatio: "16:9",
  resolution: "1920x1080",
  captionCueCount: 120,
};

describe("resolveDubLanguage", () => {
  it("resolves a known code from the languages table", () => {
    const row = resolveDubLanguage("hi", LANGUAGES);
    expect(row.code).toBe("hi");
    expect(row.status).toBe("beta");
  });

  it("throws an explicit error for unknown codes — never a silent fallback", () => {
    try {
      resolveDubLanguage("xx", LANGUAGES);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DubError);
      expect((e as DubError).code).toBe("unknown-language");
    }
  });

  it("refuses planned languages", () => {
    const planned = LANGUAGES.map((l) =>
      l.code === "ar" ? { ...l, status: "planned" as const } : l,
    );
    expect(() => resolveDubLanguage("ar", planned)).toThrowError(/not available for dubbing/);
  });
});

describe("betaLabel", () => {
  it("labels beta languages Beta", () => {
    expect(betaLabel("beta")).toBe("Beta");
  });

  it("shows no label for English (live)", () => {
    expect(betaLabel("live")).toBe("");
  });
});

describe("selectDubVoice", () => {
  it("selects a verified voice for a verified language (en)", () => {
    const voice = selectDubVoice("en", { catalog: VOICE_CATALOG });
    expect(voice.verified).toBe(true);
    expect(voice.stub).toBe(false);
    expect(voice.providerVoiceId.length).toBeGreaterThan(0);
  });

  it("selects a verified Hindi voice for hi", () => {
    const voice = selectDubVoice("hi", { catalog: VOICE_CATALOG });
    expect(voice.verified).toBe(true);
    expect(voice.stub).toBe(false);
  });

  it("throws an explicit no-verified-voice error instead of silent substitution", () => {
    // 'es' has no verified voice in the catalog: the call must fail, not
    // quietly pick an English or Hindi voice.
    try {
      selectDubVoice("es", { catalog: VOICE_CATALOG });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DubError);
      expect((e as DubError).code).toBe("no-verified-voice");
      expect((e as Error).message).toContain('"es"');
    }
    const catalogIds = VOICE_CATALOG.filter((v) => v.languageCode === "es" && v.verified === true);
    expect(catalogIds).toEqual([]);
  });

  it("falls back to verified language_voices slots when the catalog lags", () => {
    const voice = selectDubVoice("es", {
      catalog: [],
      voiceSlots: [
        {
          languageCode: "es",
          name: "Sofia",
          provider: "elevenlabs",
          providerVoiceId: "EXAVITQu4vr4xnSDxMaL",
          verified: true,
          selectable: true,
        },
      ],
    });
    expect(voice.verified).toBe(true);
    expect(voice.providerVoiceId).toBe("EXAVITQu4vr4xnSDxMaL");
  });

  it("returns a clearly-labeled stub only when explicitly opted in", () => {
    const stub = selectDubVoice("es", {
      catalog: VOICE_CATALOG,
      allowStub: true,
    });
    expect(stub.stub).toBe(true);
    expect(stub.verified).toBe(false);
    expect(stub.name).toMatch(/pending verification/i);
    // The default path is still the explicit error.
    expect(() => selectDubVoice("es", { catalog: VOICE_CATALOG })).toThrowError(DubError);
  });
});

describe("planDubRender", () => {
  it("links the new render to the source via parent_id", () => {
    const plan = planDubRender(SOURCE, "hi", LANGUAGES);
    expect(plan.renderInsert.parent_id).toBe(SOURCE.id);
    expect(plan.renderInsert.meta["dub_of"]).toBe(SOURCE.id);
    expect(plan.renderInsert.meta["kind"]).toBe("dub");
  });

  it("marks beta languages for the UI and keeps music/SFX untouched", () => {
    const plan = planDubRender(SOURCE, "hi", LANGUAGES);
    expect(plan.isBeta).toBe(true);
    expect(plan.renderInsert.meta["beta"]).toBe(true);
    expect(plan.renderInsert.meta["stems"]).toEqual({
      narration: "replace",
      music: "keep",
      sfx: "keep",
    });
  });

  it("marks English dubs as not-beta", () => {
    const plan = planDubRender(SOURCE, "en", LANGUAGES);
    expect(plan.isBeta).toBe(false);
    expect(plan.renderInsert.meta["beta"]).toBe(false);
  });

  it("carries the language caption_max_chars for re-wrapping", () => {
    const plan = planDubRender(SOURCE, "zh", LANGUAGES, { allowStub: true });
    expect(plan.renderInsert.meta["caption_max_chars"]).toBe(20);
    expect(plan.renderInsert.meta["rtl"]).toBe(false);
  });

  it("carries the verified voice id, never a stub, by default", () => {
    const plan = planDubRender(SOURCE, "en", LANGUAGES);
    expect(plan.voice.stub).toBe(false);
    expect(plan.voice.verified).toBe(true);
  });
});

describe("quoteDubbing", () => {
  it("charges 0.5 credits per finished minute per language", () => {
    // 5 finished minutes x 2 languages x 0.5 = 5 credits
    const q = quoteDubbing(300, 2);
    expect(q.minutes).toBe(5);
    expect(q.credits).toBe(5);
  });

  it("rounds a partial minute up to a full finished minute", () => {
    // 61s -> 2 finished minutes -> 1 credit for one language
    expect(quoteDubbing(61, 1).credits).toBe(1);
  });

  it("quotes zero languages as zero credits", () => {
    expect(quoteDubbing(300, 0).credits).toBe(0);
  });
});
