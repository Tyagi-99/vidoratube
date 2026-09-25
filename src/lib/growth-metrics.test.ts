import { describe, expect, it } from "vitest";
import {
  computeActivation,
  computeCohortRetention,
  computeConversion,
  computeMrr,
  computeP95RenderTimePerMinute,
  computePublishing,
  computeRenderSuccess,
  computeSignups,
  RENDER_SUCCESS_TARGET,
  type ProfileRow,
} from "./growth-metrics";

const NOW = new Date("2026-09-26T00:00:00Z");
const iso = (daysAgo: number) =>
  new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();

function profile(id: string, daysAgo: number): ProfileRow {
  return { id, created_at: iso(daysAgo) };
}

describe("computeSignups", () => {
  it("counts signups and groups by month", () => {
    const r = computeSignups([
      profile("a", 60), // 2026-07
      profile("b", 40), // 2026-08
      profile("c", 10), // 2026-09
      profile("d", 5),
    ]);
    expect(r.hasData).toBe(true);
    expect(r.total).toBe(4);
    expect(r.byMonth).toEqual([
      { month: "2026-07", count: 1 },
      { month: "2026-08", count: 1 },
      { month: "2026-09", count: 2 },
    ]);
  });

  it("is empty when there are no profiles", () => {
    const r = computeSignups([]);
    expect(r.hasData).toBe(false);
    expect(r.total).toBe(0);
  });
});

describe("computeActivation", () => {
  it("counts activation within 24h, excluding users too new to judge", () => {
    const profiles = [
      profile("active", 10), // completed 5h after signup
      profile("late", 10), // completed 30h after signup
      profile("never", 10), // never completed
      profile("newborn", 0.1), // signed up 2.4h ago — excluded
    ];
    const firstCompletedAt = new Map([
      ["active", iso(10 - 5 / 24)],
      ["late", iso(10 - 30 / 24)],
    ]);
    const r = computeActivation({ profiles, firstCompletedAt }, NOW);
    expect(r.hasData).toBe(true);
    expect(r.totalUsers).toBe(3);
    expect(r.activated).toBe(1);
    expect(r.rate).toBeCloseTo(1 / 3);
  });

  it("hasData is false when nobody is old enough", () => {
    const r = computeActivation(
      { profiles: [profile("x", 0.1)], firstCompletedAt: new Map() },
      NOW,
    );
    expect(r.hasData).toBe(false);
    expect(r.rate).toBeNull();
  });
});

describe("computeCohortRetention", () => {
  it("computes D7/D30 on day-window activity", () => {
    const profiles = [
      profile("u1", 40), // active on day 7 and day 30
      profile("u2", 40), // active on day 7 only
      profile("u3", 40), // inactive
      profile("u4", 10), // too young for D30, eligible for D7
    ];
    const activityAt = new Map<string, string[]>([
      ["u1", [iso(40 - 7.2), iso(40 - 30.5)]],
      ["u2", [iso(40 - 7.5)]],
      ["u4", [iso(10 - 7.1)]],
    ]);
    const r = computeCohortRetention({ profiles, activityAt }, NOW);
    expect(r.hasData).toBe(true);
    expect(r.d7.eligible).toBe(4);
    expect(r.d7.active).toBe(3);
    expect(r.d7.rate).toBeCloseTo(0.75);
    expect(r.d30.eligible).toBe(3);
    expect(r.d30.active).toBe(1);
    expect(r.d30.rate).toBeCloseTo(1 / 3);
  });

  it("is empty when no cohort is old enough", () => {
    const r = computeCohortRetention(
      { profiles: [profile("x", 3)], activityAt: new Map() },
      NOW,
    );
    expect(r.hasData).toBe(false);
    expect(r.d7.rate).toBeNull();
    expect(r.d30.rate).toBeNull();
  });
});

describe("computeConversion", () => {
  it("computes free-to-paid share", () => {
    const r = computeConversion(100, new Set(["a", "b", "c"]));
    expect(r.rate).toBeCloseTo(0.03);
    expect(r.paidUsers).toBe(3);
  });

  it("handles zero users honestly", () => {
    const r = computeConversion(0, new Set());
    expect(r.hasData).toBe(false);
    expect(r.rate).toBeNull();
  });
});

