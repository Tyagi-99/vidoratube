import { describe, expect, it } from "vitest";
import {
  computeDeltas,
  formatCompact,
  formatDelta,
  pickDeltaPair,
  sumMetrics,
} from "./deltas";
import type { DashboardSnapshot } from "./types";

function snap(date: string, views: number, source = "youtube_analytics" as const): DashboardSnapshot {
  return {
    id: date,
    snapshot_date: date,
    metrics: { views },
    revenue_usd: null,
    revenue_basis: "estimate",
    deltas: {},
    source,
  };
}

describe("pickDeltaPair", () => {
  it("picks the latest snapshot and the one >= 28d earlier", () => {
    const snaps = [snap("2026-09-28", 1000), snap("2026-09-01", 700), snap("2026-09-20", 900)];
    const { current, prior } = pickDeltaPair(snaps);
    expect(current?.snapshot_date).toBe("2026-09-28");
    // 2026-09-01 is 27 days earlier — not enough; no honest baseline
    expect(prior).toBeNull();
  });

  it("finds a prior snapshot exactly at the window edge", () => {
    const snaps = [snap("2026-09-28", 1000), snap("2026-08-31", 700)];
    const { prior } = pickDeltaPair(snaps);
    expect(prior?.snapshot_date).toBe("2026-08-31");
  });

  it("returns nulls for empty input", () => {
    expect(pickDeltaPair([])).toEqual({ current: null, prior: null });
  });
});

describe("computeDeltas", () => {
  it("computes absolute and percent change with the vs-prior-28d label", () => {
    const deltas = computeDeltas(snap("2026-09-28", 1200), snap("2026-08-31", 1000));
    const views = deltas.find((d) => d.key === "views")!;
    expect(views.absolute).toBe(200);
    expect(views.pct).toBeCloseTo(20);
    expect(views.baselineLabel).toBe("vs prior 28d");
    expect(views.hasBaseline).toBe(true);
  });

  it("reports insufficient history instead of inventing a baseline (D137)", () => {
    const deltas = computeDeltas(snap("2026-09-28", 1200), null);
    const views = deltas.find((d) => d.key === "views")!;
    expect(views.prior).toBeNull();
    expect(views.absolute).toBeNull();
    expect(views.pct).toBeNull();
    expect(views.baselineLabel).toBe("insufficient history");
    expect(views.hasBaseline).toBe(false);
    expect(formatDelta(views)).toBe("—");
  });

  it("handles a zero prior without dividing by zero", () => {
    const deltas = computeDeltas(snap("2026-09-28", 100), snap("2026-08-31", 0));
    const views = deltas.find((d) => d.key === "views")!;
    expect(views.absolute).toBe(100);
    expect(views.pct).toBeNull();
  });
});

describe("sumMetrics", () => {
  it("sums across snapshots and defaults missing keys to 0", () => {
    const total = sumMetrics([snap("2026-09-28", 100), snap("2026-08-31", 50)]);
    expect(total.views).toBe(150);
    expect(total.likes).toBe(0);
  });
});

describe("formatCompact", () => {
  it("compacts large numbers", () => {
    expect(formatCompact(1_500_000)).toBe("1.5M");
    expect(formatCompact(45_600)).toBe("45.6K");
    expect(formatCompact(123)).toBe("123");
    expect(formatCompact(NaN)).toBe("—");
  });
});
