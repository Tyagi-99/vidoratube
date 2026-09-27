/**
 * Stream B — scoring.ts unit tests.
 * Pure math, fixed fixtures, no network, no DB, fully deterministic.
 */
import { describe, expect, it } from "vitest";
import {
  FRESHNESS_HOURS,
  resolveWeights,
  scoreNicheOpportunity,
  type ChannelCardInput,
  type NicheInput,
  type ScoreInput,
} from "./scoring";

const NOW = new Date("2026-09-28T00:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function channel(over: Partial<ChannelCardInput> = {}): ChannelCardInput {
  return {
    id: "ch-1",
    externalChannelId: "UCx",
    handle: "@test",
    title: "Test Channel",
    subscriberCount: 50_000,
    videoCount: 200,
    viewCount: 5_000_000,
    growth7dPct: 4.0,
    lastSnapshotAt: hoursAgo(5),
    ...over,
  };
}

const niche: NicheInput = {
  id: "n-1",
  name: "History Mysteries",
  keywords: ["history", "mysteries"],
};

function input(over: Partial<ScoreInput> = {}): ScoreInput {
  return {
    niche,
    channels: [channel(), channel({ id: "ch-2", growth7dPct: 6.0, lastSnapshotAt: hoursAgo(2) })],
    videosPublished7d: 120,
    now: NOW,
    ...over,
  };
}

describe("scoreNicheOpportunity", () => {
  it("is deterministic: same input → identical output", () => {
    const a = scoreNicheOpportunity(input());
    const b = scoreNicheOpportunity(input());
    expect(a).toEqual(b);
  });

  it("always returns four named factors with weights summing to 1", () => {
    const s = scoreNicheOpportunity(input());
    expect(s.factors.map((f) => f.key)).toEqual(["demand", "competition", "velocity", "freshness"]);
    const sum = s.factors.reduce((a, f) => a + f.weight, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(s.score0to100).toBeGreaterThanOrEqual(0);
    expect(s.score0to100).toBeLessThanOrEqual(100);
    expect(s.source).toBe("youtube-data-api");
    expect(s.channelCount).toBe(2);
    expect(s.capturedAt).toBe(NOW.toISOString());
  });

  it("demand grows with published-video volume (log scale)", () => {
    const low = scoreNicheOpportunity(input({ videosPublished7d: 0 }));
    const mid = scoreNicheOpportunity(input({ videosPublished7d: 120 }));
    const high = scoreNicheOpportunity(input({ videosPublished7d: 2000 }));
    const dv = (s: ReturnType<typeof scoreNicheOpportunity>) =>
      s.factors.find((f) => f.key === "demand")!;
    expect(dv(low).value).toBe(0);
    expect(dv(low).evidenceCount).toBe(0);
    expect(dv(mid).value).toBeGreaterThan(dv(low).value);
    expect(dv(high).value).toBeGreaterThan(dv(mid).value);
    expect(dv(high).value).toBeLessThanOrEqual(100);
  });

  it("competition is inverse to channel density", () => {
    const empty = scoreNicheOpportunity(input({ channels: [] }));
    const few = scoreNicheOpportunity(input());
    const many = scoreNicheOpportunity(
      input({ channels: Array.from({ length: 60 }, (_, i) => channel({ id: `c${i}` })) }),
    );
    const cv = (s: ReturnType<typeof scoreNicheOpportunity>) =>
      s.factors.find((f) => f.key === "competition")!;
    expect(cv(empty).value).toBe(100);
    expect(cv(empty).evidenceCount).toBe(0);
    expect(cv(few).value).toBeGreaterThan(cv(many).value);
    expect(cv(many).value).toBe(0);
  });

  it("velocity uses median 7d growth (robust to an outlier)", () => {
    const s = scoreNicheOpportunity(
      input({
        channels: [
          channel({ growth7dPct: 4 }),
          channel({ id: "c2", growth7dPct: 6 }),
          channel({ id: "c3", growth7dPct: 100 }), // viral outlier — median should ignore it
        ],
      }),
    );
    const v = s.factors.find((f) => f.key === "velocity")!;
    expect(v.value).toBe(48); // median 6 → 6*8
    expect(v.evidenceCount).toBe(3);
  });

  it("velocity is weak with no growth data", () => {
    const s = scoreNicheOpportunity(input({ channels: [channel({ growth7dPct: null })] }));
    const v = s.factors.find((f) => f.key === "velocity")!;
    expect(v.value).toBe(0);
    expect(v.evidenceCount).toBe(0);
  });

  it("freshness counts snapshots within the 72h horizon", () => {
    const s = scoreNicheOpportunity(
      input({
        channels: [
          channel({ lastSnapshotAt: hoursAgo(5) }),
          channel({ id: "c2", lastSnapshotAt: hoursAgo(FRESHNESS_HOURS + 10) }),
          channel({ id: "c3", lastSnapshotAt: null }),
        ],
      }),
    );
    const f = s.factors.find((f) => f.key === "freshness")!;
    expect(f.evidenceCount).toBe(2);
    expect(f.value).toBe(50);
  });

  it("confidence downgrades one level per zero-evidence factor", () => {
    // 10 channels → base "high", but no videos published and no growth data
    // → demand + velocity weak → down two levels → "low".
    const chs = Array.from({ length: 10 }, (_, i) =>
      channel({ id: `c${i}`, growth7dPct: null, lastSnapshotAt: hoursAgo(5) }),
    );
    const s = scoreNicheOpportunity(input({ channels: chs, videosPublished7d: 0 }));
    expect(s.confidence).toBe("low");
  });

  it("empty niche scores with low confidence and weak-evidence flags", () => {
    const s = scoreNicheOpportunity(input({ channels: [], videosPublished7d: 0 }));
    expect(s.confidence).toBe("low");
    expect(s.channelCount).toBe(0);
    expect(s.factors.filter((f) => f.evidenceCount === 0).length).toBeGreaterThanOrEqual(3);
  });

  it("detail strings never promise outcomes", () => {
    const s = scoreNicheOpportunity(input());
    for (const f of s.factors) {
      expect(f.detail).not.toMatch(/guarantee|viral|will earn/i);
    }
  });
});

describe("resolveWeights", () => {
  it("returns defaults when no overrides", () => {
    expect(resolveWeights(null)).toEqual({
      demand: 0.3,
      competition: 0.25,
      velocity: 0.25,
      freshness: 0.2,
    });
    expect(resolveWeights(undefined)).toEqual(resolveWeights(null));
    expect(resolveWeights({})).toEqual(resolveWeights(null));
  });

  it("applies partial overrides and normalizes to sum 1", () => {
    const w = resolveWeights({ demand: 2, competition: 1 });
    const total = 2 + 1 + 0.25 + 0.2; // overridden keys + untouched defaults
    expect(w.demand).toBeCloseTo(2 / total, 10);
    expect(w.competition).toBeCloseTo(1 / total, 10);
    expect(w.velocity).toBeCloseTo(0.25 / total, 10);
    expect(w.freshness).toBeCloseTo(0.2 / total, 10);
    expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it("ignores invalid override values", () => {
    expect(resolveWeights({ demand: -5, velocity: NaN })).toEqual(resolveWeights(null));
    expect(resolveWeights({ bogus: 10 })).toEqual(resolveWeights(null));
  });
});
