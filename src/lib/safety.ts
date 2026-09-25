/**
 * P6 — Monetization Safety Score (pure functions, no I/O).
 *
 * Estimates pre-publish demonetization risk from public YouTube advertiser
 * policy signals. This is a RISK ESTIMATE, not a guarantee — YouTube decides.
 * Versioned: SAFETY_SCORE_VERSION is stored with every score so historical
 * scores stay interpretable when the algorithm changes.
 *
 * Dimensions (weights sum to 100):
 *   advertiser   30 — profanity, sexual, violence/gore, drugs, tragedy language
 *   copyright    25 — asset licenses / provenance (P4)
 *   originality  20 — duplication vs research sources (P3)
 *   metadata     15 — title honesty / clickbait (P5 scorer reused)
 *   policy       10 — madeForKids, disclaimers, synthetic-content disclosure
 *
 * Sprint 7-8 C: tunable numbers (weights, thresholds, deductions) are NOT
 * hardcoded anymore — they resolve from a SafetyRuleConfig, which the server
 * loads from the `safety_rules` table (versioned, data not code). The pure
 * functions default to DEFAULT_SAFETY_RULES (exact v1 values) so they stay
 * deterministic in tests and when the DB is unavailable. Detection patterns
 * (word lists, regexes) intentionally stay in code — they are detection
 * logic, not tunable numbers.
 */

import {
  DEFAULT_SAFETY_RULES,
  ruleNum,
  type SafetyRuleConfig,
} from "./safety-rules";

export const SAFETY_SCORE_VERSION = "1.0";

export type SafetyBand = "safe" | "minor" | "at-risk" | "high-risk";
export type SafetyDimension =
  | "advertiser"
  | "copyright"
  | "originality"
  | "metadata"
  | "policy";
export type SafetySeverity = "info" | "warning" | "critical";

export interface SafetyIssue {
  dimension: SafetyDimension;
  severity: SafetySeverity;
  message: string;
  suggestion?: string;
  /** [start, end] character offsets into the script, when applicable. */
  span?: [number, number];
}

export interface DimensionScore {
  dimension: SafetyDimension;
  points: number;
  maxPoints: number;
  issues: SafetyIssue[];
}

export interface SafetyScoreResult {
  /** Whole number 0-100. */
  score: number;
  band: SafetyBand;
  dimensions: DimensionScore[];
  issues: SafetyIssue[];
  version: string;
  /** Which safety_rules version produced this score (D61). */
  ruleVersion: number;
}

export interface ProvenanceInput {
  kind: string;
  provider?: string | null;
  license?: string | null;
  licenseUrl?: string | null;
}

export interface SafetyInputs {
  script: string;
  title: string;
  description?: string;
  primaryKeyword?: string;
  assets?: ProvenanceInput[];
  /** Titles/transcripts of research sources to check duplication against. */
  sourceTexts?: string[];
  madeForKids?: boolean | null;
  /** Whether the description discloses AI/synthetic content. */
  syntheticDisclosed?: boolean;
  /** Whether medical/financial disclaimers are present (when relevant). */
  hasDisclaimer?: boolean;
}

// ---------------------------------------------------------------------------
// Keyword patterns (advertiser-friendliness). Kept intentionally moderate:
// these mirror YouTube's advertiser-friendly content guidelines categories.
// ---------------------------------------------------------------------------

interface FlagPattern {
  category: string;
  /** Key into the safety_rules table (e.g. "advertiser.profanity"). */
  ruleKey: string;
  message: string;
  suggestion: string;
  severity: SafetySeverity;
  patterns: RegExp[];
}

const PROFANITY = [
  "damn",
  "hell",
  "crap",
  "piss",
  "bitch",
  "bastard",
  "asshole",
  "dick",
  "fuck",
  "shit",
  "whore",
  "slut",
  "douche",
  "cock",
  "pussy",
  "tits",
  "boobs",
  "nigga",
  "retard",
];

