import { describe, expect, it } from "vitest";
import { aggregateBuckets, bucketKey, rankBuckets, type BucketVideo } from "./buckets";

function video(over: Partial<BucketVideo> & { title: string }): BucketVideo {
  return {
    youtubeVideoId: over.title,
    category: null,
    preset: null,
    views: 0,
    impressions: 0,
    ctr: 0,
    avgViewDurationS: 0,
    watchTimeMinutes: 0,
    ...over,
  };
}

describe("bucketKey", () => {
  it("derives buckets from project metadata (D138)", () => {
    expect(bucketKey("history", "documentary")).toBe("history · documentary");
  });

  it("falls back honestly when metadata is missing", () => {
    expect(bucketKey(null, null)).toBe("Uncategorized · standard");
    expect(bucketKey("  ", "")).toBe("Uncategorized · standard");
  });
});

describe("aggregateBuckets", () => {
  const videos = [
    video({ title: "a", category: "history", preset: "documentary", views: 1000, ctr: 4, watchTimeMinutes: 50 }),
    video({ title: "b", category: "history", preset: "documentary", views: 3000, ctr: 6, watchTimeMinutes: 150 }),
    video({ title: "c", category: "money", preset: "shorts", views: 500, ctr: 8, watchTimeMinutes: 10 }),
  ];

  it("groups by category + preset and ranks by total views", () => {
    const buckets = aggregateBuckets(videos);
    expect(buckets).toHaveLength(2);
    expect(buckets[0]!.bucket).toBe("history · documentary");
    expect(buckets[0]!.totalViews).toBe(4000);
    expect(buckets[0]!.avgCtr).toBe(5);
    expect(buckets[0]!.videoCount).toBe(2);
    expect(buckets[0]!.topVideoTitle).toBe("b");
    expect(buckets[0]!.thinData).toBe(false);
  });

  it("flags single-video buckets as thin data, not trends", () => {
    const buckets = aggregateBuckets(videos);
    const thin = buckets.find((b) => b.bucket === "money · shorts")!;
    expect(thin.thinData).toBe(true);
    expect(thin.videoCount).toBe(1);
  });

  it("returns an empty array for no videos", () => {
    expect(aggregateBuckets([])).toEqual([]);
  });
});

describe("rankBuckets", () => {
  const buckets = aggregateBuckets([
    video({ title: "a", category: "history", preset: "documentary", views: 1000, ctr: 2 }),
    video({ title: "b", category: "money", preset: "shorts", views: 500, ctr: 9 }),
  ]);

  it("re-ranks by CTR when asked", () => {
    const ranked = rankBuckets(buckets, "avgCtr");
    expect(ranked[0]!.bucket).toBe("money · shorts");
  });

  it("defaults to total views", () => {
    expect(rankBuckets(buckets)[0]!.bucket).toBe("history · documentary");
  });
});
