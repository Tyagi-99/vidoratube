import { describe, expect, it } from "vitest";
import {
  ageInDays,
  buildWeeklyDigest,
  channelAverages,
  detectOwnOutliers,
  isSnapshotDay,
  retentionPercent,
  snapshotDateKey,
  styleCorrelations,
  topPerformers,
  vsAverage,
  type VideoPerformance,
} from "./video-performance";

function vid(overrides: Partial<VideoPerformance> = {}): VideoPerformance {
  return {
    youtubeVideoId: "abc123",
    title: "Test video",
    hook: "Did you know?",
    style: "cinematic",
    publishedAt: "2026-09-01T00:00:00Z",
    metrics: {
      views: 1000,
      impressions: 10_000,
      ctr: 5,
      avgViewDurationSec: 120,
      videoDurationSec: 300,
      watchTimeMinutes: 2000,
      likes: 50,
      comments: 10,
      subsGained: 5,
    },
    ...overrides,
  };
}

describe("retentionPercent", () => {
  it("computes retention from duration", () => {
    const v = vid();
    expect(retentionPercent(v.metrics)).toBeCloseTo(40, 5);
  });
  it("returns 0 for zero duration", () => {
    const v = vid({ metrics: { ...vid().metrics, videoDurationSec: 0 } });
    expect(retentionPercent(v.metrics)).toBe(0);
  });
  it("caps at 100", () => {
    const v = vid({ metrics: { ...vid().metrics, avgViewDurationSec: 9999 } });
    expect(retentionPercent(v.metrics)).toBe(100);
  });
});

describe("vsAverage", () => {
  it("computes ratio and pct above", () => {
    expect(vsAverage(1500, 1000)).toEqual({ ratio: 1.5, pctAbove: 50 });
  });
  it("returns zeros when channel average is 0", () => {
    expect(vsAverage(1500, 0)).toEqual({ ratio: 0, pctAbove: 0 });
  });
});

describe("channelAverages", () => {
  it("returns zeros for empty input", () => {
    expect(channelAverages([]).videoCount).toBe(0);
  });
  it("averages metrics across videos", () => {
    const avg = channelAverages([vid(), vid({ metrics: { ...vid().metrics, views: 3000, ctr: 7 } })]);
    expect(avg.videoCount).toBe(2);
    expect(avg.avgViews).toBe(2000);
    expect(avg.medianViews).toBe(2000);
    expect(avg.avgCtr).toBeCloseTo(6, 5);
  });
});

describe("detectOwnOutliers", () => {
  it("flags 5x+ videos as outliers", () => {
    const base = Array.from({ length: 6 }, (_, i) =>
      vid({ youtubeVideoId: `v${i}`, metrics: { ...vid().metrics, views: 1000 } }),
    );
    const star = vid({ youtubeVideoId: "star", title: "Star", metrics: { ...vid().metrics, views: 6000 } });
    const out = detectOwnOutliers([...base, star]);
    expect(out).toHaveLength(1);
    expect(out[0]!.tier).toBe("outlier");
    expect(out[0]!.youtubeVideoId).toBe("star");
  });
  it("ignores 2x videos (not outlier-worthy)", () => {
    const base = Array.from({ length: 6 }, (_, i) =>
      vid({ youtubeVideoId: `v${i}`, metrics: { ...vid().metrics, views: 1000 } }),
    );
    const strong = vid({ youtubeVideoId: "strong", metrics: { ...vid().metrics, views: 2500 } });
    expect(detectOwnOutliers([...base, strong])).toHaveLength(0);
  });
  it("returns empty when there is no baseline", () => {
    expect(detectOwnOutliers([])).toHaveLength(0);
  });
});

describe("styleCorrelations", () => {
  it("finds styles with positive CTR lift", () => {
    const videos = [
      ...Array.from({ length: 3 }, (_, i) =>
        vid({ youtubeVideoId: `c${i}`, style: "cinematic", metrics: { ...vid().metrics, ctr: 8 } }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        vid({ youtubeVideoId: `a${i}`, style: "anime", metrics: { ...vid().metrics, ctr: 2 } }),
      ),
    ];
    const corr = styleCorrelations(videos);
    expect(corr[0]!.style).toBe("cinematic");
    expect(corr[0]!.ctrLiftPoints).toBeGreaterThan(0);
  });
  it("requires a minimum number of videos per style", () => {
    const videos = [vid({ style: "rare", metrics: { ...vid().metrics, ctr: 20 } })];
    expect(styleCorrelations(videos, 3)).toHaveLength(0);
  });
});

describe("topPerformers", () => {
  it("sorts by views descending and limits", () => {
    const videos = [vid({ youtubeVideoId: "a", metrics: { ...vid().metrics, views: 100 } }), vid({ youtubeVideoId: "b", metrics: { ...vid().metrics, views: 500 } })];
    expect(topPerformers(videos, 1)[0]!.youtubeVideoId).toBe("b");
  });
});

describe("buildWeeklyDigest", () => {
  it("returns hasEnoughData=false when data is thin", () => {
    const d = buildWeeklyDigest([vid()]);
    expect(d.hasEnoughData).toBe(false);
    expect(d.suggestions).toHaveLength(0);
    expect(d.topVideo).toBeNull();
  });
  it("builds a digest with up to 3 suggestions", () => {
    const base = Array.from({ length: 5 }, (_, i) =>
      vid({ youtubeVideoId: `v${i}`, title: `Video ${i}`, metrics: { ...vid().metrics, views: 1000 } }),
    );
    const star = vid({ youtubeVideoId: "star", title: "Star video", metrics: { ...vid().metrics, views: 8000, ctr: 9 } });
    const d = buildWeeklyDigest([...base, star]);
    expect(d.hasEnoughData).toBe(true);
    expect(d.topVideo!.youtubeVideoId).toBe("star");
    expect(d.suggestions.length).toBeGreaterThan(0);
    expect(d.suggestions.length).toBeLessThanOrEqual(3);
  });
});

describe("snapshot helpers", () => {
  it("snapshotDateKey is a YYYY-MM-DD string", () => {
    expect(snapshotDateKey(new Date("2026-09-25T12:00:00Z"))).toBe("2026-09-25");
  });
  it("ageInDays floors to whole days", () => {
    expect(ageInDays("2026-09-24T00:00:00Z", new Date("2026-09-25T12:00:00Z"))).toBe(1);
  });
  it("isSnapshotDay is true only on day 1 and 7", () => {
    expect(isSnapshotDay(1)).toBe(true);
    expect(isSnapshotDay(7)).toBe(true);
    expect(isSnapshotDay(0)).toBe(false);
    expect(isSnapshotDay(3)).toBe(false);
    expect(isSnapshotDay(30)).toBe(false);
  });
});
