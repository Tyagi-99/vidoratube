/**
 * Phase 4 Stream D — comment intelligence primitives.
 *
 * Rule-based baseline (D136): deterministic, no network, no fabricated
 * confidence. If an LLM classifier is added later (e.g. via the Lovable AI
 * gateway), its outputs MUST be labeled "AI analysis" per the pinned
 * contracts — this module never claims to be AI.
 */

export type Sentiment = "positive" | "neutral" | "negative" | "mixed";

const POSITIVE_WORDS = [
  "love",
  "loved",
  "loves",
  "amazing",
  "awesome",
  "great",
  "excellent",
  "fantastic",
  "brilliant",
  "perfect",
  "best",
  "beautiful",
  "incredible",
  "wonderful",
  "outstanding",
  "superb",
  "impressive",
  "thank",
  "thanks",
  "helpful",
  "useful",
  "insightful",
  "genius",
  "masterpiece",
  "fire",
  "goat",
  "legend",
  "subscribed",
  "deserved",
  "underrated",
];

const NEGATIVE_WORDS = [
  "hate",
  "hated",
  "terrible",
  "awful",
  "worst",
  "bad",
  "boring",
  "stupid",
  "dumb",
  "trash",
  "garbage",
  "useless",
  "clickbait",
  "scam",
  "fake",
  "disappointing",
  "disappointed",
  "cringe",
  "annoying",
  "skip",
  "unsubscribed",
  "overrated",
  "mid",
  "lame",
  "wrong",
  "incorrect",
];

const QUESTION_STARTERS = [
  "what",
  "when",
  "where",
  "which",
  "who",
  "whom",
  "whose",
  "why",
  "how",
  "can",
  "could",
  "would",
  "will",
  "should",
  "do",
  "does",
  "did",
  "is",
  "are",
  "was",
  "were",
  "has",
  "have",
  "may",
  "might",
];

const QUESTION_PHRASES = [
  "how to",
  "how do i",
  "how can i",
  "please explain",
  "can you explain",
  "what is",
  "what are",
  "is there a",
  "does anyone know",
  "anyone know",
  "need help",
  "confused about",
];

/** Audience-request patterns: the viewer asks for future content. */
const REQUEST_PATTERNS: RegExp[] = [
  /\b(can|could) you (please )?(make|do|cover|try|explain|talk about|create)\b/i,
  /\bplease (make|do|cover|try|explain|create) (a |an )?(video|episode|part)/i,
  /\bwould love (a |an )?(video|episode|part|series) (on|about)/i,
  /\bdo a (video|episode|part|series) (on|about)/i,
  /\bnext (video|episode|part).{0,20}(on|about|should be)\b/i,
  /\bvideo (idea|suggestion|request)\b/i,
  /\bpart ?2\b/i,
];

function countMatches(text: string, words: string[]): number {
  const lower = ` ${text.toLowerCase()} `;
  let n = 0;
  for (const w of words) {
    // Word-boundary-ish match on the padded string.
    if (
      lower.includes(` ${w} `) ||
      lower.includes(` ${w},`) ||
      lower.includes(` ${w}.`) ||
      lower.includes(` ${w}!`) ||
      lower.includes(` ${w}?`) ||
      lower.includes(` ${w}:`) ||
      lower.endsWith(` ${w}`)
    ) {
      n++;
    }
  }
  return n;
}

/**
 * Rule-based sentiment. Returns "mixed" when positive and negative signals
 * are both strong; "neutral" when nothing fires.
 */
export function classifySentiment(text: string): Sentiment {
  const body = (text ?? "").trim();
  if (!body) return "neutral";
  const pos = countMatches(body, POSITIVE_WORDS);
  const neg = countMatches(body, NEGATIVE_WORDS);
  if (pos > 0 && neg > 0 && Math.min(pos, neg) >= Math.max(pos, neg) - 1) return "mixed";
  if (pos > neg) return "positive";
  if (neg > pos) return "negative";
  return "neutral";
}

/** True when the comment looks like a question the creator could answer. */
export function isQuestion(text: string): boolean {
  const body = (text ?? "").trim();
  if (!body) return false;
  if (body.includes("?")) return true;
  const lower = body.toLowerCase();
  for (const p of QUESTION_PHRASES) {
    if (lower.includes(p)) return true;
  }
  const firstWord = lower.split(/[\s,.!;:]+/)[0] ?? "";
  return QUESTION_STARTERS.includes(firstWord);
}

export interface AudienceRequest {
  /** Short topic extracted around the request pattern. */
  topic: string;
  /** The matched pattern, for auditability. */
  pattern: string;
}

/**
 * Detects "make a video about X" style audience requests.
 * Returns null when the comment is not a request. The topic is a best-effort
 * slice of the original text — never invented.
 */
export function mineAudienceRequest(text: string): AudienceRequest | null {
  const body = (text ?? "").trim();
  if (!body) return null;
  for (const re of REQUEST_PATTERNS) {
    const m = body.match(re);
    if (m && m.index !== undefined) {
      // Topic = the ~80 chars after the matched pattern, trimmed at a
      // sentence boundary. Sourced from the comment, never invented.
      const after = body.slice(m.index + m[0].length).trim();
      const topic =
        after
          .split(/[.!?\n]/)[0]
          ?.trim()
          .slice(0, 120) ?? "";
      return {
        topic: topic || "(no topic given)",
        pattern: m[0].trim(),
      };
    }
  }
  return null;
}
