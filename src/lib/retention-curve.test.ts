import { describe, expect, it } from "vitest";
import {
  buildRetentionModel,
  chaptersToSegments,
  type RetentionPoint,
  type RetentionSegment,
} from "./retention-curve";

const SEGMENTS: RetentionSegment[] = [
  { index: 0, title: "Hook", startSec: 0, endSec: 30 },
  { index: 1, title: "Deep dive", startSec: 30, endSec: 90 },
  { index: 2, title: "Payoff", startSec: 90, endSec: 120 },
];

function points(rs: [number, number][]): RetentionPoint[] {
  return rs.map(([t, r]) => ({ t, r }));
}

describe("chaptersToSegments", () => {
  it("builds cumulative boundaries from real durations", () => {
    const segs = chaptersToSegments([
      { title: "A", durationSeconds: 30 },
      { title: "B", durationSeconds: 60 },
    ]);
    expect(segs).toEqual([
      { index: 0, title: "A", startSec: 0, endSec: 30 },
      { index: 1, title: "B", startSec: 30, endSec: 90 },
    ]);
  });

  it("skips chapters without real durations instead of inventing boundaries", () => {
    const segs = chaptersToSegments([
      { title: "A", durationSeconds: 30 },
      { title: "B", durationSeconds: 0 },
      { title: "C", durationSeconds: -4 },
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.endSec).toBe(30);
  });
});

describe("buildRetentionModel", () => {
  it("reports no data with fewer than 3 points", () => {
    const m = buildRetentionModel(SEGMENTS, points([[5, 80], [10, 70]]));
    expect(m.hasData).toBe(false);
    expect(m.segments).toEqual([]);
  });

  it("aligns points to chapters and finds strongest/weakest", () => {
    const m = buildRetentionModel(
      SEGMENTS,
      points([
        [5, 90], [15, 80], [25, 70], // Hook avg 80
        [40, 60], [60, 50], [80, 40], // Deep dive avg 50
        [100, 85], [110, 95], // Payoff avg 90
      ]),
    );
    expect(m.hasData).toBe(true);
    expect(m.segments).toHaveLength(3);
    expect(m.segments[0]!.avgRetention).toBeCloseTo(80);
    expect(m.segments[1]!.avgRetention).toBeCloseTo(50);
    expect(m.segments[2]!.avgRetention).toBeCloseTo(90);
    expect(m.segments[1]!.dropVsPrevious).toBeCloseTo(-30);
    expect(m.strongest?.segment.title).toBe("Payoff");
    expect(m.weakest?.segment.title).toBe("Deep dive");
    expect(m.overallAvg).toBeCloseTo(71.25);
  });

  it("leaves segments with no points as null (honest gaps)", () => {
    const m = buildRetentionModel(SEGMENTS, points([[5, 80], [10, 70], [15, 60]]));
    expect(m.hasData).toBe(true);
    expect(m.segments[0]!.avgRetention).toBeCloseTo(70);
    expect(m.segments[1]!.avgRetention).toBeNull();
    expect(m.segments[1]!.pointCount).toBe(0);
  });

  it("clamps out-of-range retention values and drops invalid points", () => {
    const m = buildRetentionModel(
      [{ index: 0, title: "All", startSec: 0, endSec: 100 }],
      [
        { t: 10, r: 150 }, // clamps to 100
        { t: 20, r: -30 }, // clamps to 0
        { t: NaN, r: 50 }, // invalid, dropped
        { t: 30, r: 50 },
      ],
    );
    expect(m.overallAvg).toBeCloseTo(50);
  });

  it("works with no segments (curve stored without chapter alignment)", () => {
    const m = buildRetentionModel([], points([[5, 80], [50, 60], [100, 40]]));
    expect(m.hasData).toBe(true);
    expect(m.segments).toEqual([]);
    expect(m.overallAvg).toBeCloseTo(60);
  });
});
