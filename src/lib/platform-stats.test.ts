import { describe, expect, it } from "vitest";
import {
  computeViewsWindows,
  parseMetricsPayload,
  type PlatformStatsSnapshot,
} from "./platform-stats";

function snap(hoursAgo: number, views: number): PlatformStatsSnapshot {
  return {
    capturedAt: new Date(Date.now() - hoursAgo * 3600_000).toISOString(),
    views,
    likes: 10,
    comments: 2,
    watchTimeMinutes: 30,
  };
}

describe("computeViewsWindows", () => {
  it("returns hasData:false for no snapshots", () => {
    const r = computeViewsWindows([]);
    expect(r.hasData).toBe(false);
    expect(r.latest).toBeNull();
    expect(r.views24h).toBeNull();
    expect(r.views7d).toBeNull();
  });

  it("computes 24h and 7d deltas from daily snapshots", () => {
    // latest now; baselines at ~24h and ~7d ago.
    const r = computeViewsWindows([
      snap(24 * 7, 1000),
      snap(24, 8000),
      snap(0, 9000),
    ]);
    expect(r.hasData).toBe(true);
    expect(r.latest?.views).toBe(9000);
    expect(r.views24h?.delta).toBe(1000);
    expect(r.views7d?.delta).toBe(8000);
  });

  it("returns null windows when no baseline exists yet (honest empty)", () => {
    const r = computeViewsWindows([snap(0, 500)]);
    expect(r.hasData).toBe(true);
    expect(r.views24h).toBeNull();
    expect(r.views7d).toBeNull();
  });

  it("ignores snapshots outside the baseline tolerance", () => {
    // Only a 12h-old snapshot: too far from the 24h mark (>6h tolerance).
    const r = computeViewsWindows([snap(12, 700), snap(0, 900)]);
    expect(r.views24h).toBeNull();
  });

  it("clamps negative deltas (snapshot corrections) to 0", () => {
    const r = computeViewsWindows([snap(24, 9000), snap(0, 8500)]);
    expect(r.views24h?.delta).toBe(0);
  });

  it("ignores invalid timestamps and sorts unordered input", () => {
    const r = computeViewsWindows([
      snap(0, 9000),
      { ...snap(24, 8000), capturedAt: "not-a-date" },
      snap(25, 7500),
    ]);
    expect(r.views24h?.delta).toBe(1500);
  });
});

describe("parseMetricsPayload", () => {
  it("parses a metrics JSONB payload, defaulting missing fields to 0", () => {
    const s = parseMetricsPayload(
      { views: 123, likes: "45", watch_time_minutes: 67.5 },
      "2026-09-26T00:00:00Z",
    );
    expect(s.views).toBe(123);
    expect(s.likes).toBe(45);
    expect(s.comments).toBe(0);
    expect(s.watchTimeMinutes).toBe(67.5);
  });

  it("rejects negative and non-numeric values", () => {
    const s = parseMetricsPayload({ views: -5, likes: "junk" }, "2026-09-26T00:00:00Z");
    expect(s.views).toBe(0);
    expect(s.likes).toBe(0);
  });
});