describe("computeMrr", () => {
  const plans = [
    { slug: "creator", priceUsdCents: 1900, interval: "month" as const },
    { slug: "studio", priceUsdCents: 4900, interval: "month" as const },
    { slug: "pack_s", priceUsdCents: 900, interval: "once" as const },
  ];

  it("sums monthly plan prices for active/trialing subscriptions only", () => {
    const r = computeMrr(
      [
        { user_id: "a", plan_slug: "creator", status: "active" },
        { user_id: "b", plan_slug: "studio", status: "trialing" },
        { user_id: "c", plan_slug: "pack_s", status: "active" }, // one-time: excluded
        { user_id: "d", plan_slug: "creator", status: "canceled" }, // inactive: excluded
        { user_id: "e", plan_slug: "ghost", status: "active" }, // unknown plan: excluded
      ],
      plans,
    );
    expect(r.hasData).toBe(true);
    expect(r.mrrUsd).toBe(68); // 19 + 49
    expect(r.activeSubscriptions).toBe(2);
    expect(r.byPlan).toEqual([
      { slug: "studio", count: 1, mrrUsd: 49 },
      { slug: "creator", count: 1, mrrUsd: 19 },
    ]);
  });

  it("is empty with no active subscriptions", () => {
    const r = computeMrr([], plans);
    expect(r.hasData).toBe(false);
    expect(r.mrrUsd).toBe(0);
  });
});

describe("computeRenderSuccess", () => {
  it("uses terminal outcomes only; target is 98%", () => {
    expect(RENDER_SUCCESS_TARGET).toBe(0.98);
    const r = computeRenderSuccess([
      ...Array.from({ length: 98 }, () => ({ status: "completed" })),
      { status: "failed" },
      { status: "failed" },
      { status: "queued" }, // not terminal: excluded
      { status: "running" }, // not terminal: excluded
    ]);
    expect(r.hasData).toBe(true);
    expect(r.total).toBe(100);
    expect(r.successRate).toBeCloseTo(0.98);
  });

  it("is empty with no terminal renders", () => {
    const r = computeRenderSuccess([{ status: "queued" }]);
    expect(r.hasData).toBe(false);
    expect(r.successRate).toBeNull();
  });
});

describe("computeP95RenderTimePerMinute", () => {
  it("computes p95 wall-clock minutes per output minute", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      // each render: 2 output minutes, wall time grows 2..21 min
      render_started_at: iso(1),
      render_completed_at: new Date(
        NOW.getTime() - 86_400_000 + (i + 2) * 60000,
      ).toISOString(),
      duration: 120,
    }));
    const r = computeP95RenderTimePerMinute(rows);
    expect(r.hasData).toBe(true);
    expect(r.samples).toBe(20);
    // p95 of ratios (i+2)/2 for i in 0..19 -> ratio at index ceil(0.95*20)-1 = 18 -> 20/2 = 10
    expect(r.p95MinutesPerOutputMinute).toBeCloseTo(10);
  });

  it("skips rows without usable timestamps/durations", () => {
    const r = computeP95RenderTimePerMinute([
      { render_started_at: null, render_completed_at: iso(1), duration: 60 },
      { render_started_at: iso(1), render_completed_at: iso(2), duration: 60 }, // end < start
      { render_started_at: iso(2), render_completed_at: iso(1), duration: 0 },
    ]);
    expect(r.hasData).toBe(false);
    expect(r.p95MinutesPerOutputMinute).toBeNull();
  });
});

describe("computePublishing", () => {
  it("computes published, localized %, languages and shorts per long", () => {
    const r = computePublishing(
      [
        { id: "j1", project_id: "p1" },
        { id: "j2", project_id: "p2" },
        { id: "j3", project_id: "p3" },
      ],
      [
        { project_id: "p1", language: "hi", status: "completed" },
        { project_id: "p1", language: "es", status: "completed" },
        { project_id: "p2", language: "hi", status: "failed" }, // failed: not localized
        { project_id: "p1", language: "hi", status: "completed" }, // dup language: distinct
      ],
      [
        { status: "completed", parentId: "r1", kind: "short" },
        { status: "completed", parentId: "r1", kind: "short" },
        { status: "completed", parentId: "r2", kind: "short" },
        { status: "failed", parentId: "r2", kind: "short" },
      ],
    );
    expect(r.hasData).toBe(true);
    expect(r.videosPublished).toBe(3);
    expect(r.localizedCount).toBe(1);
    expect(r.localizedPct).toBeCloseTo(1 / 3);
    expect(r.avgLanguagesPerPublishedVideo).toBe(2);
    expect(r.shortsGenerated).toBe(3);
    expect(r.shortsPerLongVideo).toBe(1.5); // 3 shorts / 2 parent renders
  });

  it("returns nulls (not zeros) with no data", () => {
    const r = computePublishing([], [], []);
    expect(r.hasData).toBe(false);
    expect(r.localizedPct).toBeNull();
    expect(r.avgLanguagesPerPublishedVideo).toBeNull();
    expect(r.shortsPerLongVideo).toBeNull();
  });
});
