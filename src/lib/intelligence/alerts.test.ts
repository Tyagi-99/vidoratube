/**
 * Phase 6 Stream E (P1) — Watchtower alerts: pure evaluation tests.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateAlertRules,
  validateAlertRule,
  type AlertRuleType,
  type EvalContext,
} from "./alerts";

function baseRule(overrides: Partial<EvalContext["rules"][number]> = {}): EvalContext["rules"][number] {
  return {
    id: "rule-1",
    name: "Breakout watch",
    ruleType: "breakout_video",
    channelId: null,
    folderId: null,
    isActive: true,
    conditions: { minOutlier: 2, lookbackDays: 7 },
    folderChannelIds: [],
    ...overrides,
  };
}

function baseCtx(overrides: Partial<EvalContext> = {}): EvalContext {
  return {
    rules: [],
    channels: [
      { id: "ch-a", title: "Channel A", tracked: true },
      { id: "ch-b", title: "Channel B", tracked: true },
    ],
    videos: [
      {
        id: "v-1",
        channelId: "ch-a",
        title: "I Survived 50 Hours Buried Alive",
        publishedAt: "2026-09-26T10:00:00.000Z",
        latestViews: 500_000,
        outlierScore: 4.2,
      },
      {
        id: "v-2",
        channelId: "ch-a",
        title: "A quiet history documentary",
        publishedAt: "2026-09-20T10:00:00.000Z",
        latestViews: 50_000,
        outlierScore: 1.1,
      },
      {
        id: "v-3",
        channelId: "ch-b",
        title: "I gave away a private island",
        publishedAt: "2026-09-27T10:00:00.000Z",
        latestViews: 2_000_000,
        outlierScore: 6.8,
      },
    ],
    latestSnapshots: [
      {
        channelId: "ch-a",
        capturedAt: "2026-09-27T10:00:00.000Z",
        subscriberCount: 120_000,
        viewCount: 10_000_000,
        videoCount: 100,
      },
      {
        channelId: "ch-b",
        capturedAt: "2026-09-27T10:00:00.000Z",
        subscriberCount: 80_000,
        viewCount: 5_000_000,
        videoCount: 50,
      },
    ],
    nowIso: "2026-09-28T11:00:00.000Z",
    ...overrides,
  };
}

describe("validateAlertRule", () => {
  it("accepts a valid breakout rule", () => {
    expect(
      validateAlertRule({
        name: "Breakouts",
        ruleType: "breakout_video",
        conditions: { minOutlier: 2, lookbackDays: 7 },
      }),
    ).toEqual([]);
  });

  it("rejects minOutlier below 1.2 and bad lookback", () => {
    const errors = validateAlertRule({
      name: "x",
      ruleType: "breakout_video",
      conditions: { minOutlier: 1.0, lookbackDays: 400 },
    });
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects invalid regex for title_pattern", () => {
    const errors = validateAlertRule({
      name: "titles",
      ruleType: "title_pattern",
      conditions: { pattern: "([", lookbackDays: 7 },
    });
    expect(errors.some((e) => e.includes("regular expression"))).toBe(true);
  });

  it("rejects a growth rule with no conditions set", () => {
    const errors = validateAlertRule({
      name: "growth",
      ruleType: "growth_condition",
      conditions: { minSubscribers: null, minAvgViews: null },
    });
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects scope set to both channel and folder", () => {
    const errors = validateAlertRule({
      name: "x",
      ruleType: "breakout_video",
      channelId: "11111111-1111-1111-1111-111111111111",
      folderId: "22222222-2222-2222-2222-222222222222",
      conditions: { minOutlier: 2, lookbackDays: 7 },
    });
    expect(errors.some((e) => e.includes("one channel or one folder"))).toBe(true);
  });
});

describe("evaluateAlertRules — breakout_video", () => {
  it("fires for videos above the outlier threshold within the lookback", () => {
    const fires = evaluateAlertRules(baseCtx({ rules: [baseRule()] }));
    const videoIds = fires.map((f) => f.videoId);
    expect(videoIds).toContain("v-1");
    expect(videoIds).toContain("v-3");
    expect(videoIds).not.toContain("v-2");
  });

  it("ignores videos outside the lookback window", () => {
    const fires = evaluateAlertRules(
      baseCtx({ rules: [baseRule({ conditions: { minOutlier: 1.0, lookbackDays: 2 } })] }),
    );
    // v-1 published Sep 26 is outside a 2-day lookback; v-3 (Sep 27) is inside.
    expect(fires.map((f) => f.videoId)).toEqual(["v-3"]);
  });

  it("skips inactive rules", () => {
    const fires = evaluateAlertRules(baseCtx({ rules: [baseRule({ isActive: false })] }));
    expect(fires).toEqual([]);
  });

  it("scopes to a single channel when channelId is set", () => {
    const fires = evaluateAlertRules(
      baseCtx({ rules: [baseRule({ channelId: "ch-b", name: "scoped" })] }),
    );
    expect(fires.every((f) => f.channelId === "ch-b")).toBe(true);
    expect(fires.map((f) => f.videoId)).toEqual(["v-3"]);
  });

  it("scopes to folder members", () => {
    const fires = evaluateAlertRules(
      baseCtx({
        rules: [
          baseRule({ folderId: "folder-1", name: "folder watch", folderChannelIds: ["ch-a"] }),
        ],
      }),
    );
    expect(fires.every((f) => f.channelId === "ch-a")).toBe(true);
  });

  it("emits a stable dedup key per rule+video", () => {
    const fires = evaluateAlertRules(baseCtx({ rules: [baseRule()] }));
    const fire = fires.find((f) => f.videoId === "v-1");
    expect(fire?.dedupKey).toBe("alert:rule-1:v-1");
  });
});

describe("evaluateAlertRules — title_pattern", () => {
  const titleRule = (): EvalContext["rules"][number] =>
    baseRule({
      id: "rule-t",
      name: "Title watch",
      ruleType: "title_pattern" as AlertRuleType,
      conditions: { pattern: "gave away", lookbackDays: 7 },
    });

  it("fires when a recent title matches the pattern (case-insensitive)", () => {
    const fires = evaluateAlertRules(baseCtx({ rules: [titleRule()] }));
    expect(fires.map((f) => f.videoId)).toEqual(["v-3"]);
  });

  it("never throws on a stored invalid regex — returns no fires", () => {
    const bad = titleRule();
    bad.conditions = { pattern: "([", lookbackDays: 7 };
    const firesBad = evaluateAlertRules(baseCtx({ rules: [bad] }));
    expect(firesBad).toEqual([]);
  });
});

describe("evaluateAlertRules — growth_condition", () => {
  const growthRule = (minSubscribers: number | null, minAvgViews: number | null) =>
    baseRule({
      id: "rule-g",
      name: "Growth",
      ruleType: "growth_condition" as AlertRuleType,
      conditions: { minSubscribers, minAvgViews },
    });

  it("fires when both compound conditions hold", () => {
    // ch-a: 120k subs, avg views = (500k+50k)/2 = 275k → passes 100k AND 50k
    const fires = evaluateAlertRules(baseCtx({ rules: [growthRule(100_000, 50_000)] }));
    expect(fires.map((f) => f.channelId)).toEqual(["ch-a"]);
  });

  it("does not fire when one condition fails", () => {
    const fires = evaluateAlertRules(baseCtx({ rules: [growthRule(200_000, 50_000)] }));
    expect(fires).toEqual([]);
  });

  it("works with a single condition (minAvgViews only)", () => {
    const fires = evaluateAlertRules(baseCtx({ rules: [growthRule(null, 1_000_000)] }));
    // ch-a avg 275k < 1M, ch-b avg 2M ≥ 1M
    expect(fires.map((f) => f.channelId)).toEqual(["ch-b"]);
  });
});
