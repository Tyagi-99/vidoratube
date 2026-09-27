/**
 * Stream A — F8 server-function unit tests.
 *
 * Integration tests for the handlers would need a live database; following
 * the codebase convention (folders.functions.test.ts etc.) we test the
 * exported pure pieces: row mapping, outlier matching, score-input assembly,
 * cache payload shape, and input schemas.
 */
import { describe, expect, it } from "vitest";
import {
  buildIdeaScoreInput,
  buildScoreCachePayload,
  createIdeaSchema,
  ideaRowToScorerInput,
  listIdeasSchema,
  matchOutliersToIdea,
} from "./ideas.functions";

const row = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "22222222-2222-4222-8222-222222222222",
  project_id: "33333333-3333-4333-8333-333333333333",
  title: "The Untold History of Night Trains",
  hook: "Nobody talks about the secret mistake that killed night trains.",
  angle: "nostalgia",
  format: "long",
  difficulty: "medium",
  safety_flag: "safe",
  status: "new",
  project_ref: null,
  score: null,
  created_at: "2026-09-28T00:00:00Z",
  updated_at: "2026-09-28T00:00:00Z",
};

const outliers = [
  { youtube_id: "a", title: "Night Trains: The Untold Story", outlier_score: 4.2 },
  { youtube_id: "b", title: "Cooking Pasta Fast", outlier_score: 9.9 },
  { youtube_id: "c", title: "Why History Forgot Sleeper Trains", outlier_score: 2.1 },
];

describe("ideaRowToScorerInput", () => {
  it("maps snake_case columns to the scorer shape", () => {
    const input = ideaRowToScorerInput(row);
    expect(input).toMatchObject({
      id: row.id,
      title: row.title,
      safetyFlag: "safe",
      difficulty: "medium",
    });
  });
});

describe("matchOutliersToIdea", () => {
  it("matches by keyword substring, case-insensitive", () => {
    const matched = matchOutliersToIdea(outliers, ["trains", "history"]);
    expect(matched.map((m) => m.youtube_id).sort()).toEqual(["a", "c"]);
  });

  it("returns [] when there are no keywords", () => {
    expect(matchOutliersToIdea(outliers, [])).toEqual([]);
  });

  it("caps matches at 50", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      youtube_id: `v${i}`,
      title: "trains video",
      outlier_score: 1.5,
    }));
    expect(matchOutliersToIdea(many, ["trains"])).toHaveLength(50);
  });
});

describe("buildIdeaScoreInput", () => {
  it("assembles scorer input with matched scores and project counts", () => {
    const input = buildIdeaScoreInput(row, outliers);
    expect(input.outlier.matchedOutlierScores).toEqual([4.2, 2.1]);
    expect(input.outlier.projectOutlierCount).toBe(3);
    expect(input.outlier.matchedKeywords.length).toBeGreaterThan(0);
  });

  it("filters non-finite outlier scores", () => {
    const input = buildIdeaScoreInput(row, [
      { youtube_id: "x", title: "trains", outlier_score: NaN },
      { youtube_id: "y", title: "trains", outlier_score: 2 },
    ]);
    expect(input.outlier.matchedOutlierScores).toEqual([2]);
  });
});

describe("buildScoreCachePayload", () => {
  it("wraps the score with a computed_at timestamp", () => {
    const score = { total: 70, factors: [], confidence: "low" as const, verdict: "v" };
    const payload = buildScoreCachePayload(score);
    expect(payload.score).toEqual(score);
    expect(typeof payload.computed_at).toBe("string");
  });
});

describe("schemas", () => {
  it("createIdeaSchema requires a research project and title", () => {
    expect(() => createIdeaSchema.parse({ researchProjectId: "not-a-uuid", title: "x" })).toThrow();
    expect(() =>
      createIdeaSchema.parse({
        researchProjectId: "33333333-3333-4333-8333-333333333333",
        title: "",
      }),
    ).toThrow();
    const ok = createIdeaSchema.parse({
      researchProjectId: "33333333-3333-4333-8333-333333333333",
      title: "An idea",
    });
    expect(ok.difficulty).toBe("medium");
    expect(ok.safetyFlag).toBe("safe");
  });

  it("listIdeasSchema clamps limit", () => {
    expect(() => listIdeasSchema.parse({ limit: 500 })).toThrow();
    expect(listIdeasSchema.parse({}).limit).toBe(100);
  });
});
