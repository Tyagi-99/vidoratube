/**
 * Phase 6 Stream E (P2+P3) — Title Lab format library + word vector tests.
 */
import { describe, expect, it } from "vitest";
import {
  applyTitleFormat,
  fillsForTopic,
  getTitleFormat,
  listTitleFormats,
  type TitleFormat,
} from "./formats";
import { generateTitleVariants } from "./titles";
import {
  buildVectorEnvelope,
  computeWordVectors,
  suggestPairings,
  tokenizeTitle,
} from "./vectors";

describe("title format library", () => {
  it("lists a pinned, non-empty library with unique ids", () => {
    const formats = listTitleFormats();
    expect(formats.length).toBeGreaterThanOrEqual(8);
    const ids = formats.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every format has slots, a lever, and a non-empty template", () => {
    for (const f of listTitleFormats()) {
      expect(f.slots.length).toBeGreaterThan(0);
      expect(f.template).toContain("[");
      expect(f.lever.length).toBeGreaterThan(0);
      expect(f.note.length).toBeGreaterThan(0);
    }
  });

  it("makes no performance multiples — nothing in the library claims virality", () => {
    const blob = JSON.stringify(listTitleFormats());
    expect(blob).not.toMatch(/\d+\.\d+x median/i);
    expect(blob).not.toMatch(/CTR/i);
    expect(blob).not.toMatch(/viral/i);
  });

  it("getTitleFormat returns null for unknown ids", () => {
    expect(getTitleFormat("nope")).toBeNull();
    expect(getTitleFormat("how-to-without")?.lever).toBe("Utility Promise");
  });

  it("applyTitleFormat fills slots deterministically and leaves unfilled ones", () => {
    const f = getTitleFormat("is-worth-it") as TitleFormat;
    expect(applyTitleFormat(f, { thing: "automation", year: "2026" })).toBe(
      "Is automation Worth It in 2026?",
    );
    const partial = applyTitleFormat(f, { thing: "automation" });
    expect(partial).toContain("[year]");
  });

  it("fillsForTopic produces topic and distinct-keyword fills", () => {
    const f = getTitleFormat("truth-about") as TitleFormat;
    const fills = fillsForTopic(f, "night trains", "europe");
    expect(fills.length).toBe(2);
    expect(fills[0]?.values["thing"]).toBe("night trains");
    expect(fills[1]?.values["thing"]).toBe("europe");
  });

  it("fillsForTopic dedupes identical topic/keyword", () => {
    const f = getTitleFormat("truth-about") as TitleFormat;
    expect(fillsForTopic(f, "night trains", "Night Trains").length).toBe(1);
  });
});

describe("generateTitleVariants with formatId", () => {
  it("generates from the format instead of generic templates", () => {
    const variants = generateTitleVariants({
      topic: "night trains",
      keywords: ["europe"],
      formatId: "truth-about",
    });
    expect(variants).toContain("The Truth About Night Trains");
    expect(variants).toContain("The Truth About Europe");
    expect(variants.length).toBe(2);
  });

  it("returns [] for an unknown format id (no crash)", () => {
    expect(
      generateTitleVariants({ topic: "night trains", formatId: "does-not-exist" }),
    ).toEqual([]);
  });

  it("is deterministic across calls", () => {
    const a = generateTitleVariants({ topic: "sleep", formatId: "what-happens" });
    const b = generateTitleVariants({ topic: "sleep", formatId: "what-happens" });
    expect(a).toEqual(b);
    expect(a).toEqual(["What Happens When You Sleep"]);
  });

  it("generic template path still works when no formatId", () => {
    const variants = generateTitleVariants({ topic: "night trains" });
    expect(variants.length).toBe(10);
    expect(variants[0]).toBe("Night Trains: What Nobody Tells You");
  });
});

describe("tokenizeTitle", () => {
  it("lowercases, strips punctuation, drops stopwords and short tokens", () => {
    expect(tokenizeTitle("How to Fix Your Retention in 2026!")).toEqual([
      "fix",
      "retention",
      "2026",
    ]);
  });

  it("dedupes tokens within a title", () => {
    expect(tokenizeTitle("Truth Truth Truth About Truth")).toEqual(["truth"]);
  });
});

describe("computeWordVectors", () => {
  const corpus = [
    { title: "The untold truth about night trains", outlierScore: 4.0 },
    { title: "Truth about europe sleeper trains", outlierScore: 3.0 },
    { title: "The hidden truth of luxury trains", outlierScore: 5.0 },
    { title: "Night trains are back", outlierScore: 1.2 },
    { title: "Cooking pasta at home", outlierScore: 1.1 },
    { title: "Pasta recipes for beginners", outlierScore: 1.3 },
  ];

  it("scores words on ≥3 videos and computes lift vs corpus median", () => {
    const vectors = computeWordVectors(corpus);
    const truth = vectors.find((v) => v.word === "truth");
    expect(truth).toBeDefined();
    expect(truth?.videos).toBe(3);
    expect(truth?.medianOutlier).toBe(4);
    // corpus median = (1.3+3.0)/2 = 2.15 → lift ≈ 1.86
    expect(truth?.lift).toBeCloseTo(4 / 2.15, 2);
  });

  it("excludes words seen in fewer than 3 videos", () => {
    const vectors = computeWordVectors(corpus);
    expect(vectors.some((v) => v.word === "pasta")).toBe(false);
    expect(vectors.some((v) => v.word === "cooking")).toBe(false);
  });

  it("sorts by lift desc", () => {
    const vectors = computeWordVectors(corpus);
    for (let i = 1; i < vectors.length; i++) {
      expect(vectors[i - 1]!.lift).toBeGreaterThanOrEqual(vectors[i]!.lift);
    }
  });
});

describe("suggestPairings", () => {
  it("returns co-occurring pairs with median outlier", () => {
    const videos = [
      { title: "untold truth night trains", outlierScore: 4.0 },
      { title: "untold truth sleeper trains", outlierScore: 3.0 },
      { title: "cooking pasta", outlierScore: 1.1 },
    ];
    const pairs = suggestPairings(videos);
    const tt = pairs.find((p) => p.wordA === "trains" && p.wordB === "truth");
    expect(tt).toBeDefined();
    expect(tt?.videos).toBe(2);
    expect(tt?.medianOutlier).toBe(3.5);
  });
});

describe("buildVectorEnvelope", () => {
  it("returns insufficient_data below 10 videos", () => {
    const env = buildVectorEnvelope([{ title: "a b c", outlierScore: 2 }]);
    expect(env.status).toBe("insufficient_data");
    if (env.status === "insufficient_data") {
      expect(env.reason).toContain("at least 10");
      expect(env.videoCount).toBe(1);
    }
  });

  it("returns ok with vectors and pairings on a sufficient corpus", () => {
    const videos = Array.from({ length: 12 }, (_, i) => ({
      title: `untold truth about night trains episode ${i}`,
      outlierScore: 2 + (i % 3),
    }));
    const env = buildVectorEnvelope(videos);
    expect(env.status).toBe("ok");
    if (env.status === "ok") {
      expect(env.videoCount).toBe(12);
      expect(env.vectors.length).toBeGreaterThan(0);
    }
  });
});
