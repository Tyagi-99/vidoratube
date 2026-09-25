/**
 * Outlier scoring for YouTube research (P3).
 *
 * Pure functions — no network, no DB — so the math is fully unit-testable.
 * An "outlier" is a video that significantly outperformed its channel's
 * typical performance: outlier_score = views / channel_median_views.
 *
 * Tiers (industry-standard buckets):
 * - score >= 10: breakout (viral relative to channel)
 * - score >= 5:  outlier
 * - score >= 2:  strong performer
 * - score >= 0.5: normal
 * - else: underperforming
 */

export type OutlierTier =
  | "breakout"
  | "outlier"
  | "strong"
  | "normal"
  | "underperforming";

/** Median of a non-empty array; 0 for empty. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

/**
 * Outlier score: how many times the channel median this video pulled.
 * Returns 0 when the median is 0 (no baseline) so callers can treat it
 * as "no signal" rather than dividing by zero.
 */
export function outlierScore(viewCount: number, channelMedianViews: number): number {
  if (channelMedianViews <= 0 || viewCount < 0) return 0;
  return viewCount / channelMedianViews;
}

export function outlierTier(score: number): OutlierTier {
  if (score >= 10) return "breakout";
  if (score >= 5) return "outlier";
  if (score >= 2) return "strong";
  if (score >= 0.5) return "normal";
  return "underperforming";
}

/** Extract a YouTube video ID from a URL or bare ID. Returns null if unparseable. */
export function parseYouTubeVideoId(input: string): string | null {
  const s = input.trim();
  // Bare 11-char video ID
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const url = new URL(s.startsWith("http") ? s : `https://${s}`);
    const host = url.hostname.toLowerCase();
    if (host === "youtu.be") {
      const id = url.pathname.slice(1).split("/")[0];
      return /^[A-Za-z0-9_-]{11}$/.test(id ?? "") ? (id as string) : null;
    }
    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      const v = url.searchParams.get("v");
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      const m = url.pathname.match(/^\/(shorts|embed|live)\/([A-Za-z0-9_-]{11})/);
      if (m?.[2]) return m[2];
    }
  } catch {
    return null;
  }
  return null;
}

export type ChannelInput =
  | { kind: "channel_id"; value: string }
  | { kind: "handle"; value: string }
  | { kind: "url"; value: string };

/**
 * Classify a channel input: raw channel ID (UC...), @handle, or URL.
 * Resolution to a canonical channel ID happens via the YouTube Data API.
 */
export function parseChannelInput(input: string): ChannelInput | null {
  const s = input.trim();
  if (!s) return null;
  if (/^UC[A-Za-z0-9_-]{22}$/.test(s)) return { kind: "channel_id", value: s };
  if (s.startsWith("@") && s.length > 1) return { kind: "handle", value: s };
  try {
    const url = new URL(s.startsWith("http") ? s : `https://${s}`);
    if (url.hostname.toLowerCase().includes("youtube.com")) return { kind: "url", value: url.toString() };
  } catch {
    // not a URL — fall through
  }
  return null;
}

export interface TitlePatternStats {
  count: number;
  avgLength: number;
  /** Lower-cased words appearing in >= 30% of titles, excluding stopwords. */
  commonWords: string[];
  /** Fraction of titles containing a digit (numbers in titles). */
  withNumbers: number;
  /** Fraction of titles that are questions. */
  questions: number;
}

const STOPWORDS = new Set(
  "the,a,an,and,or,but,of,to,in,on,for,with,by,at,from,as,is,are,was,were,it,its,this,that,these,those,i,you,he,she,we,they,my,your,his,her,our,their,me,him,us,them,what,how,why,when,where,vs,vs.,&".split(","),
);

/** Cheap structural stats over a set of titles (LLM does the semantic work). */
export function titlePatternStats(titles: string[]): TitlePatternStats {
  const count = titles.length;
  if (count === 0) {
    return { count: 0, avgLength: 0, commonWords: [], withNumbers: 0, questions: 0 };
  }
  const avgLength = titles.reduce((a, t) => a + t.length, 0) / count;
  const wordCounts = new Map<string, number>();
  let withNumbers = 0;
  let questions = 0;
  for (const t of titles) {
    if (/\d/.test(t)) withNumbers++;
    if (t.trim().endsWith("?")) questions++;
    const words = new Set(t.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean));
    for (const w of words) {
      if (STOPWORDS.has(w)) continue;
      wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1);
    }
  }
  const commonWords = [...wordCounts.entries()]
    .filter(([, c]) => c / count >= 0.3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);
  return {
    count,
    avgLength: Math.round(avgLength * 10) / 10,
    commonWords,
    withNumbers: Math.round((withNumbers / count) * 100) / 100,
    questions: Math.round((questions / count) * 100) / 100,
  };
}

/** Quota cost estimate for a YouTube Data API import (units). */
export const YOUTUBE_QUOTA = {
  videoList: 1, // videos.list per 50 ids
  channelList: 1, // channels.list per 50 ids
  searchList: 100, // search.list — avoided; we don't use search
} as const;

export function estimateQuotaUnits(videoCount: number, channelCount: number): number {
  return (
    Math.ceil(videoCount / 50) * YOUTUBE_QUOTA.videoList +
    Math.ceil(channelCount / 50) * YOUTUBE_QUOTA.channelList
  );
}
