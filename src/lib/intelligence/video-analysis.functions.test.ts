/**
 * Stream C — unit tests for video-analysis fact extractors.
 * Fixed fixtures, no network, fully deterministic.
 */
import { describe, expect, it } from "vitest";
import { packagingFacts, performanceFacts, publishingFacts } from "./video-analysis.functions";

describe("packagingFacts", () => {
  it("extracts descriptive packaging facts", () => {
    const f = packagingFacts("Top 10 Unsolved Mysteries?", "https://img/thumb.jpg");
    expect(f.titleLength).toBe(26);
    expect(f.hasNumber).toBe(true);
    expect(f.hasQuestion).toBe(true);
    expect(f.thumbnailUrl).toBe("https://img/thumb.jpg");
  });
  it("counts unicode characters, not UTF-16 code units", () => {
    expect(packagingFacts("héllo 🎬", null).titleLength).toBe(7);
  });
  it("reports absent patterns as false, not as claims", () => {
    const f = packagingFacts("a quiet history of bread", null);
    expect(f.hasNumber).toBe(false);
    expect(f.hasQuestion).toBe(false);
  });
});

describe("publishingFacts", () => {
  it("derives weekday and UTC hour from published_at", () => {
    // 2026-09-28 is a Monday.
    const f = publishingFacts("2026-09-28T14:30:00Z");
    expect(f.dayOfWeek).toBe("Monday");
    expect(f.hourUTC).toBe(14);
  });
  it("uses UTC, not server-local time", () => {
    // 01:30 IST on the 29th is still the 28th in UTC.
    const f = publishingFacts("2026-09-29T01:30:00+05:30");
    expect(f.dayOfWeek).toBe("Monday");
    expect(f.hourUTC).toBe(20);
  });
  it("returns nulls when published_at is unknown", () => {
    expect(publishingFacts(null)).toEqual({
      publishedAt: null,
      dayOfWeek: null,
      hourUTC: null,
    });
  });
  it("returns nulls for an unparseable timestamp", () => {
    const f = publishingFacts("not-a-date");
    expect(f.dayOfWeek).toBeNull();
    expect(f.hourUTC).toBeNull();
  });
});

describe("performanceFacts", () => {
  const snaps = [
    { capturedAt: "2026-09-26T12:00:00Z", viewCount: 100 },
    { capturedAt: "2026-09-28T12:00:00Z", viewCount: 300 },
  ];
  it("takes views from the latest snapshot", () => {
    expect(performanceFacts(snaps, 12, null).views).toBe(300);
  });
  it("computes views/day across the snapshot window", () => {
    expect(performanceFacts(snaps, 12, null).viewsPerDay).toBe(100);
  });
  it("prefers the snapshot like count, then metrics jsonb", () => {
    expect(performanceFacts(snaps, 12, { likes: 99 }).likeCount).toBe(12);
    expect(performanceFacts(snaps, null, { likes: 99 }).likeCount).toBe(99);
    expect(performanceFacts(snaps, null, { likeCount: 5 }).likeCount).toBe(5);
  });
  it("returns nulls — never 0 — when nothing is known", () => {
    expect(performanceFacts([], null, null)).toEqual({
      views: null,
      viewsPerDay: null,
      likeCount: null,
    });
  });
});