const FLAG_PATTERNS: FlagPattern[] = [
  {
    category: "profanity",
    message: "Profanity detected",
    suggestion: "Replace with milder wording or bleep it — advertisers filter this.",
    severity: "warning",
    ruleKey: "advertiser.profanity",
    patterns: PROFANITY.map((w) => new RegExp(`\\b${w}s?\\b`, "i")),
  },
  {
    category: "sexual",
    message: "Sexually suggestive content",
    suggestion: "Keep it educational/clinical or remove — sexual content limits ads.",
    severity: "critical",
    ruleKey: "advertiser.sexual",
    patterns: [
      /\b(porn|pornography|xxx|nude|naked|orgasm|masturbat|fetish|erotic|blowjob|handjob)\b/i,
      /\bsex(ual)?\b.{0,20}\b(scene|content|joke)\b/i,
    ],
  },
  {
    category: "violence",
    message: "Graphic violence / gore",
    suggestion: "Describe events factually without gore detail, or add a content warning.",
    severity: "critical",
    ruleKey: "advertiser.violence",
    patterns: [
      /\b(gore|gory|dismember|decapitat|mutilat|bloodbath|bloodied corpse)\b/i,
      /\b(torture|tortured|torturing)\b/i,
      /\b(massacre|slaughter)\b.{0,30}\b(graphic|gruesome|bloody)\b/i,
    ],
  },
  {
    category: "drugs",
    message: "Drug references",
    suggestion: "Educational/documentary framing is safer than recreational depiction.",
    severity: "warning",
    ruleKey: "advertiser.drugs",
    patterns: [
      /\b(cocaine|heroin|meth(amphetamine)?|fentanyl|ecstasy|mdma|crack cocaine|opioid abuse)\b/i,
      /\b(getting high|shooting up|smoking crack)\b/i,
    ],
  },
  {
    category: "tragedy",
    message: "Sensitive tragedy / crisis event",
    suggestion: "Factual, respectful coverage is fine — avoid sensationalizing tragedy.",
    severity: "warning",
    ruleKey: "advertiser.tragedy",
    patterns: [
      /\b(suicide|self-harm|school shooting|terrorist attack|mass shooting)\b/i,
    ],
  },
];

const ADVICE_PATTERNS = {
  medical: /\b(cure|treatment|diagnos(is|e)|prescription|dosage|vaccine|disease|symptoms?)\b/i,
  financial:
    /\b(invest(ment|ing)?|stock(s| market)?|crypto|bitcoin|trading|get rich|guaranteed returns?)\b/i,
};

// ---------------------------------------------------------------------------
// Advertiser dimension (30 pts)
// ---------------------------------------------------------------------------

export function scoreAdvertiser(
  script: string,
  title: string,
  description = "",
  rules: SafetyRuleConfig = DEFAULT_SAFETY_RULES
): DimensionScore {
  const maxPoints = ruleNum(rules, "dimension.advertiser", "max_points");
  let points = maxPoints;
  const issues: SafetyIssue[] = [];
  const text = `${title}\n${script}\n${description}`;
  const wordCount = Math.max(1, text.split(/\s+/).filter(Boolean).length);

  let flaggedWords = 0;
  for (const flag of FLAG_PATTERNS) {
    const uniqueHits = new Set<string>();
    for (const re of flag.patterns) {
      const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      let m: RegExpExecArray | null;
      while ((m = global.exec(text)) !== null && uniqueHits.size < 6) {
        const key = m[0].toLowerCase();
        if (!uniqueHits.has(key)) {
          uniqueHits.add(key);
          flaggedWords++;
          // Only record a span for the first hit to keep payloads small.
          const span: [number, number] | undefined =
            uniqueHits.size === 1 ? [m.index, m.index + m[0].length] : undefined;
          issues.push({
            dimension: "advertiser",
            severity: flag.severity,
            message: `${flag.message}: "${m[0].slice(0, 40)}"`,
            suggestion: flag.suggestion,
            ...(span ? { span } : {}),
          });
        }
        if (global.lastIndex === m.index) global.lastIndex++;
      }
    }
    // Per unique hit, scaled by category severity; capped per category.
    if (uniqueHits.size > 0) {
      const deduct = ruleNum(rules, flag.ruleKey, "deduct_per_hit");
      const capMult = ruleNum(rules, flag.ruleKey, "cap_multiplier");
      points -= Math.min(deduct * uniqueHits.size, deduct * capMult);
    }
  }

  // Density penalty: a script saturated with flagged language is high risk
  // even if each word is "mild" — this mirrors YouTube's limited-ads triggers.
  // 5%+ flagged words is pervasive (1 in 20 words).
  const density = flaggedWords / wordCount;
  const densityThreshold = ruleNum(rules, "advertiser.density", "density_threshold");
  const minFlaggedWords = ruleNum(rules, "advertiser.density", "min_flagged_words");
  if (density > densityThreshold && flaggedWords >= minFlaggedWords) {
    points -= ruleNum(rules, "advertiser.density", "deduct");
    issues.push({
      dimension: "advertiser",
      severity: "critical",
      message: `High density of flagged language (${Math.round(density * 100)}% of words)`,
      suggestion: "Rewrite the script — pervasive flagged language triggers limited ads.",
    });
  }

  return { dimension: "advertiser", points: Math.max(0, Math.round(points)), maxPoints, issues };
}

