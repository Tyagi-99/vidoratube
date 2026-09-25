/**
 * SEO studio: title scoring, description building, tag suggestions.
 * Pure functions — no I/O, fully unit-tested.
 */

export interface TitleScore {
  title: string;
  /** 0-100 weighted total. */
  score: number;
  breakdown: {
    /** Ideal 40-60 chars for search + display. */
    length: number;
    /** Primary keyword present early. */
    keyword: number;
    /** Curiosity gap / emotional hook without clickbait lies. */
    curiosity: number;
    /** Clear promise of what the viewer gets. */
    clarity: number;
  };
}

const CURIOSITY_PATTERNS = [
  /\b(how|why|what|when|secret|truth|mistake|nobody|never|always)\b/i,
  /\b(\d+)\b/, // numbers signal concrete value
  /[?!]/,
];
const CLICKBAIT_PATTERNS = [
  /\b(you won't believe|shocking|gone wrong|100% free|click here)\b/i,
];

/**
 * Scores a title against a primary keyword. Deterministic — the LLM proposes,
 * this function ranks. Clickbait patterns are penalized hard.
 */
export function scoreTitle(title: string, primaryKeyword: string): TitleScore {
  const t = title.trim();
  const len = t.length;

  // Length: 40-60 ideal, taper off both sides.
  let length = 100;
  if (len < 20) length = Math.max(0, (len / 20) * 100);
  else if (len > 70) length = Math.max(0, 100 - (len - 70) * 4);
  else if (len < 40) length = 70 + ((len - 20) / 20) * 30;
  length = Math.round(length);

  // Keyword: present + early is best.
  const kwLower = primaryKeyword.trim().toLowerCase();
  const idx = t.toLowerCase().indexOf(kwLower);
  let keyword = 0;
  if (kwLower && idx >= 0) keyword = idx <= 10 ? 100 : idx <= 25 ? 70 : 40;

  // Curiosity: pattern matches, capped.
  const curiosityHits = CURIOSITY_PATTERNS.filter((p) => p.test(t)).length;
  let curiosity = Math.min(100, curiosityHits * 40);

  // Clarity: has a verb-ish promise and isn't just keywords stuffed.
  const words = t.split(/\s+/).filter(Boolean);
  let clarity = words.length >= 4 && words.length <= 12 ? 80 : 50;
  if (/\b(vs|how to|guide|explained|review)\b/i.test(t)) clarity = Math.min(100, clarity + 20);

  // Clickbait penalty.
  if (CLICKBAIT_PATTERNS.some((p) => p.test(t))) {
    curiosity = Math.min(curiosity, 20);
    clarity = Math.min(clarity, 30);
  }

  const score = Math.round(length * 0.25 + keyword * 0.3 + curiosity * 0.2 + clarity * 0.25);
  return { title: t, score, breakdown: { length, keyword, curiosity, clarity } };
}

/** Ranks candidate titles best-first. */
export function rankTitles(titles: string[], primaryKeyword: string): TitleScore[] {
  return titles
    .map((t) => scoreTitle(t, primaryKeyword))
    .sort((a, b) => b.score - a.score);
}

export interface DescriptionInput {
  hook: string;
  summary: string;
  chapters: { time: string; label: string }[];
  cta?: string;
  hashtags: string[];
}

/** Builds a YouTube description: hook + summary + chapters + CTA + hashtags. */
export function buildDescription(input: DescriptionInput): string {
  const parts: string[] = [input.hook.trim(), "", input.summary.trim()];
  if (input.chapters.length > 0) {
    parts.push(
      "",
      "CHAPTERS:",
      ...input.chapters.map((c) => `${c.time} ${c.label}`),
    );
  }
  if (input.cta?.trim()) parts.push("", input.cta.trim());
  const tags = input.hashtags
    .map((h) => (h.startsWith("#") ? h : `#${h}`))
    .slice(0, 5);
  if (tags.length > 0) parts.push("", tags.join(" "));
  return parts.join("\n").slice(0, 4900);
}

/**
 * Suggests tags: niche keywords + outlier-derived terms, deduped, lowercase,
 * YouTube's 500-char total limit respected.
 */
export function suggestTags(nicheKeywords: string[], outlierTerms: string[], maxTotal = 500): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let total = 0;
  for (const raw of [...nicheKeywords, ...outlierTerms]) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, " ");
    if (!tag || tag.length > 60 || seen.has(tag)) continue;
    if (total + tag.length + 1 > maxTotal) break;
    seen.add(tag);
    out.push(tag);
    total += tag.length + 1;
  }
  return out;
}
