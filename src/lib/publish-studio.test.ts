import { describe, it, expect } from "vitest";
import {
  validateTextOverlay,
  buildThumbnailPrompt,
  selectThumbnailVariant,
} from "./thumbnails";
import { scoreTitle, rankTitles, buildDescription, suggestTags } from "./seo";

describe("validateTextOverlay", () => {
  it("accepts a valid overlay", () => {
    expect(
      validateTextOverlay({
        headline: "I Tried It For 30 Days",
        font: "bold-sans",
        color: "#FFFFFF",
        position: "bottom",
        fontSize: "lg",
      }),
    ).toBeNull();
  });
  it("rejects missing headline", () => {
    expect(validateTextOverlay({ color: "#FFFFFF" })).toMatch(/headline/i);
  });
  it("rejects overlong headline", () => {
    expect(validateTextOverlay({ headline: "x".repeat(61) })).toMatch(/60/);
  });
  it("rejects bad color", () => {
    expect(validateTextOverlay({ headline: "Hi", color: "red" })).toMatch(/hex/i);
  });
  it("rejects unknown font", () => {
    expect(
      validateTextOverlay({ headline: "Hi", font: "comic-sans" as never }),
    ).toMatch(/font/i);
  });
});

describe("buildThumbnailPrompt", () => {
  it("includes dims, title, and no baked text", () => {
    const p = buildThumbnailPrompt({
      videoTitle: "Test",
      videoTopic: "finance",
      variant: 1,
      aspect: "16:9",
    });
    expect(p).toContain("1280x720");
    expect(p).toContain("no text baked");
  });
  it("varies composition by variant", () => {
    const a = buildThumbnailPrompt({ videoTitle: "T", videoTopic: "x", variant: 1, aspect: "16:9" });
    const b = buildThumbnailPrompt({ videoTitle: "T", videoTopic: "x", variant: 2, aspect: "16:9" });
    expect(a).not.toBe(b);
  });
  it("uses portrait dims for 9:16", () => {
    const p = buildThumbnailPrompt({ videoTitle: "T", videoTopic: "x", variant: 1, aspect: "9:16" });
    expect(p).toContain("720x1280");
  });
});

describe("selectThumbnailVariant", () => {
  it("prefers explicitly selected", () => {
    const vs = [
      { variant: 1, selected: false },
      { variant: 2, selected: true },
    ];
    expect(selectThumbnailVariant(vs)?.variant).toBe(2);
  });
  it("falls back to variant 1", () => {
    const vs = [
      { variant: 2, selected: false },
      { variant: 1, selected: false },
    ];
    expect(selectThumbnailVariant(vs)?.variant).toBe(1);
  });
  it("returns null for empty", () => {
    expect(selectThumbnailVariant([])).toBeNull();
  });
});

describe("scoreTitle", () => {
  it("rewards keyword early + ideal length", () => {
    const good = scoreTitle("How I Saved $10,000 in One Year on a Budget", "saved");
    expect(good.breakdown.keyword).toBe(100);
    expect(good.score).toBeGreaterThan(60);
  });
  it("penalizes clickbait", () => {
    const bad = scoreTitle("You won't believe this SHOCKING trick!!!", "trick");
    expect(bad.breakdown.curiosity).toBeLessThanOrEqual(20);
  });
  it("penalizes very long titles", () => {
    const long = scoreTitle("a".repeat(100), "a");
    expect(long.breakdown.length).toBeLessThan(50);
  });
  it("scores zero keyword when absent", () => {
    expect(scoreTitle("Random video here", "finance").breakdown.keyword).toBe(0);
  });
});

describe("rankTitles", () => {
  it("sorts best-first", () => {
    const ranked = rankTitles(
      ["x", "How to Budget Money in 2026: A Complete Guide"],
      "budget",
    );
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
  });
});

describe("buildDescription", () => {
  it("assembles hook, chapters, hashtags", () => {
    const d = buildDescription({
      hook: "Stop wasting money.",
      summary: "A full guide.",
      chapters: [{ time: "0:00", label: "Intro" }],
      hashtags: ["finance", "#money"],
    });
    expect(d).toContain("CHAPTERS:");
    expect(d).toContain("0:00 Intro");
    expect(d).toContain("#finance");
    expect(d).toContain("#money");
  });
  it("caps at 4900 chars", () => {
    const d = buildDescription({
      hook: "h",
      summary: "x".repeat(6000),
      chapters: [],
      hashtags: [],
    });
    expect(d.length).toBeLessThanOrEqual(4900);
  });
});

describe("suggestTags", () => {
  it("dedupes and respects char budget", () => {
    const tags = suggestTags(["Finance", "finance ", "money"], ["money", "investing"], 20);
    expect(tags).toEqual(["finance", "money"]);
    expect(tags.join(",").length).toBeLessThanOrEqual(20);
  });
});