// ---------------------------------------------------------------------------
// Copyright dimension (25 pts) — driven by P4 provenance records
// ---------------------------------------------------------------------------

export function scoreCopyright(
  assets: ProvenanceInput[],
  rules: SafetyRuleConfig = DEFAULT_SAFETY_RULES
): DimensionScore {
  const maxPoints = ruleNum(rules, "dimension.copyright", "max_points");
  let points = maxPoints;
  const issues: SafetyIssue[] = [];

  if (assets.length === 0) {
    return { dimension: "copyright", points, maxPoints, issues };
  }

  const missing = assets.filter((a) => !a.license);
  const unverified = assets.filter(
    (a) => a.license && /unknown|unverified|third-party/i.test(a.license)
  );
  const musicNoUrl = assets.filter(
    (a) => a.kind === "music" && a.license && !a.licenseUrl
  );

  if (missing.length > 0) {
    const perAsset = ruleNum(rules, "copyright.missing_license", "deduct_per_asset");
    points -= Math.min(perAsset * missing.length, ruleNum(rules, "copyright.missing_license", "cap"));
    issues.push({
      dimension: "copyright",
      severity: "critical",
      message: `${missing.length} asset(s) have no recorded license`,
      suggestion: "Only use assets with a recorded license — unlicensed assets risk Content ID claims.",
    });
  }
  if (unverified.length > 0) {
    const perAsset = ruleNum(rules, "copyright.unverified_license", "deduct_per_asset");
    points -= Math.min(perAsset * unverified.length, ruleNum(rules, "copyright.unverified_license", "cap"));
    issues.push({
      dimension: "copyright",
      severity: "warning",
      message: `${unverified.length} asset(s) have unverified licenses`,
      suggestion: "Verify the license or replace with AI-generated / licensed assets.",
    });
  }
  if (musicNoUrl.length > 0) {
    points -= ruleNum(rules, "copyright.music_no_url", "deduct");
    issues.push({
      dimension: "copyright",
      severity: "warning",
      message: "Music track without a license URL",
      suggestion: "Keep the license URL — YouTube disputes need proof of license.",
    });
  }

  return { dimension: "copyright", points: Math.max(0, Math.round(points)), maxPoints, issues };
}

// ---------------------------------------------------------------------------
// Originality dimension (20 pts) — shingle Jaccard vs research sources
// ---------------------------------------------------------------------------

function shingles(text: string, n = 5): Set<string> {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) {
    out.add(words.slice(i, i + n).join(" "));
  }
  return out;
}

/** Jaccard similarity over word 5-grams. Exported for tests. */
export function textSimilarity(a: string, b: string): number {
  const sa = shingles(a);
  const sb = shingles(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const s of sa) if (sb.has(s)) inter++;
  return inter / (sa.size + sb.size - inter);
}

const TRANSFORMATIVE_MARKERS = [
  /\bi (think|believe|found|noticed|discovered)\b/i,
  /\bin my opinion\b/i,
  /\bwhat this means\b/i,
  /\bhere's why\b/i,
  /\blet's break down\b/i,
  /\bthe lesson\b/i,
  /\bmy take\b/i,
];

