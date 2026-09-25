import { describe, expect, it } from "vitest";
import {
  ASPECT_DIMENSIONS,
  buildWordAss,
  coverFilter,
  dimensionsFor,
  parseAspect,
  spreadWords,
  timelineDuration,
} from "./shared";

describe("aspect geometry", () => {
  it("parses known aspects, defaults to 16:9", () => {
    expect(parseAspect("16:9")).toBe("16:9");
    expect(parseAspect("9:16")).toBe("9:16");
    expect(parseAspect("1:1")).toBe("1:1");
    expect(parseAspect("bogus")).toBe("16:9");
    expect(parseAspect("")).toBe("16:9");
  });

  it("returns correct dimensions", () => {
    expect(dimensionsFor("16:9")).toEqual({ width: 1920, height: 1080 });
    expect(dimensionsFor("9:16")).toEqual({ width: 1080, height: 1920 });
    expect(dimensionsFor("1:1")).toEqual({ width: 1080, height: 1080 });
    expect(ASPECT_DIMENSIONS["16:9"]).toEqual({ width: 1920, height: 1080 });
  });

  it("cover filter fills the target frame", () => {
    const f16x9 = coverFilter("16:9");
    expect(f16x9).toContain("scale=1920:1080");
    expect(f16x9).toContain("crop=1920:1080");
    const f9x16 = coverFilter("9:16");
    expect(f9x16).toContain("scale=1080:1920");
    expect(f9x16).toContain("crop=1080:1920");
  });
});

describe("word ASS captions", () => {
  it("builds karaoke dialogue lines", () => {
    const ass = buildWordAss(
      [
        { word: "hello", start: 0, end: 0.5 },
        { word: "world", start: 0.5, end: 1.0 },
      ],
      { wordsPerLine: 4 },
    );
    expect(ass).toContain("[Script Info]");
    expect(ass).toContain("[V4+ Styles]");
    expect(ass).toContain("[Events]");
    expect(ass).toContain("Dialogue:");
    // karaoke tags present with centisecond durations
    expect(ass).toContain("{\\kf50}hello");
    expect(ass).toContain("{\\kf50}world");
    // timestamps in h:mm:ss.cc
    expect(ass).toMatch(/0:00:00\.00,0:00:01\.00/);
  });

  it("groups words into lines", () => {
    const cues = Array.from({ length: 10 }, (_, i) => ({
      word: `w${i}`,
      start: i,
      end: i + 0.9,
    }));
    const ass = buildWordAss(cues, { wordsPerLine: 4 });
    const dialogues = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(dialogues).toHaveLength(3); // 4 + 4 + 2
  });

  it("escapes ASS override blocks", () => {
    const ass = buildWordAss([{ word: "{hi}", start: 0, end: 1 }]);
    expect(ass).not.toContain("{hi}");
    expect(ass).toContain("(hi)");
  });

  it("handles empty cues", () => {
    const ass = buildWordAss([]);
    expect(ass).toContain("[Events]");
    expect(ass.split("\n").filter((l) => l.startsWith("Dialogue:"))).toHaveLength(0);
  });
});

describe("spreadWords", () => {
  it("spreads words evenly across duration", () => {
    const cues = spreadWords("one two three", 10, 3);
    expect(cues).toHaveLength(3);
    expect(cues[0]).toEqual({ word: "one", start: 10, end: 11 });
    expect(cues[2]).toEqual({ word: "three", start: 12, end: 13 });
  });

  it("returns empty for blank text or zero duration", () => {
    expect(spreadWords("", 0, 5)).toEqual([]);
    expect(spreadWords("hi", 0, 0)).toEqual([]);
  });
});

describe("timelineDuration", () => {
  it("sums scene durations", () => {
    expect(
      timelineDuration([
        { id: "a", number: 1, narration: "", image: null, audio: null, duration: 5, cues: [] },
        { id: "b", number: 2, narration: "", image: null, audio: null, duration: 7.5, cues: [] },
      ]),
    ).toBe(12.5);
  });

  it("clamps negative durations", () => {
    expect(
      timelineDuration([
        { id: "a", number: 1, narration: "", image: null, audio: null, duration: -3, cues: [] },
      ]),
    ).toBe(0);
  });
});
