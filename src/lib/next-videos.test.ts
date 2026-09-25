import { describe, expect, it } from "vitest";
import {
  recommendNextVideos,
  scoreCandidate,
  type CandidateIdea,
  type SourceVideo,
} from "./next-videos";

const SOURCE: SourceVideo = {
  title: "The Lost City of Gold: El Dorado",
  topic: "lost cities and hidden treasure expeditions",
  hook: "Nobody has ever found the lost city of gold",
  views: 50000,
  ctr: 6.2,
  retentionPct: 48,
};

function idea(partial: Partial<CandidateIdea> & { id: string; title: string }): CandidateIdea {
  return {
    hook: "",
    angle: "",
    format: "long",
    difficulty: "medium",
    safetyFlag: "safe",
    status: "new",
    ...partial,
  };
}

describe("scoreCandidate", () => {
  it("excludes dismissed and used ideas", () => {
    expect(
      scoreCandidate(SOURCE, idea({ id: "a", title: "El Dorado part 2", status: "dismissed" })),
    ).toBeNull();
    expect(
      scoreCandidate(SOURCE, idea({ id: "b", title: "El Dorado part 2", status: "used" })),
    ).toBeNull();
  });

  it("rewards topic overlap with explainable reasons", () => {
    const r = scoreCandidate(
      SOURCE,
      idea({
        id: "a",
        title: "The Lost Treasure of the Amazon Expedition",
        angle: "following a modern expedition hunting hidden treasure",
      }),
    );
    expect(r).not.toBeNull();
    expect(r!.score).toBeGreaterThan(0);
    expect(r!.reasons.some((x) => x.includes("topic keyword"))).toBe(true);
  });

  it("rewards hook-pattern reuse", () => {
    const r = scoreCandidate(
      SOURCE,
      idea({
        id: "a",
        title: "Completely unrelated cooking video",
        hook: "Nobody has ever found the lost recipe of gold",
      }),
    );
    expect(r!.reasons.some((x) => x.includes("opener pattern"))).toBe(true);
  });

  it("rewards proven outliers and penalizes risky ideas", () => {
    const out = scoreCandidate(
      SOURCE,
      idea({ id: "a", title: "Atlantis: the sunken city", outlierScore: 6.5 }),
    );
    const risky = scoreCandidate(
      SOURCE,
      idea({ id: "b", title: "Atlantis: the sunken city", safetyFlag: "risky" }),
    );
    expect(out!.score).toBeGreaterThan(risky!.score);
    expect(risky!.reasons.some((x) => x.includes("risky"))).toBe(true);
  });

  it("prefers ideas the user already saved", () => {
    const saved = scoreCandidate(
      SOURCE,
      idea({ id: "a", title: "El Dorado part 2", status: "saved" }),
    );
    const fresh = scoreCandidate(
      SOURCE,
      idea({ id: "b", title: "El Dorado part 2", status: "new" }),
    );
    expect(saved!.score).toBeGreaterThan(fresh!.score);
  });
});

describe("recommendNextVideos", () => {
  it("returns hasData:false with no eligible candidates", () => {
    expect(recommendNextVideos(SOURCE, []).hasData).toBe(false);
    expect(
      recommendNextVideos(SOURCE, [
        idea({ id: "a", title: "Old", status: "used" }),
      ]).recommendations,
    ).toEqual([]);
  });

  it("returns the top 5 scored ideas, sorted", () => {
    const candidates = [
      idea({ id: "1", title: "The Lost City of Gold part 2: new clues", angle: "lost cities treasure" }),
      idea({ id: "2", title: "Cooking pasta basics", angle: "italian recipes" }),
      idea({ id: "3", title: "Hidden treasure expeditions of 2025", angle: "modern treasure hunting" }),
      idea({ id: "4", title: "El Dorado: what the conquistadors missed", angle: "lost cities history" }),
      idea({ id: "5", title: "Top 10 dog breeds", angle: "pets" }),
      idea({ id: "6", title: "The amber room: history's lost treasure", angle: "lost treasure mystery" }),
      idea({ id: "7", title: "Quantum physics explained", angle: "science" }),
    ];
    const r = recommendNextVideos(SOURCE, candidates);
    expect(r.hasData).toBe(true);
    expect(r.recommendations).toHaveLength(5);
    // All topic-relevant ideas outrank the unrelated ones.
    const titles = r.recommendations.map((x) => x.idea.title);
    for (const relevant of [
      "The Lost City of Gold part 2: new clues",
      "Hidden treasure expeditions of 2025",
      "El Dorado: what the conquistadors missed",
      "The amber room: history's lost treasure",
    ]) {
      expect(titles).toContain(relevant);
    }
    // Sorted by score descending.
    const scores = r.recommendations.map((x) => x.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    // Every recommendation explains itself.
    for (const rec of r.recommendations) {
      expect(rec.reasons.length).toBeGreaterThan(0);
    }
  });

  it("dedupes near-identical titles", () => {
    const r = recommendNextVideos(SOURCE, [
      idea({ id: "1", title: "The lost city of gold", angle: "lost cities" }),
      idea({ id: "2", title: "The lost city of gold!", angle: "lost cities" }),
      idea({ id: "3", title: "Amber room mystery", angle: "lost treasure" }),
    ]);
    const titles = r.recommendations.map((x) => x.idea.id);
    expect(titles).toContain("1");
    expect(titles).not.toContain("2");
    expect(titles).toContain("3");
  });

  it("respects a custom count", () => {
    const topics = ["amber", "dorado", "atlantis", "tomb", "shipwreck", "pyramid", "vault", "temple"];
    const candidates = topics.map((t, i) =>
      idea({ id: String(i), title: `Lost treasure: the ${t} expedition`, angle: "treasure hunting" }),
    );
    expect(recommendNextVideos(SOURCE, candidates, 3).recommendations).toHaveLength(3);
  });
});
