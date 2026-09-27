import { describe, expect, it } from "vitest";
import {
  addRuleSchema,
  evaluateRule,
  evaluateRuleValue,
  medianOf,
  outlierScoreFor,
  RULE_FIELDS,
  RULE_OPERATORS,
} from "./folders.functions";

describe("medianOf", () => {
  it("computes odd-count median", () => {
    expect(medianOf([100, 300, 200])).toBe(200);
  });
  it("computes even-count median", () => {
    expect(medianOf([100, 400, 200, 300])).toBe(250);
  });
  it("returns null for empty or all non-finite", () => {
    expect(medianOf([])).toBeNull();
    expect(medianOf([NaN, Infinity])).toBeNull();
  });
  it("ignores non-finite entries", () => {
    expect(medianOf([100, NaN, 300])).toBe(200);
  });
});

describe("outlierScoreFor (contract: latest views / channel median)", () => {
  it("returns the multiple of the channel median", () => {
    // Median of [1000, 2000, 3000, 8000] (even count) = 2500 → 3.2x.
    expect(outlierScoreFor(8000, [1000, 2000, 3000, 8000])).toBeCloseTo(8000 / 2500, 6);
  });
  it("returns null when latest views are unknown", () => {
    expect(outlierScoreFor(null, [1000, 2000])).toBeNull();
    expect(outlierScoreFor(undefined, [1000, 2000])).toBeNull();
  });
  it("returns null when there is no usable median", () => {
    expect(outlierScoreFor(500, [])).toBeNull();
    expect(outlierScoreFor(500, [0, 0])).toBeNull();
  });
  it("is deterministic on fixed fixtures", () => {
    const a = outlierScoreFor(12_500, [1000, 2000, 12_500, 3000]);
    const b = outlierScoreFor(12_500, [1000, 2000, 12_500, 3000]);
    expect(a).toBe(b);
    expect(a).toBeCloseTo(12_500 / 2500, 6);
  });
});

describe("evaluateRuleValue operators", () => {
  it("eq / neq compare numerically across types", () => {
    expect(evaluateRuleValue("eq", 2.5, 2.5)).toBe(true);
    expect(evaluateRuleValue("eq", "2.5", 2.5)).toBe(true);
    expect(evaluateRuleValue("eq", "new", "new")).toBe(true);
    expect(evaluateRuleValue("eq", "new", "New")).toBe(false);
    expect(evaluateRuleValue("neq", "new", "draft")).toBe(true);
    expect(evaluateRuleValue("neq", 3, 3)).toBe(false);
  });
  it("comparison operators need numbers", () => {
    expect(evaluateRuleValue("gt", 10, 5)).toBe(true);
    expect(evaluateRuleValue("gte", 5, 5)).toBe(true);
    expect(evaluateRuleValue("lt", 4, 5)).toBe(true);
    expect(evaluateRuleValue("lte", 5, 5)).toBe(true);
    expect(evaluateRuleValue("gt", 4, 5)).toBe(false);
    expect(evaluateRuleValue("gt", "abc", 5)).toBe(false);
    expect(evaluateRuleValue("gt", 10, "abc")).toBe(false);
  });
  it("contains is case-insensitive substring", () => {
    expect(evaluateRuleValue("contains", "Web Article", "web")).toBe(true);
    expect(evaluateRuleValue("contains", "web", "Web Article")).toBe(false);
  });
  it("in requires an array and matches loosely", () => {
    expect(evaluateRuleValue("in", "new", ["new", "draft"])).toBe(true);
    expect(evaluateRuleValue("in", "archived", ["new", "draft"])).toBe(false);
    expect(evaluateRuleValue("in", "5000", [5000])).toBe(true);
    expect(evaluateRuleValue("in", "new", "new")).toBe(false);
  });
  it("null/undefined candidate never matches", () => {
    for (const op of RULE_OPERATORS) {
      expect(evaluateRuleValue(op, null, "x")).toBe(false);
      expect(evaluateRuleValue(op, undefined, "x")).toBe(false);
    }
    // neq included: insufficient data must not silently match
    expect(evaluateRuleValue("neq", null, "x")).toBe(false);
  });
});

