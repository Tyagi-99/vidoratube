import { describe, expect, it } from "vitest";
import {
  estimateParagraphSeconds,
  isSectionHeading,
  splitIntoParagraphs,
  splitScriptIntoChapters,
  MAX_CHAPTERS,
  MIN_CHAPTERS,
} from "./split";
import { buildContinuityBrief } from "./brief";

function makeScript(paragraphs: number, wordsPerParagraph = 150): string {
  // 150 words ≈ 60s at 150 wpm.
  return Array.from({ length: paragraphs }, (_, i) => {
    const words = Array.from({ length: wordsPerParagraph }, () => `word${i}`).join(" ");
    return `Paragraph ${i + 1}. ${words}`;
  }).join("\n\n");
}

describe("splitIntoParagraphs", () => {
  it("splits on blank lines and trims", () => {
    expect(splitIntoParagraphs("a\n\n\nb\n  \n c ")).toEqual(["a", "b", "c"]);
  });

  it("never returns empty for non-empty input", () => {
    expect(splitIntoParagraphs("hello")).toEqual(["hello"]);
    expect(splitIntoParagraphs("   ")).toEqual([]);
  });

  it("handles non-Latin scripts as opaque text", () => {
    const paras = splitIntoParagraphs("नमस्ते दुनिया\n\nمرحبا بالعالم");
    expect(paras).toEqual(["नमस्ते दुनिया", "مرحبا بالعالم"]);
  });
});

describe("isSectionHeading", () => {
  it("recognizes markdown headings", () => {
    expect(isSectionHeading("## The Gold Rush")).toBe(true);
    expect(isSectionHeading("# Intro")).toBe(true);
    expect(isSectionHeading("Just a paragraph")).toBe(false);
    expect(isSectionHeading("##nope")).toBe(false);
  });
});

describe("splitScriptIntoChapters", () => {
  it("splits a 20-minute script into 4-8 chapters", () => {
    // 20 paragraphs x 150 words ≈ 20 minutes.
    const chapters = splitScriptIntoChapters(makeScript(20));
    expect(chapters.length).toBeGreaterThanOrEqual(MIN_CHAPTERS);
    expect(chapters.length).toBeLessThanOrEqual(MAX_CHAPTERS);
    // 20 min / 3 min target ≈ 7 chapters.
    expect(chapters.length).toBe(7);
  });

  it("is deterministic: same script, same chapters", () => {
    const script = makeScript(12);
    const a = splitScriptIntoChapters(script);
    const b = splitScriptIntoChapters(script);
    expect(a).toEqual(b);
  });

  it("keeps chapters roughly equal in duration", () => {
    const chapters = splitScriptIntoChapters(makeScript(20));
    const secs = chapters.map((c) => c.estimatedSeconds);
    const avg = secs.reduce((x, y) => x + y, 0) / secs.length;
    for (const s of secs) {
      expect(Math.abs(s - avg) / avg).toBeLessThan(0.35);
    }
  });

  it("clamps very long scripts to 8 chapters", () => {
    const chapters = splitScriptIntoChapters(makeScript(60));
    expect(chapters.length).toBe(MAX_CHAPTERS);
  });

  it("always yields at least 4 chapters, even for short scripts", () => {
    const chapters = splitScriptIntoChapters(makeScript(4, 30));
    expect(chapters.length).toBeGreaterThanOrEqual(MIN_CHAPTERS);
  });

  it("uses ## headings as chapter boundaries and titles", () => {
    const script = [
      "## The Beginning",
      "Once upon a time there was a river town.",
      "",
      "## The Middle",
      "The town grew into a city of lights.",
      "",
      "## The End",
      "And the river kept flowing past it all.",
    ].join("\n");
    const chapters = splitScriptIntoChapters(script, { targetChapterSeconds: 1 });
    expect(chapters.length).toBeGreaterThanOrEqual(3);
    expect(chapters[0]!.title).toBe("The Beginning");
    expect(chapters[1]!.title).toBe("The Middle");
    expect(chapters[2]!.title).toBe("The End");
  });

  it("merges excess headings down to the 8-chapter cap", () => {
    const script = Array.from({ length: 12 }, (_, i) =>
      `## Part ${i + 1}\n\nSome narration text for part ${i + 1} goes here.`,
    ).join("\n\n");
    const chapters = splitScriptIntoChapters(script, { targetChapterSeconds: 10_000 });
    expect(chapters.length).toBeLessThanOrEqual(MAX_CHAPTERS);
  });

  it("works for non-English scripts without language-specific logic", () => {
    const para = (n: number) => `यह पैराग्राफ संख्या ${n} है जिसमें कुछ शब्द हैं `.repeat(20);
    const script = Array.from({ length: 10 }, (_, i) => para(i)).join("\n\n");
    const chapters = splitScriptIntoChapters(script);
    expect(chapters.length).toBeGreaterThanOrEqual(MIN_CHAPTERS);
    expect(chapters.length).toBeLessThanOrEqual(MAX_CHAPTERS);
    // Every paragraph is accounted for exactly once.
    expect(chapters.flatMap((c) => c.paragraphs).length).toBe(10);
  });

  it("indexes chapters from 1 and joins script text with blank lines", () => {
    const chapters = splitScriptIntoChapters(makeScript(6, 100));
    chapters.forEach((c, i) => expect(c.index).toBe(i + 1));
    for (const c of chapters) {
      expect(c.scriptText).toBe(c.paragraphs.join("\n\n"));
    }
  });
});

describe("estimateParagraphSeconds", () => {
  it("estimates 150 words as ~60 seconds", () => {
    const p = Array.from({ length: 150 }, () => "word").join(" ");
    expect(estimateParagraphSeconds(p)).toBeCloseTo(60, 0);
  });
});

describe("buildContinuityBrief", () => {
  it("is deterministic for identical inputs", () => {
    const input = { voiceId: "v1", languageCode: "en" };
    expect(buildContinuityBrief(input)).toEqual(buildContinuityBrief(input));
  });

  it("differs when voice or language differ", () => {
    const base = { voiceId: "v1", languageCode: "en" };
    expect(buildContinuityBrief({ ...base, voiceId: "v2" })).not.toEqual(
      buildContinuityBrief(base),
    );
  });

  it("accepts any BCP-47 tag without branching on it", () => {
    for (const tag of ["en", "hi", "es", "ar", "zh"]) {
      const b = buildContinuityBrief({ voiceId: "v1", languageCode: tag });
      expect(b.voice.languageCode).toBe(tag);
      expect(b.version).toBe(1);
    }
  });
});
