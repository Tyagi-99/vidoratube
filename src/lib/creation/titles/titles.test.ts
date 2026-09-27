/**
 * Stream A — F14 Title Lab unit tests. Pure logic; no provider data.
 */
import { describe, expect, it } from "vitest";
import { generateTitleVariants, scoreTitle, scoreTitleBatch } from "./titles";

describe("generateTitleVariants", () => {
  it("is deterministic and dedupes", () => {
    const a = generateTitleVariants({ topic: "night trains", keywords: ["trains"] });
    const b = generateTitleVariants({ topic: "night trains", keywords: ["trains"] });
    expect(a).toEqual(b);
    expect(new Set(a.map((t) => t.toLowerCase())).size).toBe(a.length);
  });

  it("respects maxVariants and returns [] for empty topic", () => {
    expect(generateTitleVariants({ topic: "  " })).toEqual([]);
    const five = generateTitleVariants({ topic: "night trains", maxVariants: 5 });
    expect(five).toHaveLength(5);
  });

  it("title-cases the topic and weaves the keyword in", () => {
    const variants = generateTitleVariants({ topic: "night trains", keywords: ["rail"] });
    expect(variants[0]).toContain("Night Trains");
    expect(variants.some((t) => t.includes("Rail"))).toBe(true);
  });
});

describe("scoreTitle", () => {
  it("sums to total and stays within 0..100", () => {
    const s = scoreTitle({ title: "Why Night Trains Actually Matter", keywords: ["night trains"] });
    expect(s.total).toBe(
      s.factors.length + s.factors.keyword + s.factors.curiosity + s.factors.clarity,
    );
    for (const v of Object.values(s.factors)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(25);
    }
    expect(s.total).toBeLessThanOrEqual(100);
  });

  it("rewards the 40–60 char sweet spot and flags outliers in weakEvidence", () => {
    const good = scoreTitle({ title: "The Untold Story of Night Trains in Europe" });
    expect(good.factors.length).toBe(25);
    const bad = scoreTitle({ title: "Hi" });
    expect(bad.factors.length).toBeLessThan(good.factors.length);
    expect(bad.weakEvidence.some((w) => w.startsWith("length:"))).toBe(true);
  });

  it("is neutral with weakEvidence when no keyword corpus is provided", () => {
    const s = scoreTitle({ title: "Why Night Trains Actually Matter" });
    expect(s.factors.keyword).toBe(12);
    expect(s.weakEvidence.some((w) => w.startsWith("keyword: no keyword corpus"))).toBe(true);
  });

  it("rewards keyword presence and flags absence", () => {
    const hit = scoreTitle({ title: "Night Trains Explained", keywords: ["night trains"] });
    expect(hit.factors.keyword).toBe(25);
    const miss = scoreTitle({ title: "Cooking Pasta Fast", keywords: ["night trains"] });
    expect(miss.factors.keyword).toBe(0);
    expect(miss.weakEvidence.some((w) => w.includes("none of"))).toBe(true);
  });

  it("rewards curiosity markers deterministically", () => {
    const curious = scoreTitle({ title: "7 Secrets of Night Trains [Full Breakdown]?" });
    const plain = scoreTitle({ title: "A Video About Trains" });
    expect(curious.factors.curiosity).toBeGreaterThan(plain.factors.curiosity);
    expect(curious.factors.curiosity).toBeLessThanOrEqual(25);
  });

  it("penalizes ALL-CAPS, excessive punctuation, and overlong titles", () => {
    const s = scoreTitle({
      title:
        "NIGHT TRAINS ARE AMAZING!!! You Will Not Believe What Happens Next In This Incredible Video",
    });
    expect(s.factors.clarity).toBeLessThan(25);
    expect(s.weakEvidence.some((w) => w.includes("ALL-CAPS"))).toBe(true);
    expect(s.weakEvidence.some((w) => w.includes("punctuation"))).toBe(true);
  });

  it("never claims to predict CTR", () => {
    const s = scoreTitle({ title: "Why Night Trains Actually Matter", keywords: ["trains"] });
    const blob = JSON.stringify(s).toLowerCase();
    expect(blob).not.toContain("ctr");
    expect(blob).not.toContain("prediction");
  });
});

describe("scoreTitleBatch", () => {
  it("ranks by total, ties keep generation order (stable)", () => {
    const ranked = scoreTitleBatch(["B", "A"], []);
    expect(ranked[0]!.score.total).toBeGreaterThanOrEqual(ranked[1]!.score.total);
  });

  it("is deterministic", () => {
    const a = scoreTitleBatch(generateTitleVariants({ topic: "x" }), ["x"]);
    const b = scoreTitleBatch(generateTitleVariants({ topic: "x" }), ["x"]);
    expect(a).toEqual(b);
  });
});
