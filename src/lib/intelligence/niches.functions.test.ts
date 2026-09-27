/**
 * Stream B — niches.functions.ts unit tests.
 * Business logic runs against an in-memory NicheDataPort fake:
 * no Supabase, no network. Server-fn wrappers themselves are thin.
 */
import { describe, expect, it } from "vitest";
import {
  applyNicheFilters,
  recomputeNicheScore,
  slugify,
  toChannelCard,
  type ChannelEvidence,
  type NicheDataPort,
  type NicheRow,
  type NicheSnapshotMetrics,
} from "./niches.functions";
import { buildBlueprint, buildBlueprintStats } from "./blueprints.functions";
import type { NicheScore } from "./types";

const NOW = new Date("2026-09-28T00:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function niche(over: Partial<NicheRow> = {}): NicheRow {
  return {
    id: "niche-1",
    user_id: "user-1",
    name: "History Mysteries",
    slug: "history-mysteries",
    enabled: true,
    keywords: ["history", "mysteries"],
    hashtags: [],
    search_queries: [],
    target_platforms: ["youtube"],
    min_views: 0,
    preferred_format: "both",
    preferred_language: "en",
    scoring_weights: null,
    blueprint: null,
    min_subs: null,
    max_subs: null,
    active_only: false,
    require_recent_activity: false,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...over,
  };
}

function evidence(over: Partial<ChannelEvidence> = {}): ChannelEvidence {
  return {
    id: "ch-1",
    externalChannelId: "UCx",
    handle: "@test",
    title: "Test Channel",
    subscriberCount: 50_000,
    videoCount: 200,
    viewCount: 5_000_000,
    growth7dPct: 4,
    lastSnapshotAt: daysAgo(1),
    recentVideoAt: daysAgo(2),
    ...over,
  };
}

function fakePort(
  over: Partial<NicheDataPort> = {},
): NicheDataPort & { snapshots: { score: NicheScore; metrics: NicheSnapshotMetrics }[] } {
  const snapshots: { score: NicheScore; metrics: NicheSnapshotMetrics }[] = [];
  const port: NicheDataPort & {
    snapshots: { score: NicheScore; metrics: NicheSnapshotMetrics }[];
  } = {
    snapshots,
    getNiche: async () => niche(),
    listNiches: async () => [niche()],
    insertNiche: async (row) => niche(row as Partial<NicheRow>),
    updateNiche: async () => {},
    deleteNiche: async () => {},
    nicheSlugExists: async () => false,
    getLatestScores: async () => ({}),
    listNicheSnapshots: async () => [],
    insertNicheSnapshot: async (_u, _n, score, metrics) => {
      snapshots.push({ score, metrics });
    },
    getNicheChannelEvidence: async () => [evidence(), evidence({ id: "ch-2" })],
    countRecentVideos: async () => 42,
    ...over,
  };
  return port;
}

describe("slugify", () => {
  it("lowercases and dasherizes", () => {
    expect(slugify("History Mysteries!")).toBe("history-mysteries");
    expect(slugify("  AI & Money  ")).toBe("ai-money");
    expect(slugify("")).toBe("niche");
  });
});

describe("applyNicheFilters", () => {
  const base = {
    min_subs: null,
    max_subs: null,
    active_only: false,
    require_recent_activity: false,
  };

  it("includes everything when no filters set", () => {
    const r = applyNicheFilters(base, [evidence(), evidence({ id: "ch-2" })], NOW);
    expect(r.included).toHaveLength(2);
    expect(r.excluded).toBe(0);
  });

  it("honors the subs band", () => {
    const r = applyNicheFilters(
      { ...base, min_subs: 10_000, max_subs: 100_000 },
      [
        evidence(),
        evidence({ id: "big", subscriberCount: 2_000_000 }),
        evidence({ id: "tiny", subscriberCount: 500 }),
      ],
      NOW,
    );
    expect(r.included.map((e) => e.id)).toEqual(["ch-1"]);
    expect(r.excluded).toBe(2);
  });

  it("activeOnly drops channels with stale snapshots", () => {
    const r = applyNicheFilters(
      { ...base, active_only: true },
      [
        evidence(),
        evidence({ id: "stale", lastSnapshotAt: daysAgo(30) }),
        evidence({ id: "never", lastSnapshotAt: null }),
      ],
      NOW,
    );
    expect(r.included.map((e) => e.id)).toEqual(["ch-1"]);
    expect(r.excluded).toBe(2);
  });

  it("requireRecentActivity drops channels with no recent uploads", () => {
    const r = applyNicheFilters(
      { ...base, require_recent_activity: true },
      [evidence(), evidence({ id: "quiet", recentVideoAt: daysAgo(60) })],
      NOW,
    );
    expect(r.included.map((e) => e.id)).toEqual(["ch-1"]);
    expect(r.excluded).toBe(1);
  });
});

