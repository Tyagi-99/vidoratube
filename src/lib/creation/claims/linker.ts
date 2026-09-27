/**
 * F11 — claim extraction + source linking.
 *
 * DELIBERATELY rule-based and deterministic (D94): sentence splitting with
 * fact-like hint scoring, and keyword-overlap linking of each claim to the
 * project's canvas sources. No LLM, no credits, no invented evidence.
 *
 * Honesty contract: `extractClaimCandidates` returns CANDIDATES — sentences
 * that *look* factual. A candidate is not a verdict; only a human reviewer's
 * confirm/waive in the Evidence Desk changes review_state (never auto-set).
 */
import type { ClaimCandidate } from "./types";

export type LinkableSource = {
  id: string;
  title: string;
  url: string | null;
  excerpt: string;
};

/** Split text into sentences on . ! ? boundaries (keeps the delimiter). */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

type FactHint = { pattern: RegExp; reason: string; weight: number };

/** Heuristic hints that a sentence makes a checkable factual claim. */
const FACT_HINTS: FactHint[] = [
  { pattern: /\d/, reason: "contains a number", weight: 0.35 },
  { pattern: /\b(19|20)\d{2}\b/, reason: "mentions a year", weight: 0.2 },
  { pattern: /%|percent\b/i, reason: "contains a percentage", weight: 0.15 },
  {
    pattern: /\b(study|studies|research|researchers|scientists|survey|report|paper)\b/i,
    reason: "cites research",
    weight: 0.25,
  },
  {
    pattern: /\b(according to|reported|found that|discovered|revealed|announced)\b/i,
    reason: "attributes a finding",
    weight: 0.2,
  },
  {
    pattern: /\b(first|only|largest|smallest|oldest|newest|most|least)\b/i,
    reason: "makes a superlative claim",
    weight: 0.2,
  },
  { pattern: /"[^"]+"/, reason: "contains a quotation", weight: 0.1 },
  {
    pattern: /\b(cause[sd]?|because|due to|leads to|results in)\b/i,
    reason: "asserts causation",
    weight: 0.1,
  },
];

/** Minimum words for a sentence to be considered (fragments are not claims). */
const MIN_WORDS = 4;

/**
 * Extract candidate factual claims from script text.
 *
 * Pure + deterministic. Sentences matching at least one hint become
 * candidates with a 0..1 score and human-readable reasons. `sourceIds` are
 * pre-linked via `linkClaimsToSources` when sources are available; pass []
 * and link later.
 */
export function extractClaimCandidates(text: string): Omit<ClaimCandidate, "matchedSourceIds">[] {
  const out: Omit<ClaimCandidate, "matchedSourceIds">[] = [];
  for (const sentence of splitSentences(text)) {
    const words = sentence.split(/\s+/).filter(Boolean);
    if (words.length < MIN_WORDS) continue;
    const reasons: string[] = [];
    let score = 0;
    for (const hint of FACT_HINTS) {
      if (hint.pattern.test(sentence)) {
        reasons.push(hint.reason);
        score += hint.weight;
      }
    }
    if (reasons.length === 0) continue;
    out.push({ text: sentence, score: Math.min(1, Math.round(score * 100) / 100), reasons });
  }
  return out;
}

const STOPWORDS = new Set(
  "a,an,the,and,or,but,if,then,else,when,at,by,for,with,about,into,through,during,before,after,above,below,to,from,up,down,in,out,on,off,over,under,again,further,once,here,there,all,any,both,each,few,more,most,other,some,such,no,nor,not,only,own,same,so,than,too,very,can,will,just,don,should,now,is,are,was,were,be,been,being,have,has,had,having,do,does,did,doing,would,could,ought,i,you,he,she,it,we,they,them,his,her,its,our,their,this,that,these,those,am,as,of".split(
    ",",
  ),
);

/** Lowercase alphanumeric tokens minus stopwords. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

export type ClaimSourceMatch = {
  sourceId: string;
  url: string | null;
  title: string;
  /** 0..1 keyword-overlap score. */
  score: number;
};