describe("evaluateRule date semantics (videos.published_at)", () => {
  it("eq/neq compare calendar day", () => {
    expect(evaluateRule("videos.published_at", "eq", "2026-09-01", "2026-09-01T10:00:00Z")).toBe(
      true,
    );
    expect(evaluateRule("videos.published_at", "neq", "2026-09-01", "2026-09-02T10:00:00Z")).toBe(
      true,
    );
    expect(evaluateRule("videos.published_at", "eq", "2026-09-01", "2026-09-02T10:00:00Z")).toBe(
      false,
    );
  });
  it("gt/lt compare timestamps", () => {
    expect(evaluateRule("videos.published_at", "gt", "2026-08-01", "2026-09-01T00:00:00Z")).toBe(
      true,
    );
    expect(evaluateRule("videos.published_at", "lt", "2026-08-01", "2026-09-01T00:00:00Z")).toBe(
      false,
    );
    expect(evaluateRule("videos.published_at", "gt", "2026-08-01", "not-a-date")).toBe(false);
  });
});

describe("addRuleSchema (contract: field + operator enum)", () => {
  it("accepts every pinned field and operator", () => {
    const kindOf = (field: string): string =>
      field === "videos.published_at"
        ? "date"
        : field === "video_ideas.status" || field === "research_sources.source_type"
          ? "string"
          : "number";
    const isComparison = (op: string) => ["gt", "gte", "lt", "lte"].includes(op);
    for (const field of RULE_FIELDS) {
      for (const operator of RULE_OPERATORS) {
        const kind = kindOf(field);
        const value =
          operator === "in"
            ? ["a"]
            : isComparison(operator) && kind === "number"
              ? 5
              : isComparison(operator) && kind === "date"
                ? "2026-08-01"
                : "x";
        expect(() =>
          addRuleSchema.parse({
            folderId: "123e4567-e89b-12d3-a456-426614174000",
            field,
            operator,
            value,
          }),
        ).not.toThrow();
      }
    }
  });
  it("rejects unknown field and operator", () => {
    const base = {
      folderId: "123e4567-e89b-12d3-a456-426614174000",
      field: "videos.title",
      operator: "eq",
      value: "x",
    };
    expect(() => addRuleSchema.parse(base)).toThrow();
    expect(() =>
      addRuleSchema.parse({ ...base, field: "videos.view_count", operator: "like" }),
    ).toThrow();
  });
  it("operator 'in' requires an array value", () => {
    const base = {
      folderId: "123e4567-e89b-12d3-a456-426614174000",
      field: "video_ideas.status",
      operator: "in",
      value: "new",
    };
    expect(() => addRuleSchema.parse(base)).toThrow();
    expect(() => addRuleSchema.parse({ ...base, value: ["new", "draft"] })).not.toThrow();
  });
  it("numeric comparisons require numeric values", () => {
    const base = {
      folderId: "123e4567-e89b-12d3-a456-426614174000",
      field: "videos.view_count",
      operator: "gte",
    };
    expect(() => addRuleSchema.parse({ ...base, value: "big" })).toThrow();
    expect(() => addRuleSchema.parse({ ...base, value: 10000 })).not.toThrow();
    expect(() => addRuleSchema.parse({ ...base, value: "10000" })).not.toThrow();
  });
  it("date comparisons require an ISO date value", () => {
    const base = {
      folderId: "123e4567-e89b-12d3-a456-426614174000",
      field: "videos.published_at",
      operator: "gt",
    };
    expect(() => addRuleSchema.parse({ ...base, value: "yesterday" })).toThrow();
    expect(() => addRuleSchema.parse({ ...base, value: "2026-08-01" })).not.toThrow();
  });
});
