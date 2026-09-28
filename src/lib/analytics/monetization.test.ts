import { describe, expect, it } from "vitest";
import {
  estimateRevenueUsd,
  formatRevenue,
  revenueLabel,
  summarizeMonetization,
} from "./monetization";

describe("estimateRevenueUsd", () => {
  it("computes views/1000 × RPM", () => {
    expect(estimateRevenueUsd(10_000, 4)).toBe(40);
    expect(estimateRevenueUsd(0, 4)).toBe(0);
  });

  it("never returns negative or NaN", () => {
    expect(estimateRevenueUsd(-5, 4)).toBe(0);
    expect(estimateRevenueUsd(NaN, 4)).toBe(0);
    expect(estimateRevenueUsd(100, -2)).toBe(0);
  });
});

describe("revenueLabel", () => {
  it("allows measured only for real platform sources", () => {
    expect(revenueLabel("measured", "youtube_analytics", 12.5)).toBe("measured");
    expect(revenueLabel("measured", "meta_insights", 12.5)).toBe("measured");
  });

  it("demotes fixture 'measured' rows to estimate — fixture data is never measured", () => {
    expect(revenueLabel("measured", "fixture", 12.5)).toBe("estimate");
  });

  it("labels estimate-basis rows as estimate and nulls as unavailable", () => {
    expect(revenueLabel("estimate", "youtube_analytics", 12.5)).toBe("estimate");
    expect(revenueLabel("measured", "youtube_analytics", null)).toBe("unavailable");
  });
});

describe("formatRevenue", () => {
  it("bakes the honesty label into the string", () => {
    expect(formatRevenue(40, "estimate")).toBe("$40.00 (ESTIMATE)");
    expect(formatRevenue(40, "measured")).toBe("$40.00 (measured)");
    expect(formatRevenue(null, "unavailable")).toBe("—");
  });
});

describe("summarizeMonetization", () => {
  const settings = { rpmEstimateUsd: 4, cpmEstimateUsd: null, currency: "usd" as const };

  it("sums measured revenue only from honestly-measured rows", () => {
    const s = summarizeMonetization(
      [
        { snapshot_date: "2026-09-28", metrics: { views: 10000 }, revenue_usd: 30, revenue_basis: "measured", source: "youtube_analytics" },
        { snapshot_date: "2026-09-27", metrics: { views: 5000 }, revenue_usd: 99, revenue_basis: "measured", source: "fixture" },
      ],
      [],
      settings,
    );
    expect(s.measuredRevenueUsd).toBe(30); // fixture row excluded
    expect(s.rows[1]!.label).toBe("estimate");
    expect(s.estimatedRevenueUsd).toBe(60); // 15000 views × $4 RPM
  });

  it("returns null estimated revenue when no RPM is set (never $0)", () => {
    const s = summarizeMonetization(
      [{ snapshot_date: "2026-09-28", metrics: { views: 10000 }, revenue_usd: null, revenue_basis: "estimate", source: "youtube_analytics" }],
      [{ youtubeVideoId: "v1", title: "T", views: 10000 }],
      { rpmEstimateUsd: null, cpmEstimateUsd: null, currency: "usd" },
    );
    expect(s.estimatedRevenueUsd).toBeNull();
    expect(s.videoEstimates[0]!.estimatedRevenueUsd).toBeNull();
  });
});
