/**
 * Sprint 7-8, workstream C — versioned safety rules as DATA.
 *
 * Tunable scorer numbers (weights, thresholds, deductions) live in the
 * `safety_rules` table, one row per rule_key per version. This module is the
 * typed view of that data:
 *
 *   - SafetyRuleConfig — the resolved param set for one active version.
 *   - DEFAULT_SAFETY_RULES — exact v1 seed values, kept in code so the pure
 *     scorer and its tests stay deterministic when the DB is unavailable.
 *   - ruleNum — typed param accessor with a safe fallback.
 *
 * Detection logic (which patterns flag what) stays in code by design
 * (D63): regexes and word lists are not tunable numbers.
 */

export interface SafetyRuleParams {
  [param: string]: number;
}

export interface SafetyRuleConfig {
  /** The rule-set version these params were resolved from. */
  version: number;
  /** rule_key -> params (e.g. { deduct_per_hit: 5, cap_multiplier: 3 }). */
  params: Record<string, SafetyRuleParams>;
}

/**
 * Active v1 rule set — MUST stay in exact parity with the seed rows in
 * supabase/migrations/20260926020000_safety_rules_approvals.sql.
 * src/lib/safety-rules.test.ts enforces this parity against the SQL file.
 */
export const DEFAULT_SAFETY_RULES: SafetyRuleConfig = {
  version: 1,
  params: {
    block_threshold: { threshold: 50 },
    "dimension.advertiser": { max_points: 30 },
    "dimension.copyright": { max_points: 25 },
    "dimension.originality": { max_points: 20 },
    "dimension.metadata": { max_points: 15 },
    "dimension.policy": { max_points: 10 },
    "advertiser.profanity": { deduct_per_hit: 5, cap_multiplier: 3 },
    "advertiser.sexual": { deduct_per_hit: 8, cap_multiplier: 3 },
    "advertiser.violence": { deduct_per_hit: 8, cap_multiplier: 3 },
    "advertiser.drugs": { deduct_per_hit: 6, cap_multiplier: 3 },
    "advertiser.tragedy": { deduct_per_hit: 4, cap_multiplier: 3 },
    "advertiser.density": { density_threshold: 0.05, min_flagged_words: 3, deduct: 10 },
    "copyright.missing_license": { deduct_per_asset: 8, cap: 16 },
    "copyright.unverified_license": { deduct_per_asset: 5, cap: 10 },
    "copyright.music_no_url": { deduct: 6 },
    "originality.high_similarity": { similarity_threshold: 0.6, deduct: 12 },
    "originality.mid_similarity": { similarity_threshold: 0.35, deduct: 6 },
    "originality.low_similarity": { similarity_threshold: 0.2, deduct: 3 },
    "originality.no_commentary": { min_words: 150, deduct: 4 },
    "metadata.all_caps": { deduct: 3 },
    "metadata.punctuation": { deduct: 2 },
    "metadata.clickbait": { deduct: 6 },
    "metadata.title_mismatch": { deduct: 5, match_ratio: 0.4 },
    "metadata.no_description": { deduct: 1 },
    "policy.kids_unset": { deduct: 4 },
    "policy.advice_no_disclaimer": { deduct: 5 },
    "policy.synthetic_undisclosed": { deduct: 2 },
    compounding_criticals: { min_critical_count: 2, deduct: 10 },
  },
};

/** Every rule_key the scorer understands. New keys must be seeded too. */
export const KNOWN_RULE_KEYS = Object.keys(DEFAULT_SAFETY_RULES.params);

/**
 * Typed param accessor. Falls back to the v1 default when a row/param is
 * missing so a partial rule set degrades gracefully instead of throwing.
 */
export function ruleNum(
  rules: SafetyRuleConfig,
  ruleKey: string,
  param: string,
): number {
  const fromRules = rules.params[ruleKey]?.[param];
  if (typeof fromRules === "number" && Number.isFinite(fromRules)) return fromRules;
  const fallback = DEFAULT_SAFETY_RULES.params[ruleKey]?.[param];
  if (typeof fallback === "number" && Number.isFinite(fallback)) return fallback;
  throw new Error(`Unknown safety rule param: ${ruleKey}.${param}`);
}

/** The rule-set version currently seeded and active. */
export const ACTIVE_RULE_VERSION = 1;
