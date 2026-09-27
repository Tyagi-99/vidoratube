/**
 * Stream A — F14 server-function unit tests (pure pieces: transitions,
 * arm splits, score serialization, input schemas).
 */
import { describe, expect, it } from "vitest";
import {
  assertTitleStatusTransition,
  buildExperimentArmSplits,
  createTitleExperimentSchema,
  generateTitlesSchema,
  setVariantStatusSchema,
  titleScoreToJson,
} from "./titles.functions";

describe("assertTitleStatusTransition", () => {
  it("allows the pinned draft → testing → winner flow", () => {
    expect(() => assertTitleStatusTransition("draft", "testing")).not.toThrow();
    expect(() => assertTitleStatusTransition("testing", "winner")).not.toThrow();
    expect(() => assertTitleStatusTransition("winner", "retired")).not.toThrow();
  });

  it("allows retreat paths", () => {
    expect(() => assertTitleStatusTransition("testing", "draft")).not.toThrow();
    expect(() => assertTitleStatusTransition("retired", "draft")).not.toThrow();
  });

  it("rejects skips and illegal moves", () => {
    expect(() => assertTitleStatusTransition("draft", "winner")).toThrow(/Illegal/);
    expect(() => assertTitleStatusTransition("retired", "testing")).toThrow(/Illegal/);
    expect(() => assertTitleStatusTransition("winner", "testing")).toThrow(/Illegal/);
    expect(() => assertTitleStatusTransition("bogus", "draft")).toThrow(/Illegal/);
  });
});

describe("buildExperimentArmSplits", () => {
  it("splits evenly and sums to 1", () => {
    const splits = buildExperimentArmSplits(4);
    expect(splits).toHaveLength(4);
    expect(splits.every((s) => s === 0.25)).toBe(true);
    expect(splits.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it("handles uneven counts without losing traffic", () => {
    const splits = buildExperimentArmSplits(3);
    expect(splits.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(Math.min(...splits)).toBeGreaterThan(0);
  });

  it("rejects zero variants", () => {
    expect(() => buildExperimentArmSplits(0)).toThrow(/At least one variant/);
  });
});

describe("titleScoreToJson", () => {
  it("round-trips the pinned TitleScore shape", () => {
    const score = {
      total: 70,
      factors: { length: 20, keyword: 25, curiosity: 15, clarity: 10 },
      weakEvidence: ["keyword: no keyword corpus"],
    };
    expect(titleScoreToJson(score)).toEqual(score);
  });
});

describe("schemas", () => {
  const projectId = "33333333-3333-4333-8333-333333333333";

  it("generateTitlesSchema validates and defaults", () => {
    const ok = generateTitlesSchema.parse({ projectId, topic: "night trains" });
    expect(ok.maxVariants).toBe(10);
    expect(ok.keywords).toEqual([]);
    expect(() => generateTitlesSchema.parse({ projectId, topic: "" })).toThrow();
    expect(() => generateTitlesSchema.parse({ projectId, topic: "x", maxVariants: 99 })).toThrow();
  });

  it("setVariantStatusSchema only allows pinned statuses", () => {
    expect(() =>
      setVariantStatusSchema.parse({
        variantId: "11111111-1111-4111-8111-111111111111",
        status: "bogus",
      }),
    ).toThrow();
  });

  it("createTitleExperimentSchema needs 2–12 variants", () => {
    const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
    const ok = createTitleExperimentSchema.parse({
      projectId,
      name: "Title test",
      variantIds: ids,
    });
    expect(ok.variantIds).toHaveLength(2);
    expect(() =>
      createTitleExperimentSchema.parse({ projectId, name: "x", variantIds: ids.slice(0, 1) }),
    ).toThrow();
  });
});
