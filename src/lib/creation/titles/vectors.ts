/**
 * Phase 6 Stream E (P3) — Viral word vectors (competitor pattern TI-6).
 *
 * The observed pattern: every word/phrase scored across the outlier videos
 * it appears in, ranked per niche, with word pairings and better-performing
 * synonyms surfaced.
 *
 * HOW VIDORA'S IMPLEMENTATION DIFFERS (D302): Vidora scores words against
 * the user's OWN tracked outlier set (`outlier_videos.outlier_score`), not a
 * platform-wide database. Scoring is deterministic and transparent —
 * median-outlier per word vs the corpus median, with a minimum-video floor —
 * and the UI presents results as packaging heuristics, never CTR predictions.
 * No per-word claim is ever made on fewer than 3 videos; the whole panel
 * reports `insufficient_data` below 10 videos.
 *
 * Pure module — no I/O, no network, no randomness.
 */

export interface WordVideo {
  title: string;
  /** Outlier multiple vs channel median (from outlier_videos.outlier_score). */
  outlierScore: number;
}

export interface WordVector {
  word: string;
  /** Number of outlier videos the word appears in. */
  videos: number;
  /** Median outlier multiple of those videos. */
  medianOutlier: number;
  /** medianOutlier / corpus median — >1 means the word skews above typical outliers. */
  lift: number;
}

export interface WordPairing {
  wordA: string;
  wordB: string;
  /** Videos where both words appear together. */
  videos: number;
  /** Median outlier of those videos. */
  medianOutlier: number;
}

/** Minimum videos a word must appear in to be scored (never score on anecdotes). */
export const WORD_MIN_VIDEOS = 3;
/** Minimum videos in the corpus before the panel shows anything. */
export const CORPUS_MIN_VIDEOS = 10;

const STOPWORDS = new Set(
  "a,an,the,and,or,but,for,nor,on,at,to,from,by,with,about,into,over,after,of,in,is,it,this,that,these,those,as,are,was,were,be,been,being,have,has,had,do,does,did,will,would,can,could,should,may,might,must,you,your,youre,they,them,their,our,we,i,me,my,how,what,why,when,where,which,who,vs,vs.,new,top,best,ever,all,just,now,today,get,got,make,made,using,use,used,one,two,first,last,more,most,than,then,so,such,no,not,only,own,same,too,very".split(
    ",",
  ),
);

/** Lowercase alphanumeric tokens, ≥3 chars, stopwords removed. Deterministic. */
export function tokenizeTitle(title: string): string[] {
  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  return [...new Set(tokens)];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Score every word appearing in ≥WORD_MIN_VIDEOS videos. `lift` is the
 * word's median outlier divided by the corpus median — transparent and
 * explainable. Sorted by lift desc (ties: videos desc, then word asc).
 */
export function computeWordVectors(videos: WordVideo[]): WordVector[] {
  const corpusScores = videos.map((v) => v.outlierScore);
  if (corpusScores.length === 0) return [];
  const corpusMedian = median(corpusScores);
  const byWord = new Map<string, number[]>();
  for (const v of videos) {
    for (const word of tokenizeTitle(v.title)) {
      const list = byWord.get(word) ?? [];
      list.push(v.outlierScore);
      byWord.set(word, list);
    }
  }
  const out: WordVector[] = [];
  for (const [word, scores] of byWord) {
    if (scores.length < WORD_MIN_VIDEOS) continue;
    const med = median(scores);
    out.push({
      word,
      videos: scores.length,
      medianOutlier: Math.round(med * 100) / 100,
      lift: corpusMedian > 0 ? Math.round((med / corpusMedian) * 100) / 100 : 0,
    });
  }
  out.sort((a, b) => b.lift - a.lift || b.videos - a.videos || a.word.localeCompare(b.word));
  return out;
}

/**
 * Word pairings: pairs co-occurring in ≥2 videos, ranked by median outlier.
 * Suggested as "words that appear together in strong outliers".
 */
export function suggestPairings(videos: WordVideo[], limit = 8): WordPairing[] {
  const pairScores = new Map<string, { a: string; b: string; scores: number[] }>();
  for (const v of videos) {
    const words = tokenizeTitle(v.title);
    for (let i = 0; i < words.length; i++) {
      for (let j = i + 1; j < words.length; j++) {
        const a = words[i] as string;
        const b = words[j] as string;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        const entry = pairScores.get(key) ?? { a: a < b ? a : b, b: a < b ? b : a, scores: [] };
        entry.scores.push(v.outlierScore);
        pairScores.set(key, entry);
      }
    }
  }
  const out: WordPairing[] = [];
  for (const { a, b, scores } of pairScores.values()) {
    if (scores.length < 2) continue;
    out.push({
      wordA: a,
      wordB: b,
      videos: scores.length,
      medianOutlier: Math.round(median(scores) * 100) / 100,
    });
  }
  out.sort(
    (x, y) => y.medianOutlier - x.medianOutlier || y.videos - x.videos,
  );
  return out.slice(0, limit);
}

export type VectorEnvelope =
  | {
      status: "ok";
      videoCount: number;
      vectors: WordVector[];
      pairings: WordPairing[];
    }
  | { status: "insufficient_data"; reason: string; videoCount: number };

/**
 * Build the honest envelope for the UI: below CORPUS_MIN_VIDEOS the panel
 * explains what to do instead of showing thin statistics.
 */
export function buildVectorEnvelope(videos: WordVideo[]): VectorEnvelope {
  if (videos.length < CORPUS_MIN_VIDEOS) {
    return {
      status: "insufficient_data",
      videoCount: videos.length,
      reason:
        `Word vectors need at least ${CORPUS_MIN_VIDEOS} tracked outlier videos ` +
        `(${videos.length} so far). Import outliers from Intelligence → Outliers to build the corpus.`,
    };
  }
  return {
    status: "ok",
    videoCount: videos.length,
    vectors: computeWordVectors(videos).slice(0, 25),
    pairings: suggestPairings(videos),
  };
}
