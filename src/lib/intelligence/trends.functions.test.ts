/**
 * Stream B — trends.functions.ts unit tests.
 * computeTrends is pure; buildTrendRadar runs against an in-memory fake.
 */
import { describe, expect, it } from "vitest";
import {
  buildTrendRadar,
  computeTrends,
  TREND_WINDOW_DAYS,
  type ResearchSourceInsert,
  type TrendDataPort,
  type VideoVelocityInput,
} from "./trends.functions";

const NOW = new Date("2026-09-28T00:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function video(over: Partial<VideoVelocityInput> = {}): VideoVelocityInput {
  return {
    videoId: "v-1",
    externalVideoId: "abc123",
    title: "The lost city of gold",
    publishedAt: daysAgo(10),
    channelTitle: "History Deep",
    viewsPerDay: 50_000,
    snapshotCount: 3,
    latestCapturedAt: daysAgo(0),
    ...over,
  };
}

describe("computeTrends", () => {
  it("ranks by views/day and normalizes the top video to 100 velocity", () => {
    const trends = computeTrends(
      [video(), video({ videoId: "v-2", externalVideoId: "def456", viewsPerDay: 5_000 })],
      10,
      NOW,
    );
    expect(trends).toHaveLength(2);
    expect(trends[0]!.id).toBe("video:abc123");
    expect(trends[0]!.factors.find((f) => f.key === "velocity")!.value).toBe(100);
    expect(trends[1]!.score0to100).toBeLessThan(trends[0]!.score0to100);
  });

  it("excludes videos with <2 snapshots, no velocity, or outside the window", () => {
    const trends = computeTrends(
      [
        video(),
        video({ videoId: "v-2", externalVideoId: "x2", viewsPerDay: null, snapshotCount: 1 }),
        video({
          videoId: "v-3",
          externalVideoId: "x3",
          publishedAt: daysAgo(TREND_WINDOW_DAYS + 5),
        }),
        video({ videoId: "v-4", externalVideoId: "x4", viewsPerDay: 0 }),
      ],
      10,
      NOW,
    );
    expect(trends).toHaveLength(1);
    expect(trends[0]!.id).toBe("video:abc123");
  });

  it("attaches a YouTube citation source to every trend", () => {
    const [t] = computeTrends([video()], 10, NOW);
    expect(t!.sources).toHaveLength(1);
    expect(t!.sources[0]!.url).toBe("https://www.youtube.com/watch?v=abc123");
    expect(t!.sources[0]!.publishedAt).toBe(daysAgo(10));
  });

  it("confidence is medium with ≥2 snapshots (contract rule)", () => {
    const [t] = computeTrends([video({ snapshotCount: 2 })], 10, NOW);
    expect(t!.confidence).toBe("medium");
  });

  it("never promises virality", () => {
    const [t] = computeTrends([video()], 10, NOW);
    expect(JSON.stringify(t)).not.toMatch(/guarantee|will go viral/i);
  });
});

describe("buildTrendRadar", () => {
  function fakePort(
    velocities: VideoVelocityInput[],
  ): TrendDataPort & { inserted: ResearchSourceInsert[] } {
    const inserted: ResearchSourceInsert[] = [];
    return {
      inserted,
      getVideoVelocity: async () => velocities,
      findRecentRadarSources: async () => new Set<string>(),
      insertResearchSources: async (_u, rows) => {
        inserted.push(...rows);
      },
    };
  }
  const nichePort = {
    getNiche: async () => ({ id: "niche-1" }),
    getNicheChannelEvidence: async () => [{ id: "ch-1" }],
  };

  it("returns insufficient_data when nothing is eligible", async () => {
    const res = await buildTrendRadar(fakePort([]), nichePort, "user-1", {}, NOW);
    expect(res.status).toBe("insufficient_data");
  });

  it("persists one research_sources row per trend with source_type video", async () => {
    const port = fakePort([
      video(),
      video({
        videoId: "v-2",
        externalVideoId: "def456",
        title: "Ancient maps decoded",
        viewsPerDay: 20_000,
      }),
    ]);
    const res = await buildTrendRadar(port, nichePort, "user-1", { max: 10 }, NOW);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.trends).toHaveLength(2);
    expect(port.inserted).toHaveLength(2);
    for (const row of port.inserted) {
      expect(row.source_type).toBe("video");
      expect(row.url).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=/);
      expect(row.metadata["generated_by"]).toBe("trend-radar");
      expect(row.metadata["trend_id"]).toMatch(/^video:/);
    }
  });

  it("dedupes sources already persisted in the last 24h", async () => {
    const port = fakePort([video()]);
    port.findRecentRadarSources = async () => new Set(["video:abc123"]);
    const res = await buildTrendRadar(port, nichePort, "user-1", {}, NOW);
    expect(res.status).toBe("ok");
    expect(port.inserted).toHaveLength(0);
  });

  it("throws for an unknown niche", async () => {
    const badNichePort = { ...nichePort, getNiche: async () => null };
    await expect(
      buildTrendRadar(fakePort([video()]), badNichePort, "user-1", { nicheId: "nope" }, NOW),
    ).rejects.toThrow("Niche not found");
  });
});
