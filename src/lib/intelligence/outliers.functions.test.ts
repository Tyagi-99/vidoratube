/**
 * Stream C — unit tests for outlier math.
 * Fixed fixtures, no network, fully deterministic (clock injected).
 */
import { describe, expect, it } from "vitest";
import {
  applyWeakEvidencePenalty,
  computeOutlierScore,
  computeVelocityPerDay,
  growth7dPct,
  median,
} from "./outliers.functions";
import type { Confidence, ScoreFactor } from "./types";

const NOW = new Date("2026-09-28T12:00:00Z");
const iso = (d: Date): string => d.toISOString();
const daysAgo = (n: number): string => iso(new Date(NOW.getTime() - n * 86_400_000));

describe("median", () => {
  it("odd count returns the middle value", () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it("even count returns the mean of the two middle values", () => {
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
  it("empty input returns null (never invents a median)", () => {
    expect(median([])).toBeNull();
  });
  it("single value returns itself", () => {
    expect(median([7])).toBe(7);
  });
});

describe("computeVelocityPerDay", () => {
  it("computes views/day between first and latest snapshot", () => {
    expect(
      computeVelocityPerDay([
        { capturedAt: daysAgo(2), viewCount: 100 },
        { capturedAt: daysAgo(0), viewCount: 300 },
      ]),
    ).toBe(100);
  });
  it("uses only the endpoints, ignoring middle snapshots", () => {
    expect(
      computeVelocityPerDay([
        { capturedAt: daysAgo(4), viewCount: 0 },
        { capturedAt: daysAgo(3), viewCount: 9999 },
        { capturedAt: daysAgo(0), viewCount: 400 },
      ]),
    ).toBe(100);
  });
  it("returns null with fewer than 2 snapshots", () => {
    expect(computeVelocityPerDay([{ capturedAt: daysAgo(0), viewCount: 100 }])).toBeNull();
    expect(computeVelocityPerDay([])).toBeNull();
  });
  it("returns null when an endpoint lacks a view count", () => {
    expect(
      computeVelocityPerDay([
        { capturedAt: daysAgo(2), viewCount: null },
        { capturedAt: daysAgo(0), viewCount: 300 },
      ]),
    ).toBeNull();
  });
  it("returns null when snapshots share a timestamp (no elapsed time)", () => {
    const t = daysAgo(1);
    expect(
      computeVelocityPerDay([
        { capturedAt: t, viewCount: 100 },
        { capturedAt: t, viewCount: 200 },
      ]),
    ).toBeNull();
  });
  it("can be negative when views decline", () => {
    expect(
      computeVelocityPerDay([
        { capturedAt: daysAgo(2), viewCount: 300 },
        { capturedAt: daysAgo(0), viewCount: 200 },
      ]),
    ).toBe(-50);
  });
});

describe("computeOutlierScore", () => {
  const base = {
    latestViews: 640,
    siblingLatestViews: [100, 200, 300],
    snapshots: [
      { capturedAt: daysAgo(2), viewCount: 440 },
      { capturedAt: daysAgo(0), viewCount: 640 },
    ],
    now: NOW,
  };

  it("scores as latest views / channel median", () => {
    const o = computeOutlierScore(base);
    expect(o?.score).toBe(3.2); // 640 / median(100,200,300)=200
  });
  it("derives velocity from first→latest snapshot", () => {
    const o = computeOutlierScore(base);
    expect(o?.velocityPerDay).toBe(100); // (640-440)/2d
    expect(o?.snapshotsUsed).toBe(2);
  });
  it("emits the three pinned factors with weights summing to 1", () => {
    const o = computeOutlierScore(base);
    expect(o?.factors.map((f) => f.key)).toEqual(["outperformance", "velocity", "recency"]);
    const weightSum = (o?.factors ?? []).reduce((s, f) => s + f.weight, 0);
    expect(weightSum).toBeCloseTo(1, 10);
    for (const f of o?.factors ?? []) {
      expect(f.value).toBeGreaterThanOrEqual(0);
      expect(f.value).toBeLessThanOrEqual(100);
      expect(f.detail.length).toBeGreaterThan(0);
    }
  });
  it("normalizes the outperformance factor from the score", () => {
    const o = computeOutlierScore(base);
    const f = o?.factors.find((x) => x.key === "outperformance");
    expect(f?.value).toBe(Math.round(((3.2 - 1) / 9) * 100)); // 24
    expect(f?.evidenceCount).toBe(3);
  });
  it("grades confidence from sibling count and snapshot count", () => {
    // 3 siblings, 2 snapshots → medium (no weak factors to drag it down)
    expect(computeOutlierScore(base)?.confidence).toBe("medium");
    const high = computeOutlierScore({
      ...base,
      siblingLatestViews: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120],
      snapshots: [
        { capturedAt: daysAgo(4), viewCount: 400 },
        { capturedAt: daysAgo(2), viewCount: 500 },
        { capturedAt: daysAgo(0), viewCount: 640 },
      ],
    });
    expect(high?.confidence).toBe("high");
  });
  it("marks the velocity factor weak and drags confidence down one level with 1 snapshot", () => {
    const o = computeOutlierScore({
      latestViews: 640,
      siblingLatestViews: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
      snapshots: [{ capturedAt: daysAgo(0), viewCount: 640 }],
      now: NOW,
    });
    // 10 siblings → base confidence "high", but velocity has 0 evidence → medium
    expect(o?.velocityPerDay).toBeNull();
    const v = o?.factors.find((f) => f.key === "velocity");
    expect(v?.evidenceCount).toBe(0);
    expect(v?.value).toBe(0);
    expect(o?.confidence).toBe("medium");
  });
  it("returns null when there are no siblings to form a median", () => {
    expect(computeOutlierScore({ ...base, siblingLatestViews: [] })).toBeNull();
  });
  it("returns null when the median is zero (no meaningful multiple)", () => {
    expect(
      computeOutlierScore({ ...base, siblingLatestViews: [0, 0, 0] }),
    ).toBeNull();
  });
});

describe("applyWeakEvidencePenalty", () => {
  const strong: ScoreFactor[] = [
    { key: "a", label: "A", weight: 1, value: 50, detail: "d", evidenceCount: 3 },
  ];
  const weak: ScoreFactor[] = [
    { key: "a", label: "A", weight: 0.5, value: 50, detail: "d", evidenceCount: 3 },
    { key: "b", label: "B", weight: 0.5, value: 0, detail: "d", evidenceCount: 0 },
  ];
  it.each<[Confidence, Confidence]>([
    ["high", "high"],
    ["medium", "medium"],
    ["low", "low"],
  ])("leaves %s unchanged when every factor has evidence", (input, expected) => {
    expect(applyWeakEvidencePenalty(input, strong)).toBe(expected);
  });
  it("drags confidence down exactly one level on weak evidence", () => {
    expect(applyWeakEvidencePenalty("high", weak)).toBe("medium");
    expect(applyWeakEvidencePenalty("medium", weak)).toBe("low");
    expect(applyWeakEvidencePenalty("low", weak)).toBe("low");
  });
});

describe("growth7dPct", () => {
  it("computes percent growth vs the snapshot ≥7d earlier", () => {
    expect(
      growth7dPct([
        { capturedAt: daysAgo(8), subscriberCount: 1000 },
        { capturedAt: daysAgo(1), subscriberCount: 1100 },
      ]),
    ).toBe(10);
  });
  it("returns null without a baseline at least 7 days old", () => {
    expect(
      growth7dPct([
        { capturedAt: daysAgo(3), subscriberCount: 1000 },
        { capturedAt: daysAgo(0), subscriberCount: 1100 },
      ]),
    ).toBeNull();
  });
  it("returns null when the baseline is zero (no division by zero)", () => {
    expect(
      growth7dPct([
        { capturedAt: daysAgo(8), subscriberCount: 0 },
        { capturedAt: daysAgo(0), subscriberCount: 1100 },
      ]),
    ).toBeNull();
  });
  it("returns null when counts are unknown instead of inventing 0%", () => {
    expect(
      growth7dPct([
        { capturedAt: daysAgo(8), subscriberCount: null },
        { capturedAt: daysAgo(0), subscriberCount: 1100 },
      ]),
    ).toBeNull();
  });
});
