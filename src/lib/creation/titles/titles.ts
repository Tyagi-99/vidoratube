/**
 * Stream A — F14 Title Lab: deterministic title variant generation + scoring.
 *
 * D94 applies: generation is template-based and deterministic (no LLM), the
 * TitleScore is explainable factor-by-factor, and the UI must present scores
 * as packaging heuristics — NEVER as CTR predictions. Stats discipline:
 * impressions/ctr on `title_variants` are measured values only.
 *
 * Pure module — no I/O, no network, no randomness. Server functions in
 * `titles.functions.ts` persist the results.
 */
import { type TitleScore } from "../contracts";
import { applyTitleFormat, fillsForTopic, getTitleFormat } from "./formats";

/* ------------------------------------------------------------------ */
/* Variant generation                                                  */
/* ------------------------------------------------------------------ */

export interface TitleGenInput {
  /** Working title or topic, e.g. "night trains". */
  topic: string;
  /** Optional keywords to weave in (keyword factor evidence). */
  keywords?: string[];
  /** Max variants to emit (default 10). */
  maxVariants?: number;
  /**
   * Optional pinned format id (Phase 6 Stream E, TI-3 pattern). When set,
   * variants come from the format's slot fills instead of the generic
   * template list. Deterministic, no LLM.
   */
  formatId?: string | undefined;
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * Deterministic template expansion over the topic/keywords. Identical inputs
 * → identical variants in identical order. Dedupe keeps the list clean when
 * the topic already contains a template phrase.
 */
export function generateTitleVariants(input: TitleGenInput): string[] {
  const topic = titleCase(input.topic.trim());
  if (!topic) return [];
  const kw = (input.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  const keyword = kw[0] ? titleCase(kw[0]!) : topic;

  // Format mode: deterministic slot fills from the pinned library.
  if (input.formatId) {
    const format = getTitleFormat(input.formatId);
    if (!format) return [];
    const fills = fillsForTopic(format, topic, keyword);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const fill of fills) {
      const t = applyTitleFormat(format, fill.values);
      // Skip fills that left unfilled slots (e.g. formats whose example
      // slots need more than one word).
      if (/\[[^\]]+\]/.test(t)) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
      if (out.length >= (input.maxVariants ?? 10)) break;
    }
    return out;
  }

  const templates: Array<() => string> = [
    () => `${topic}: What Nobody Tells You`,
    () => `I Tried ${topic} for 30 Days`,
    () => `${keyword} — The Untold Story`,
    () => `Why ${topic} Actually Matters`,
    () => `7 ${keyword} Facts That Will Surprise You`,
    () => `The Truth About ${topic}`,
    () => `${topic} Explained in 10 Minutes`,
    () => `Stop Doing ${topic} Wrong`,
    () => `Is ${topic} Worth It?`,
    () => `${topic} [Full Breakdown]`,
    () => `What I Learned From ${topic}`,
    () => `${keyword}: Beginner to Pro`,
  ];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const build of templates) {
    const t = build().replace(/\s+/g, " ").trim();
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= (input.maxVariants ?? 10)) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* TitleScore computation                                              */
/* ------------------------------------------------------------------ */

const POWER_WORDS = [
  "secret",
  "truth",
  "mistake",
  "warning",
  "shocking",
  "hidden",
  "banned",
  "exposed",
  "untold",
  "free",
  "proven",
  "ultimate",
  "insane",
  "brutal",
  "honest",
];

function lengthScore(title: string, weakEvidence: string[]): number {
  const len = title.length;
  if (len >= 40 && len <= 60) return 25;
  if (len >= 30 && len < 40) return 20;
  if (len > 60 && len <= 80) return 18;
  if (len >= 20 && len < 30) return 14;
  if (len > 80 && len <= 100) return 10;
  weakEvidence.push(
    `length: ${len} chars is outside the 40–60 character sweet spot for YouTube titles`,
  );
  return len < 20 ? 8 : 5;
}

function keywordScore(title: string, keywords: string[], weakEvidence: string[]): number {
  if (keywords.length === 0) {
    weakEvidence.push("keyword: no keyword corpus provided — score is neutral, not an assessment");
    return 12;
  }
  const lower = title.toLowerCase();
  const hits = keywords.filter((k) => k.trim() && lower.includes(k.trim().toLowerCase()));
  const frac = hits.length / keywords.length;
  if (hits.length === 0) {
    weakEvidence.push(`keyword: none of [${keywords.join(", ")}] appear in the title`);
  }
  return Math.round(frac * 25);
}

function curiosityScore(title: string): number {
  let s = 0;
  const lower = title.toLowerCase();
  if (/\?/.test(title)) s += 6;
  if (/\d/.test(title)) s += 5;
  if (/\[.*?\]|\(.*?\)/.test(title)) s += 4;
  if (/\b(you|your|you're)\b/.test(lower)) s += 4;
  const powers = POWER_WORDS.filter((w) => lower.includes(w));
  s += Math.min(6, powers.length * 3);
  return Math.min(25, s);
}

function clarityScore(title: string, weakEvidence: string[]): number {
  let s = 25;
  const words = title.split(/\s+/).filter(Boolean);
  const allCaps = words.filter((w) => w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w));
  if (allCaps.length > 0) {
    s -= Math.min(10, allCaps.length * 5);
    weakEvidence.push(`clarity: ${allCaps.length} ALL-CAPS word(s) hurt readability`);
  }
  const punct = (title.match(/[!?.,:;\-—]{2,}/g) ?? []).length + (title.match(/!/g) ?? []).length;
  if (punct > 0) {
    s -= Math.min(8, punct * 2);
    weakEvidence.push("clarity: excessive punctuation (!!!, …) reads as clickbait");
  }
  if (words.length > 14) {
    s -= 8;
    weakEvidence.push(`clarity: ${words.length} words is long for a title — consider trimming`);
  } else if (words.length < 3) {
    s -= 8;
    weakEvidence.push("clarity: under 3 words — too vague to set expectations");
  }
  return Math.max(0, s);
}

export interface ScoreTitleInput {
  title: string;
  /** Optional keyword corpus; empty → neutral score + weakEvidence. */
  keywords?: string[];
}

/**
 * Score one title variant against the pinned TitleScore contract.
 * Heuristic packaging assessment — explicitly not a CTR prediction.
 */
export function scoreTitle(input: ScoreTitleInput): TitleScore {
  const keywords = (input.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  const weakEvidence: string[] = [];
  const factors = {
    length: lengthScore(input.title, weakEvidence),
    keyword: keywordScore(input.title, keywords, weakEvidence),
    curiosity: curiosityScore(input.title),
    clarity: clarityScore(input.title, weakEvidence),
  };
  const total = factors.length + factors.keyword + factors.curiosity + factors.clarity;
  return { total, factors, weakEvidence };
}

/**
 * Score a batch deterministically and rank by total (stable: ties keep
 * generation order).
 */
export function scoreTitleBatch(
  titles: string[],
  keywords: string[] = [],
): Array<{ title: string; score: TitleScore }> {
  return titles
    .map((title, index) => ({ title, score: scoreTitle({ title, keywords }), index }))
    .sort((a, b) => b.score.total - a.score.total || a.index - b.index)
    .map(({ title, score }) => ({ title, score }));
}
