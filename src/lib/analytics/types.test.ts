import { describe, expect, it } from "vitest";
import {
  metricValue,
  parseRevenueBasis,
  parseSource,
  sourceLabel,
} from "./types";

describe("parseSource", () => {
  it("accepts the two platform sources", () => {
    expect(parseSource("youtube_analytics")).toBe("youtube_analytics");
    expect(parseSource("meta_insights")).toBe("meta_insights");
  });

  it("defaults unknown/missing values to fixture (honest default, D136)", () => {
    expect(parseSource("whatever")).toBe("fixture");
    expect(parseSource(null)).toBe("fixture");
    expect(parseSource(undefined)).toBe("fixture");
  });
});

describe("parseRevenueBasis", () => {
  it("defaults to estimate unless explicitly measured", () => {
    expect(parseRevenueBasis("measured")).toBe("measured");
    expect(parseRevenueBasis("estimate")).toBe("estimate");
    expect(parseRevenueBasis("bogus")).toBe("estimate");
    expect(parseRevenueBasis(undefined)).toBe("estimate");
  });
});

describe("sourceLabel", () => {
  it("marks fixtures as demo data", () => {
    expect(sourceLabel("fixture").isDemo).toBe(true);
    expect(sourceLabel("fixture").label).toMatch(/DEMO/i);
  });

  it("marks platform sources as non-demo", () => {
    expect(sourceLabel("youtube_analytics").isDemo).toBe(false);
    expect(sourceLabel("meta_insights").isDemo).toBe(false);
  });
});

describe("metricValue", () => {
  it("reads numbers and coerces garbage to 0", () => {
    expect(metricValue({ views: 42 }, "views")).toBe(42);
    expect(metricValue({}, "views")).toBe(0);
    expect(metricValue(null, "views")).toBe(0);
    expect(metricValue({ views: NaN }, "views")).toBe(0);
  });
});