export function scoreOriginality(
  script: string,
  sourceTexts: string[],
  rules: SafetyRuleConfig = DEFAULT_SAFETY_RULES
): DimensionScore {
  const maxPoints = ruleNum(rules, "dimension.originality", "max_points");
  let points = maxPoints;
  const issues: SafetyIssue[] = [];

  let maxSim = 0;
  for (const src of sourceTexts) {
    maxSim = Math.max(maxSim, textSimilarity(script, src));
  }

  if (maxSim > ruleNum(rules, "originality.high_similarity", "similarity_threshold")) {
    points -= ruleNum(rules, "originality.high_similarity", "deduct");
    issues.push({
      dimension: "originality",
      severity: "critical",
      message: `Script closely matches a research source (${Math.round(maxSim * 100)}% similar)`,
      suggestion: "Rewrite in your own words and add original commentary — reuploads get limited ads.",
    });
  } else if (maxSim > ruleNum(rules, "originality.mid_similarity", "similarity_threshold")) {
    points -= ruleNum(rules, "originality.mid_similarity", "deduct");
    issues.push({
      dimension: "originality",
      severity: "warning",
      message: `Script partially overlaps a source (${Math.round(maxSim * 100)}% similar)`,
      suggestion: "Add more of your own analysis to make it transformative.",
    });
  } else if (maxSim > ruleNum(rules, "originality.low_similarity", "similarity_threshold") && sourceTexts.length > 0) {
    points -= ruleNum(rules, "originality.low_similarity", "deduct");
    issues.push({
      dimension: "originality",
      severity: "info",
      message: "Mild overlap with research sources detected",
      suggestion: "Keep the facts, change the phrasing.",
    });
  }

  const words = script.split(/\s+/).filter(Boolean).length;
  const hasTransformative = TRANSFORMATIVE_MARKERS.some((p) => p.test(script));
  if (words > ruleNum(rules, "originality.no_commentary", "min_words") && !hasTransformative) {
    points -= ruleNum(rules, "originality.no_commentary", "deduct");
    issues.push({
      dimension: "originality",
      severity: "info",
      message: "No original commentary detected in a long script",
      suggestion: "Add your own take or analysis — transformative content monetizes better.",
    });
  }

  return { dimension: "originality", points: Math.max(0, Math.round(points)), maxPoints, issues };
}

// ---------------------------------------------------------------------------
// Metadata dimension (15 pts) — honesty / clickbait
// ---------------------------------------------------------------------------

export function scoreMetadata(
  title: string,
  script: string,
  description = "",
  rules: SafetyRuleConfig = DEFAULT_SAFETY_RULES
): DimensionScore {
  const maxPoints = ruleNum(rules, "dimension.metadata", "max_points");
  let points = maxPoints;
  const issues: SafetyIssue[] = [];

  const t = title.trim();

  // ALL CAPS title
  const letters = t.replace(/[^a-zA-Z]/g, "");
  if (letters.length >= 10 && letters === letters.toUpperCase()) {
    points -= ruleNum(rules, "metadata.all_caps", "deduct");
    issues.push({
      dimension: "metadata",
      severity: "warning",
      message: "Title is ALL CAPS",
      suggestion: "Use normal capitalization — all-caps reads as clickbait.",
    });
  }

  // Excessive punctuation
  if (/!{2,}|\?{2,}/.test(t)) {
    points -= ruleNum(rules, "metadata.punctuation", "deduct");
    issues.push({
      dimension: "metadata",
      severity: "info",
      message: "Excessive punctuation in title",
      suggestion: "One ! or ? is enough.",
    });
  }

  // Classic clickbait phrases
  const clickbaitHits = [
    /\byou won'?t believe\b/i,
    /\bshocking\b/i,
    /\bgone wrong\b/i,
    /\b100% free\b/i,
    /\bclick here\b/i,
    /\bthis will blow your mind\b/i,
    /\bgone sexual\b/i,
  ].filter((p) => p.test(t));
  if (clickbaitHits.length > 0) {
    points -= ruleNum(rules, "metadata.clickbait", "deduct");
    issues.push({
      dimension: "metadata",
      severity: "critical",
      message: "Clickbait phrasing in title",
      suggestion: "Promise only what the video delivers — misleading titles get limited ads.",
    });
  }

  // Title/content mismatch: title's content words should appear in the script.
  const titleWords = new Set(
    t.toLowerCase().split(/\W+/).filter((w) => w.length > 4)
  );
  const scriptLower = script.toLowerCase();
  if (titleWords.size >= 3) {
    let matched = 0;
    for (const w of titleWords) if (scriptLower.includes(w)) matched++;
    if (matched / titleWords.size < ruleNum(rules, "metadata.title_mismatch", "match_ratio")) {
      points -= ruleNum(rules, "metadata.title_mismatch", "deduct");
      issues.push({
        dimension: "metadata",
        severity: "warning",
        message: "Title keywords barely appear in the script",
        suggestion: "Make the video deliver what the title promises.",
      });
    }
  }

  // Empty description
  if (!description.trim()) {
    points -= ruleNum(rules, "metadata.no_description", "deduct");
    issues.push({
      dimension: "metadata",
      severity: "info",
      message: "No description",
      suggestion: "Add a description — it helps reviewers and search.",
    });
  }

  return { dimension: "metadata", points: Math.max(0, Math.round(points)), maxPoints, issues };
}