describe("recomputeNicheScore", () => {
  it("returns insufficient_data when no channels are linked", async () => {
    const port = fakePort({ getNicheChannelEvidence: async () => [] });
    const res = await recomputeNicheScore(port, "user-1", "niche-1", NOW);
    expect(res.status).toBe("insufficient_data");
    if (res.status === "insufficient_data") expect(res.reason).toMatch(/no tracked channels/i);
    expect(port.snapshots).toHaveLength(0);
  });

  it("returns insufficient_data when filters exclude everything", async () => {
    const port = fakePort({
      getNiche: async () => niche({ min_subs: 10_000_000 }),
    });
    const res = await recomputeNicheScore(port, "user-1", "niche-1", NOW);
    expect(res.status).toBe("insufficient_data");
    if (res.status === "insufficient_data") expect(res.reason).toMatch(/excluded/i);
    expect(port.snapshots).toHaveLength(0);
  });

  it("scores and persists a niche_snapshots row with score jsonb", async () => {
    const port = fakePort();
    const res = await recomputeNicheScore(port, "user-1", "niche-1", NOW);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.score.score0to100).toBeGreaterThan(0);
    expect(res.score.factors).toHaveLength(4);
    expect(res.score.source).toBe("youtube-data-api");
    expect(res.score.channelCount).toBe(2);
    expect(res.channelCount).toBe(2);
    expect(res.excludedByFilters).toBe(0);
    expect(port.snapshots).toHaveLength(1);
    const saved = port.snapshots[0]!.score as NicheScore;
    expect(saved.factors.map((f) => f.key)).toEqual([
      "demand",
      "competition",
      "velocity",
      "freshness",
    ]);
    expect(port.snapshots[0]!.metrics.videosPublished7d).toBe(42);
  });

  it("honors custom scoring weights from the niche row", async () => {
    const port = fakePort({
      getNiche: async () =>
        niche({ scoring_weights: { demand: 10, competition: 1, velocity: 1, freshness: 1 } }),
    });
    const res = await recomputeNicheScore(port, "user-1", "niche-1", NOW);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") throw new Error("expected ok");
    const demand = res.score.factors.find((f) => f.key === "demand")!;
    expect(demand.weight).toBeCloseTo(10 / 13, 5);
  });

  it("throws when the niche does not belong to the user", async () => {
    const port = fakePort({ getNiche: async () => null });
    await expect(recomputeNicheScore(port, "user-1", "nope", NOW)).rejects.toThrow(
      "Niche not found",
    );
  });
});

describe("toChannelCard", () => {
  it("attaches a 72h freshness window", () => {
    const c = toChannelCard(evidence());
    expect(c.freshness).toEqual({ capturedAt: evidence().lastSnapshotAt, staleAfterHours: 72 });
  });
});

describe("buildBlueprint", () => {
  it("is deterministic and rule-based", () => {
    const n = niche();
    const stats = buildBlueprintStats([evidence(), evidence({ id: "ch-2", growth7dPct: 8 })]);
    const a = buildBlueprint(n, stats, NOW);
    const b = buildBlueprint(n, stats, NOW);
    expect(a).toEqual(b);
    expect(a.method).toBe("rule-based");
    expect(a.pillars.length).toBeGreaterThanOrEqual(2);
    expect(a.pillars.length).toBeLessThanOrEqual(5);
    expect(a.pillars[0]!.exampleTitles).toHaveLength(3);
    expect(a.cadence.videosPerWeek).toBeGreaterThanOrEqual(1);
    expect(a.positioning).toMatch(/history/i);
    expect(JSON.stringify(a)).not.toMatch(/guarantee|viral|will earn/i);
  });

  it("falls back to the niche name when keywords are empty", () => {
    const b = buildBlueprint(niche({ keywords: [] }), buildBlueprintStats([]), NOW);
    expect(b.pillars).toHaveLength(1);
    expect(b.pillars[0]!.name).toMatch(/History Mysteries/);
  });
});
