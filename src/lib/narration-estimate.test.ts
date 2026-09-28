import { describe, expect, it } from "vitest";
import { estimateNarrationSeconds, formatClock } from "./narration-estimate";

describe("estimateNarrationSeconds", () => {
  it("estimates ~150 wpm", () => {
    // 150 words → 60 seconds.
    expect(estimateNarrationSeconds(Array(150).fill("word").join(" "))).toBe(60);
    // 75 words → 30 seconds.
    expect(estimateNarrationSeconds(Array(75).fill("word").join(" "))).toBe(30);
  });

  it("never returns zero for non-empty text", () => {
    expect(estimateNarrationSeconds("hi")).toBe(1);
  });

  it("ignores extra whitespace", () => {
    expect(estimateNarrationSeconds("  one   two\nthree  ")).toBe(
      estimateNarrationSeconds("one two three"),
    );
  });
});

describe("formatClock", () => {
  it("formats sub-minute values with an s suffix", () => {
    expect(formatClock(45)).toBe("45s");
  });

  it("formats minute values as m:ss", () => {
    expect(formatClock(90)).toBe("1:30");
    expect(formatClock(600)).toBe("10:00");
  });
});
