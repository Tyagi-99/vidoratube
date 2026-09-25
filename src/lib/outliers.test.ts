import { describe, expect, it } from "vitest";
import {
  estimateQuotaUnits,
  median,
  outlierScore,
  outlierTier,
  parseChannelInput,
  parseYouTubeVideoId,
  titlePatternStats,
} from "./outliers";

describe("median", () => {
  it("returns 0 for empty input", () => {
    expect(median([])).toBe(0);
  });
  it("handles odd and even lengths", () => {
    expect(median([5])).toBe(5);
    expect(median([1, 3, 5])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([10, 1, 9])).toBe(9); // unsorted input
  });
});

describe("outlierScore", () => {
  it("computes views / median", () => {
    expect(outlierScore(50_000, 10_000)).toBe(5);
    expect(outlierScore(100_000, 10_000)).toBe(10);
  });
  it("returns 0 when there is no baseline", () => {
    expect(outlierScore(50_000, 0)).toBe(0);
    expect(outlierScore(50_000, -5)).toBe(0);
  });
  it("returns 0 for negative views", () => {
    expect(outlierScore(-1, 10_000)).toBe(0);
  });
});

describe("outlierTier", () => {
  it("buckets scores into standard tiers", () => {
    expect(outlierTier(25)).toBe("breakout");
    expect(outlierTier(10)).toBe("breakout");
    expect(outlierTier(9.9)).toBe("outlier");
    expect(outlierTier(5)).toBe("outlier");
    expect(outlierTier(4.9)).toBe("strong");
    expect(outlierTier(2)).toBe("strong");
    expect(outlierTier(1.9)).toBe("normal");
    expect(outlierTier(0.5)).toBe("normal");
    expect(outlierTier(0.49)).toBe("underperforming");
    expect(outlierTier(0)).toBe("underperforming");
  });
});

describe("parseYouTubeVideoId", () => {
  const ID = "dQw4w9WgXcQ";
  it("accepts a bare ID", () => {
    expect(parseYouTubeVideoId(ID)).toBe(ID);
  });
  it("parses watch, youtu.be, shorts, embed URLs", () => {
    expect(parseYouTubeVideoId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(parseYouTubeVideoId(`https://youtu.be/${ID}`)).toBe(ID);
    expect(parseYouTubeVideoId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
    expect(parseYouTubeVideoId(`https://www.youtube.com/embed/${ID}`)).toBe(ID);
    expect(parseYouTubeVideoId(`https://www.youtube.com/watch?v=${ID}&t=30s`)).toBe(ID);
  });
  it("rejects garbage", () => {
    expect(parseYouTubeVideoId("not a url")).toBeNull();
    expect(parseYouTubeVideoId("https://example.com/")).toBeNull();
    expect(parseYouTubeVideoId("short")).toBeNull();
  });
});

describe("parseChannelInput", () => {
  it("classifies channel IDs, handles, and URLs", () => {
    const cid = "UC" + "a".repeat(22);
    expect(parseChannelInput(cid)).toEqual({ kind: "channel_id", value: cid });
    expect(parseChannelInput("@somehandle")).toEqual({ kind: "handle", value: "@somehandle" });
    expect(parseChannelInput("https://www.youtube.com/@somehandle")).toEqual({
      kind: "url",
      value: "https://www.youtube.com/@somehandle",
    });
  });
  it("rejects empty input", () => {
    expect(parseChannelInput("")).toBeNull();
    expect(parseChannelInput("   ")).toBeNull();
  });
});

describe("titlePatternStats", () => {
  it("finds common words and structural signals", () => {
    const stats = titlePatternStats([
      "7 Money Mistakes Beginners Make",
      "5 Money Habits of Millionaires",
      "Why Money Won't Make You Happy?",
    ]);
    expect(stats.count).toBe(3);
    expect(stats.commonWords).toContain("money");
    expect(stats.withNumbers).toBeCloseTo(2 / 3, 2);
    expect(stats.questions).toBeCloseTo(1 / 3, 2);
  });
  it("handles empty input", () => {
    expect(titlePatternStats([])).toEqual({
      count: 0,
      avgLength: 0,
      commonWords: [],
      withNumbers: 0,
      questions: 0,
    });
  });
});

describe("estimateQuotaUnits", () => {
  it("batches per 50 ids", () => {
    expect(estimateQuotaUnits(3, 1)).toBe(2); // 1 video call + 1 channel call
    expect(estimateQuotaUnits(51, 1)).toBe(3); // 2 video calls + 1 channel call
    expect(estimateQuotaUnits(0, 0)).toBe(0);
  });
});