// ---------------------------------------------------------------------------
// Policy dimension (10 pts)
// ---------------------------------------------------------------------------

export function scorePolicy(
  inputs: {
    madeForKids?: boolean | null | undefined;
    script: string;
    syntheticDisclosed?: boolean | undefined;
    hasDisclaimer?: boolean | undefined;
  },
  rules: SafetyRuleConfig = DEFAULT_SAFETY_RULES
): DimensionScore {
  const maxPoints = ruleNum(rules, "dimension.policy", "max_points");
  let points = maxPoints;
  const issues: SafetyIssue[] = [];
  const { madeForKids, script, syntheticDisclosed, hasDisclaimer } = inputs;

  if (madeForKids === null || madeForKids === undefined) {
    points -= ruleNum(rules, "policy.kids_unset", "deduct");
    issues.push({
      dimension: "policy",
      severity: "warning",
      message: "Made-for-kids choice not set",
      suggestion: "YouTube (COPPA) requires this declaration on every upload.",
    });
  }

  const givesMedical = ADVICE_PATTERNS.medical.test(script);
  const givesFinancial = ADVICE_PATTERNS.financial.test(script);
  if ((givesMedical || givesFinancial) && !hasDisclaimer) {
    points -= ruleNum(rules, "policy.advice_no_disclaimer", "deduct");
    issues.push({
      dimension: "policy",
      severity: "critical",
      message: givesMedical ? "Medical advice without disclaimer" : "Financial advice without disclaimer",
      suggestion: "Add a clear disclaimer: not professional advice, consult a qualified expert.",
    });
  }

  if (!syntheticDisclosed) {
    points -= ruleNum(rules, "policy.synthetic_undisclosed", "deduct");
    issues.push({
      dimension: "policy",
      severity: "info",
      message: "AI-generated content disclosure not confirmed",
      suggestion: "YouTube requires disclosure for realistic AI-generated content.",
    });
  }

  return { dimension: "policy", points: Math.max(0, Math.round(points)), maxPoints, issues };
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

export function bandForScore(score: number): SafetyBand {
  if (score >= 90) return "safe";
  if (score >= 70) return "minor";
  if (score >= 50) return "at-risk";
  return "high-risk";
}

export const BAND_LABEL: Record<SafetyBand, string> = {
  safe: "Safe to monetize",
  minor: "Minor issues",
  "at-risk": "At risk",
  "high-risk": "High demonetization risk",
};

export const BAND_COLOR: Record<SafetyBand, string> = {
  safe: "text-green-600",
  minor: "text-yellow-600",
  "at-risk": "text-orange-600",
  "high-risk": "text-red-600",
};

export function computeSafetyScore(inputs: SafetyInputs): SafetyScoreResult {
  return computeSafetyScoreWithRules(inputs, DEFAULT_SAFETY_RULES);
}

/**
 * Rule-driven scoring. The server loads `rules` from the safety_rules table
 * (versioned data); the defaults keep the pure path deterministic.
 */
export function computeSafetyScoreWithRules(
  inputs: SafetyInputs,
  rules: SafetyRuleConfig
): SafetyScoreResult {
  const dimensions: DimensionScore[] = [
    scoreAdvertiser(inputs.script, inputs.title, inputs.description ?? "", rules),
    scoreCopyright(inputs.assets ?? [], rules),
    scoreOriginality(inputs.script, inputs.sourceTexts ?? [], rules),
    scoreMetadata(inputs.title, inputs.script, inputs.description ?? "", rules),
    scorePolicy(
      {
        madeForKids: inputs.madeForKids,
        script: inputs.script,
        syntheticDisclosed: inputs.syntheticDisclosed,
        hasDisclaimer: inputs.hasDisclaimer,
      },
      rules
    ),
  ];

  const total = dimensions.reduce((s, d) => s + d.points, 0);
  const maxTotal = dimensions.reduce((s, d) => s + d.maxPoints, 0);
  const issues = dimensions.flatMap((d) => d.issues);
  let score = Math.round((total / maxTotal) * 100);

  // Compounding: multiple severe (critical) violations across dimensions
  // compound demonetization risk beyond the sum of parts.
  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const compoundAt = ruleNum(rules, "compounding_criticals", "min_critical_count");
  if (criticalCount >= compoundAt) {
    score -= ruleNum(rules, "compounding_criticals", "deduct");
    issues.push({
      dimension: dimensions.find((d) => d.issues.some((i) => i.severity === "critical"))!.dimension,
      severity: "critical",
      message: `${criticalCount} severe policy violations compound — each one alone risks limited ads`,
      suggestion: "Fix every critical issue before publishing.",
    });
  }

  score = Math.max(0, Math.min(100, score));

  return {
    score,
    band: bandForScore(score),
    dimensions,
    issues,
    version: SAFETY_SCORE_VERSION,
    ruleVersion: rules.version,
  };
}

/** Honesty disclaimer shown next to every score. */
export const SAFETY_DISCLAIMER =
  "Risk estimate based on public YouTube policy signals — YouTube decides monetization, this is not a guarantee.";

/** Score below which public publishing is blocked (no override). */
export const SAFETY_PUBLISH_BLOCK_THRESHOLD = 50;

/** YouTube publish privacy levels the gate understands. */
export type PublishPrivacy = "public" | "private" | "unlisted";

export interface PublishGateDecision {
  /** True when the publish must be refused server-side. */
  blocked: boolean;
  /**
   * True when the publish may proceed but a warning must be recorded
   * (low score on a private/unlisted publish).
   */
  warning: boolean;
  /** The score that drove the decision (null = never scored). */
  score: number | null;
  /** The privacy the decision was evaluated for. */
  privacy: PublishPrivacy;
}

/**
 * Pure publish-gate decision, server-enforced in approvePublishJob AND
 * executePublishJob.
 *
 * Sprint 7-8 C (D62): the old "acknowledge the risk to override" model is
 * gone. Score < 50 BLOCKS public publishing with no override path — the
 * score is a hard ceiling for public visibility. Private/unlisted may
 * proceed, but a warning is recorded in publish_warnings for the audit trail.
 * No score on record = advisory only (allowed); scoring is advisory, the
 * approval gate is mandatory.
 */
export function evaluatePublishGate(
  score: number | null,
  privacy: PublishPrivacy
): PublishGateDecision {
  if (score === null) {
    return { blocked: false, warning: false, score: null, privacy };
  }
  if (score >= SAFETY_PUBLISH_BLOCK_THRESHOLD) {
    return { blocked: false, warning: false, score, privacy };
  }
  if (privacy === "public") {
    return { blocked: true, warning: false, score, privacy };
  }
  return { blocked: false, warning: true, score, privacy };
}

/** Clear, user-facing error for a blocked public publish. */
export function publishBlockedMessage(score: number): string {
  return (
    `Publishing to public is blocked: safety score ${score}/100 is below ` +
    `${SAFETY_PUBLISH_BLOCK_THRESHOLD}. Fix the flagged issues and run a new ` +
    `safety check, or publish as private/unlisted instead.`
  );
}

/** Warning recorded when a low-score video is published privately. */
export function lowScoreWarningMessage(score: number): string {
  return (
    `Published with safety score ${score}/100 (below ${SAFETY_PUBLISH_BLOCK_THRESHOLD}) ` +
    `as non-public. High demonetization risk if switched to public later.`
  );
}