export type LinkedClaim = {
  claimText: string;
  matches: ClaimSourceMatch[];
};

/** Minimum overlap score for a source to count as supporting a claim. */
export const LINK_THRESHOLD = 0.15;
/** Max sources reported per claim (top-k by score). */
export const LINK_TOP_K = 3;

/**
 * Link each claim to canvas sources by keyword overlap.
 *
 * score = |claimTokens ∩ sourceTokens| / |claimTokens|. Deterministic;
 * a high score means shared vocabulary, NOT semantic verification — the UI
 * must present matches as "candidate supporting sources", never as proof.
 */
export function linkClaimsToSources(
  claims: { text: string }[],
  sources: LinkableSource[],
): LinkedClaim[] {
  return claims.map((claim) => {
    const claimTokens = new Set(tokenize(claim.text));
    const matches: ClaimSourceMatch[] = [];
    if (claimTokens.size === 0) return { claimText: claim.text, matches };
    for (const source of sources) {
      const sourceTokens = new Set(tokenize(`${source.title} ${source.excerpt}`));
      let overlap = 0;
      for (const t of claimTokens) if (sourceTokens.has(t)) overlap++;
      const score = Math.round((overlap / claimTokens.size) * 100) / 100;
      if (score >= LINK_THRESHOLD) {
        matches.push({ sourceId: source.id, url: source.url, title: source.title, score });
      }
    }
    matches.sort((a, b) => b.score - a.score);
    return { claimText: claim.text, matches: matches.slice(0, LINK_TOP_K) };
  });
}

/* ── Strict-mode gate (pure) ─────────────────────────────────────────── */

export type StrictGateInput = {
  strictMode: boolean;
  claims: { id: string; claim: string; review_state: "unreviewed" | "confirmed" | "waived" }[];
};

export type StrictGateResult = {
  blocked: boolean;
  strictMode: boolean;
  /** Claims still lacking a human CONFIRM (unreviewed or waived). */
  blocking: { id: string; claim: string }[];
  counts: { total: number; confirmed: number; waived: number; unreviewed: number };
  /** Honest human-readable explanation (for UI + API surfaces). */
  message: string;
};

/**
 * Fail-closed gate: with strict mode ON, ONLY review_state = 'confirmed'
 * satisfies the gate. Both 'unreviewed' AND 'waived' claims block —
 * a waiver is an explicit human decision to NOT verify a claim, so under
 * strict mode the claim still "lacks a confirmed source".
 *
 * D99: waivers satisfy non-strict review workflows (the waiver trail stays
 * visible in counts), but strict mode keeps them visible AND blocking. A
 * waived claim can later be confirmed (setClaimReview accepts both states),
 * which is the unblock path — there is deliberately no way to silently
 * drop a claim from the gate.
 */
export function evaluateStrictGate(input: StrictGateInput): StrictGateResult {
  const { strictMode, claims } = input;
  const blocking = claims
    .filter((c) => c.review_state !== "confirmed")
    .map((c) => ({ id: c.id, claim: c.claim }));
  const counts = {
    total: claims.length,
    confirmed: claims.filter((c) => c.review_state === "confirmed").length,
    waived: claims.filter((c) => c.review_state === "waived").length,
    unreviewed: claims.filter((c) => c.review_state === "unreviewed").length,
  };
  const blocked = strictMode && blocking.length > 0;
  const message = !strictMode
    ? "Strict mode is off — claims are advisory only."
    : blocking.length === 0
      ? `Strict mode is on — all ${counts.total} claim${counts.total === 1 ? "" : "s"} confirmed by a human reviewer.`
      : `Strict mode is on — BLOCKED: ${blocking.length} claim${blocking.length === 1 ? "" : "s"} still lack${blocking.length === 1 ? "s" : ""} a human CONFIRM (waived counts as unconfirmed). Confirm each one in the Evidence Desk to unblock packaging and publishing.`;
  return { blocked, strictMode, blocking, counts, message };
}
