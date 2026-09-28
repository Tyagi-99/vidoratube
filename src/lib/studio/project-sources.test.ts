/**
 * Phase 6 Stream E (P5) — multi-source project ingestion validation tests.
 */
import { describe, expect, it } from "vitest";
import {
  deriveTopicFromSource,
  validateProjectSource,
} from "./project-sources";

describe("validateProjectSource", () => {
  it("accepts topic mode with a topic (existing behavior)", () => {
    expect(validateProjectSource({ topic: "night trains" })).toEqual([]);
  });

  it("accepts topic mode with only a script", () => {
    expect(validateProjectSource({ topic: "", script: "once upon a time…" })).toEqual([]);
  });

  it("rejects topic mode with neither topic nor script", () => {
    const errors = validateProjectSource({ topic: "", script: "" });
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects draft mode without script text", () => {
    const errors = validateProjectSource({ sourceKind: "draft", topic: "x" });
    expect(errors.some((e) => e.includes("draft"))).toBe(true);
  });

  it("rejects short transcript/article sources", () => {
    for (const kind of ["transcript", "article"] as const) {
      const errors = validateProjectSource({
        sourceKind: kind,
        topic: "x",
        sourceText: "too short",
      });
      expect(errors.some((e) => e.includes("at least 50"))).toBe(true);
    }
  });

  it("accepts a real transcript source", () => {
    expect(
      validateProjectSource({
        sourceKind: "transcript",
        sourceText: "0:00 welcome back to the channel, today we tour europe by night train…".repeat(3),
      }),
    ).toEqual([]);
  });

  it("derives topic for transcript sources; draft without topic is fine (script required)", () => {
    // transcript without topic → valid (topic derived)
    expect(
      validateProjectSource({ sourceKind: "transcript", sourceText: "a".repeat(60) }),
    ).toEqual([]);
    // draft without topic but with script → valid (falls back to Untitled project)
    expect(validateProjectSource({ sourceKind: "draft", script: "hello" })).toEqual([]);
    // draft without script → invalid
    const errors = validateProjectSource({ sourceKind: "draft", topic: "x" });
    expect(errors.some((e) => e.includes("draft"))).toBe(true);
  });

  it("rejects invalid URLs for url sources", () => {
    expect(
      validateProjectSource({ sourceKind: "url", sourceUrl: "not a url" }).length,
    ).toBeGreaterThan(0);
    expect(
      validateProjectSource({ sourceKind: "url", sourceUrl: "ftp://example.com/x" }).length,
    ).toBeGreaterThan(0);
  });

  it("accepts https URLs as reference-only sources", () => {
    expect(
      validateProjectSource({
        sourceKind: "url",
        sourceUrl: "https://example.com/article",
      }),
    ).toEqual([]);
  });

  it("rejects over-long pasted source text", () => {
    const errors = validateProjectSource({
      sourceKind: "article",
      topic: "x",
      sourceText: "a".repeat(100_001),
    });
    expect(errors.some((e) => e.includes("too long"))).toBe(true);
  });
});

describe("deriveTopicFromSource", () => {
  it("takes the first non-empty line, truncated", () => {
    expect(deriveTopicFromSource("\n\n  Night trains of Europe\nrest", 80)).toBe(
      "Night trains of Europe",
    );
    const long = `x${"y".repeat(200)}`;
    expect(deriveTopicFromSource(long, 80)).toHaveLength(80);
  });

  it("falls back to Untitled project", () => {
    expect(deriveTopicFromSource("   \n  ")).toBe("Untitled project");
  });
});
