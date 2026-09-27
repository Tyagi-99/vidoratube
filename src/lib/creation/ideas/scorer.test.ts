/**
 * Stream A — F8 scorer unit tests. Pure logic; no fabricated provider data.
 */
import { describe, expect, it } from "vitest";
import {
  extractIdeaKeywords,
  IDEA_FACTOR_WEIGHTS,
  scoreIdea,
  type IdeaOutlierEvidence,
  type IdeaScorerIdea,
} from "./scorer";

const baseIdea: IdeaScorerIdea = {
  id: "idea-1",
  title: "The Untold History of Night Trains",
  hook: "Nobody talks about the secret mistake that killed night trains — what really happened?",
  angle: "nostalgia + mystery",
  format: "long",
  difficulty: "medium",
  safetyFlag: "safe",
};

const richEvidence: IdeaOutlierEvidence = {
  matchedOutlierScores: [4.2, 3.1, 2.4, 6.0, 1.8, 2.9],
  matchedKeywords: ["trains", "history"],
  projectOutlierCount: 24,
};

describe("extractIdeaKeywords", () => {
  it("extracts deterministic keywords, dropping stopwords", () => {
    const a = extractIdeaKeywords("Night Trains", "secret night trains", "history");
    const b = extractIdeaKeywords("Night Trains", "secret night trains", "history");
    expect(a).toEqual(b);
    expect(a).toContain("trains");
    expect(a).toContain("night");
    expect(a).not.toContain("the");
    expect(a.length).toBeLessThanOrEqual(8);
  });

  it("returns an empty list for empty input", () => {
    expect(extractIdeaKeywords("", "", "")).toEqual([]);
  });
});

describe("scoreIdea — determinism", () => {
  it("returns identical scores for identical inputs", () => {
    const a = scoreIdea({ idea: baseIdea, outlier: richEvidence });
    const b = scoreIdea({ idea: baseIdea, outlier: richEvidence });
    expect(a).toEqual(b);
  });

  it("weights sum to 1", () => {
    const total = Object.values(IDEA_FACTOR_WEIGHTS).reduce((s, w) => s + w, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("total is an integer within 0..100 and factors carry weights + evidence", () => {
    const score = scoreIdea({ idea: baseIdea, outlier: richEvidence });
    expect(Number.isInteger(score.total)).toBe(true);
    expect(score.total).toBeGreaterThanOrEqual(0);
    expect(score.total).toBeLessThanOrEqual(100);
    expect(score.factors).toHaveLength(4);
    for (const f of score.factors) {
      expect(f.value).toBeGreaterThanOrEqual(0);
      expect(f.value).toBeLessThanOrEqual(1);
      expect(f.weight).toBeGreaterThan(0);
      expect(f.evidence.length).toBeGreaterThan(0);
    }
  });
});

describe("scoreIdea — outlier_alignment factor (Phase-2 linkage)", () => {
  it("saturates at a 5x median multiple and cites the multiple in evidence", () => {
    const score = scoreIdea({ idea: baseIdea, outlier: richEvidence });
    const f = score.factors.find((x) => x.key === "outlier_alignment")!;
    expect(f.value).toBe(1);
    expect(f.evidence).toContain("6.0x channel median");
    expect(f.evidence).toContain("6 outlier videos matched");
  });

  it("scales below 5x and names the keywords", () => {
    const score = scoreIdea({
      idea: baseIdea,
      outlier: {
        matchedOutlierScores: [2.5],
        matchedKeywords: ["trains"],
        projectOutlierCount: 10,
      },
    });
    const f = score.factors.find((x) => x.key === "outlier_alignment")!;
    expect(f.value).toBeCloseTo(0.5, 6);
  });

  it("emits insufficient_data with zero value when no outliers match", () => {
    const score = scoreIdea({
      idea: baseIdea,
      outlier: { matchedOutlierScores: [], matchedKeywords: ["trains"], projectOutlierCount: 12 },
    });
    const f = score.factors.find((x) => x.key === "outlier_alignment")!;
    expect(f.value).toBe(0);
    expect(f.evidence).toContain("insufficient_data");
  });

  it("distinguishes an empty outlier project from a keyword miss", () => {
    const score = scoreIdea({
      idea: baseIdea,
      outlier: { matchedOutlierScores: [], matchedKeywords: [], projectOutlierCount: 0 },
    });
    const f = score.factors.find((x) => x.key === "outlier_alignment")!;
    expect(f.evidence).toContain("no outlier videos yet");
  });
});

describe("scoreIdea — confidence degradation (D94)", () => {
  it("is high with rich evidence", () => {
    const score = scoreIdea({ idea: baseIdea, outlier: richEvidence });
    expect(score.confidence).toBe("high");
  });

  it("is low with thin evidence and says so in the verdict", () => {
    const score = scoreIdea({
      idea: baseIdea,
      outlier: { matchedOutlierScores: [1.2], matchedKeywords: ["trains"], projectOutlierCount: 2 },
    });
    expect(score.confidence).toBe("low");
    expect(score.verdict).toContain("low confidence");
  });

  it("is low when the hook is missing", () => {
    const score = scoreIdea({
      idea: { ...baseIdea, hook: "" },
      outlier: richEvidence,
    });
    expect(score.confidence).toBe("low");
    const f = score.factors.find((x) => x.key === "hook_strength")!;
    expect(f.evidence).toContain("insufficient_data");
  });

  it("is medium with partial evidence", () => {
    const score = scoreIdea({
      idea: baseIdea,
      outlier: {
        matchedOutlierScores: [2.1, 3.3],
        matchedKeywords: ["trains"],
        projectOutlierCount: 8,
      },
    });
    expect(score.confidence).toBe("medium");
  });
});

describe("scoreIdea — no virality guarantees", () => {
  it("the verdict never promises virality", () => {
    const score = scoreIdea({ idea: baseIdea, outlier: richEvidence });
    expect(score.verdict.toLowerCase()).toContain("not a virality prediction");
    expect(score.verdict.toLowerCase()).not.toContain("guarantee");
    expect(score.verdict.toLowerCase()).not.toContain("will go viral");
  });
});

describe("scoreIdea — other factors", () => {
  it("feasibility maps difficulty deterministically", () => {
    const easy = scoreIdea({ idea: { ...baseIdea, difficulty: "easy" }, outlier: richEvidence });
    const hard = scoreIdea({ idea: { ...baseIdea, difficulty: "hard" }, outlier: richEvidence });
    const fEasy = easy.factors.find((x) => x.key === "feasibility")!;
    const fHard = hard.factors.find((x) => x.key === "feasibility")!;
    expect(fEasy.value).toBe(1);
    expect(fHard.value).toBe(0.35);
  });

  it("safety near-zeroes blocked ideas", () => {
    const score = scoreIdea({
      idea: { ...baseIdea, safetyFlag: "blocked" },
      outlier: richEvidence,
    });
    const f = score.factors.find((x) => x.key === "safety")!;
    expect(f.value).toBe(0.1);
  });

  it("hook heuristics reward questions, numbers, and the length sweet spot", () => {
    const good = scoreIdea({ idea: baseIdea, outlier: richEvidence });
    const bad = scoreIdea({
      idea: { ...baseIdea, hook: "trains" },
      outlier: richEvidence,
    });
    const g = good.factors.find((x) => x.key === "hook_strength")!;
    const b = bad.factors.find((x) => x.key === "hook_strength")!;
    expect(g.value).toBeGreaterThan(b.value);
    expect(g.evidence).toContain("asks a question");
  });
});
