import { describe, expect, it } from "vitest";
import {
  attributeCosts,
  buildRoiReport,
  usdAtPlanRates,
  type LedgerEntry,
  type RenderRef,
} from "./roi";

function entry(over: Partial<LedgerEntry>): LedgerEntry {
  return { delta: -5, ref_id: null, reason: "test", created_at: "2026-09-28T00:00:00Z", ...over };
}

describe("attributeCosts", () => {
  const renders: RenderRef[] = [
    { id: "r1", project_id: "p1", job_id: "j1" },
    { id: "r2", project_id: "p1", job_id: "j1" }, // second aspect, same job
    { id: "r3", project_id: "p2", job_id: "j2" },
  ];
  const projectIds = new Set(["p1", "p2", "p3"]);

  it("attributes render-id refs to their project", () => {
    const a = attributeCosts([entry({ ref_id: "r1" })], renders, projectIds);
    expect(a.byProject.get("p1")?.credits).toBe(5);
  });

  it("attributes video-job refs via renders.job_id", () => {
    const a = attributeCosts([entry({ ref_id: "j2", delta: -7 })], renders, projectIds);
    expect(a.byProject.get("p2")?.credits).toBe(7);
  });

  it("attributes legacy project-id refs directly", () => {
    const a = attributeCosts([entry({ ref_id: "p3", reason: "legacy 1-credit" })], renders, projectIds);
    expect(a.byProject.get("p3")?.credits).toBe(5);
  });

  it("nets refunds against debits (net cost, never double-counted)", () => {
    const a = attributeCosts(
      [entry({ ref_id: "r1", delta: -10 }), entry({ ref_id: "r1", delta: 10, reason: "refund" })],
      renders,
      projectIds,
    );
    expect(a.byProject.get("p1")?.credits).toBe(0);
  });

  it("reports unattributable rows honestly instead of dropping them", () => {
    const a = attributeCosts(
      [entry({ ref_id: "ghost", delta: -4 }), entry({ ref_id: null, delta: -2 })],
      renders,
      projectIds,
    );
    expect(a.unattributedCredits).toBe(6);
    expect(a.unattributedEntries).toBe(2);
    expect(a.byProject.size).toBe(0);
  });

  it("totals everything", () => {
    const a = attributeCosts(
      [entry({ ref_id: "r1", delta: -5 }), entry({ ref_id: null, delta: -3 })],
      renders,
      projectIds,
    );
    expect(a.totalCredits).toBe(8);
  });
});

describe("usdAtPlanRates", () => {
  it("converts credits to USD at each plan's effective rate", () => {
    const rows = usdAtPlanRates(60);
    const creator = rows.find((r) => r.planSlug === "creator")!;
    // Creator: $19 / 60 credits → 60 credits = $19
    expect(creator.usd).toBeCloseTo(19, 2);
    const studio = rows.find((r) => r.planSlug === "studio")!;
    // Studio: $49 / 200 credits → 60 credits = $14.70
    expect(studio.usd).toBeCloseTo(14.7, 2);
  });
});

describe("buildRoiReport", () => {
  it("joins cost to outcome and computes an ESTIMATE ROI multiple", () => {
    const attribution = attributeCosts(
      [entry({ ref_id: "r1", delta: -60 })],
      [{ id: "r1", project_id: "p1", job_id: "j1" }],
      new Set(["p1"]),
    );
    const report = buildRoiReport(
      attribution,
      [{ projectId: "p1", youtubeVideoId: "yt1", title: "Hit", views: 100_000, watchTimeMinutes: 5000 }],
      4, // $4 RPM
    );
    const row = report.videos[0]!;
    expect(row.credits).toBe(60);
    expect(row.views).toBe(100_000);
    expect(row.revenueEstimateUsd).toBe(400); // 100k views × $4 RPM
    // cost at Studio rate: 60 × $0.245 = $14.70 → ROI ≈ 27.2x (estimate!)
    expect(row.roiMultipleEstimate).toBeCloseTo(400 / 14.7, 1);
    expect(report.totals.revenueEstimateUsd).toBe(400);
  });

  it("leaves revenue null when no RPM is set", () => {
    const report = buildRoiReport(
      { byProject: new Map(), unattributedCredits: 0, unattributedEntries: 0, totalCredits: 0 },
      [{ projectId: "p9", youtubeVideoId: "yt9", title: "Free", views: 1000, watchTimeMinutes: 10 }],
      null,
    );
    expect(report.videos[0]!.revenueEstimateUsd).toBeNull();
    expect(report.videos[0]!.roiMultipleEstimate).toBeNull();
    expect(report.hasData).toBe(true);
  });
});
