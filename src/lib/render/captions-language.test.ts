import { describe, expect, it } from "vitest";
import { buildWordAss, spreadWords } from "./shared";
import type { CaptionLanguage } from "../languages";

/**
 * Sprint 3-4 test matrix: caption/ffmpeg-layer output per language.
 * Asserts on the generated ASS content (what ffmpeg burns in), not on full
 * video renders. Language behaviour comes from data (CaptionLanguage, as
 * read from the `languages` table) — never from hardcoded branches.
 */

const EN: CaptionLanguage = {
  code: "en",
  rtl: false,
  fontStack: "system-ui",
  captionMaxChars: 42,
};
const AR: CaptionLanguage = {
  code: "ar",
  rtl: true,
  fontStack: '"Noto Sans Arabic", system-ui',
  captionMaxChars: 42,
};
const JA: CaptionLanguage = {
  code: "ja",
  rtl: false,
  fontStack: '"Noto Sans JP", system-ui',
  captionMaxChars: 20,
};
const HI: CaptionLanguage = {
  code: "hi",
  rtl: false,
  fontStack: '"Noto Sans Devanagari", system-ui',
  captionMaxChars: 42,
};

function dialogueLines(ass: string): string[] {
  return ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
}

/** Visible caption text of a Dialogue line (karaoke tags stripped). */
function visibleText(line: string): string {
  const text = line.split(",,").pop() ?? "";
  return text.replace(/^\s*,/, "").replace(/\{\\kf\d+\}/g, "");
}

function styleLine(ass: string): string {
  return ass.split("\n").find((l) => l.startsWith("Style: Vidora")) ?? "";
}

describe("golden scripts (English)", () => {
  const scripts = [
    // hook
    "Stop scrolling. This abandoned town has been empty for sixty years, and nobody knows why everyone left in a single night.",
    // explainer
    "A black hole does not suck things in like a vacuum cleaner. It bends the road itself, so every path forward leads inside.",
    // sleep doc
    "In the winter of eighteen forty six, the snow came early to the Sierra Nevada, and the wagons slowed to a crawl beneath the pines.",
  ];
  for (const [i, script] of scripts.entries()) {
    it(`golden script ${i + 1} renders acceptable ASS captions`, () => {
      const cues = spreadWords(script, 0, 8);
      expect(cues.length).toBeGreaterThan(0);
      const ass = buildWordAss(cues, { language: EN });
      const dialogues = dialogueLines(ass);
      expect(dialogues.length).toBeGreaterThan(0);
      // karaoke timing present, timestamps ordered
      for (const d of dialogues) {
        expect(d).toMatch(/\{\\kf\d+\}/);
        expect(d).toMatch(/\d:\d\d:\d\d\.\d\d,\d:\d\d:\d\d\.\d\d/);
      }
      // no line exceeds the language's caption budget
      for (const d of dialogues) {
        expect([...visibleText(d)].length).toBeLessThanOrEqual(42);
      }
    });
  }
});

describe("English captions", () => {
  it("uses Inter for the generic system-ui stack and stays LTR", () => {
    const ass = buildWordAss(spreadWords("hello world", 0, 2), { language: EN });
    expect(styleLine(ass)).toContain("Style: Vidora,Inter,");
    expect(ass).not.toContain("Direction: RTL");
  });

  it("keeps legacy word-per-line behaviour when no language is given", () => {
    const cues = spreadWords("one two three four five six", 0, 6);
    const ass = buildWordAss(cues, { wordsPerLine: 4 });
    expect(dialogueLines(ass)).toHaveLength(2);
  });
});

describe("Arabic captions (RTL)", () => {
  const cues = [
    { word: "مرحبا", start: 0, end: 0.5 },
    { word: "بكم", start: 0.5, end: 1 },
    { word: "في", start: 1, end: 1.5 },
    { word: "فيدورا", start: 1.5, end: 2 },
  ];

  it("marks RTL direction in the ASS header", () => {
    const ass = buildWordAss(cues, { language: AR });
    expect(ass).toContain("; Direction: RTL");
  });

  it("applies the language font stack", () => {
    const ass = buildWordAss(cues, { language: AR });
    expect(styleLine(ass)).toContain("Noto Sans Arabic");
  });

  it("keeps words in logical (reading) order — libass does the bidi", () => {
    const ass = buildWordAss(cues, { language: AR });
    expect(ass.indexOf("مرحبا")).toBeLessThan(ass.indexOf("بكم"));
    expect(ass.indexOf("بكم")).toBeLessThan(ass.indexOf("فيدورا"));
  });
});

describe("Japanese captions (20-char lines)", () => {
  it("applies the Japanese font stack", () => {
    const ass = buildWordAss(
      [{ word: "こんにちは", start: 0, end: 1 }],
      { language: JA },
    );
    expect(styleLine(ass)).toContain("Noto Sans JP");
  });

  it("wraps spaceless CJK text at 20 characters per line", () => {
    // 60 chars, no whitespace — one long "word", like real TTS cues.
    const long = "こんにちは".repeat(12);
    expect([...long].length).toBe(60);
    const ass = buildWordAss([{ word: long, start: 0, end: 12 }], {
      language: JA,
    });
    const dialogues = dialogueLines(ass);
    expect(dialogues.length).toBe(3);
    for (const d of dialogues) {
      expect([...visibleText(d)].length).toBeLessThanOrEqual(20);
    }
  });
});

describe("Hindi captions (Indic script)", () => {
  it("applies the Devanagari font stack and wraps at 42 chars", () => {
    const script =
      "यह एक परीक्षण कैप्शन है जो लंबी पंक्तियों को सही ढंग से तोड़ता है ";
    const cues = spreadWords(script.repeat(2).trim(), 0, 10);
    const ass = buildWordAss(cues, { language: HI });
    expect(styleLine(ass)).toContain("Noto Sans Devanagari");
    const dialogues = dialogueLines(ass);
    expect(dialogues.length).toBeGreaterThan(1);
    for (const d of dialogues) {
      expect([...visibleText(d)].length).toBeLessThanOrEqual(42);
    }
  });
});
