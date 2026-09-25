import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACTIVE_RULE_VERSION,
  DEFAULT_SAFETY_RULES,
  KNOWN_RULE_KEYS,
  ruleNum,
  type SafetyRuleConfig,
} from "./safety-rules";
import { getActiveSafetyRules } from "./safety-rules.server";
import {
  SAFETY_PUBLISH_BLOCK_THRESHOLD,
  computeSafetyScore,
  computeSafetyScoreWithRules,
  lowScoreWarningMessage,
} from "./safety";

const MIGRATION =
  "supabase/migrations/20260926020000_safety_rules_approvals.sql";

function seedSql(): string {
  return readFileSync(join(process.cwd(), MIGRATION), "utf8");
}

describe("safety rule config", () => {
  it("defaults cover every rule key the scorer understands", () => {
    expect(KNOWN_RULE_KEYS.length).toBeGreaterThan(20);
    for (const key of KNOWN_RULE_KEYS) {
      expect(DEFAULT_SAFETY_RULES.params[key], `missing params for ${key}`).toBeTruthy();
    }
  });

  it("seed parity: every default rule_key is seeded in the migration", () => {
    const sql = seedSql();
    for (const key of KNOWN_RULE_KEYS) {
      expect(sql, `seed missing rule_key '${key}'`).toContain(`('${key}'`);
    }
  });

  it("seed parity: every default param value is seeded in the migration", () => {
    const sql = seedSql();
    for (const [key, params] of Object.entries(DEFAULT_SAFETY_RULES.params)) {
      for (const [param, value] of Object.entries(params)) {
        // The seed writes params as JSON like '{"deduct_per_hit": 5, ...}'.
        expect(
          sql,
          `seed missing ${key}.${param} = ${value}`,
        ).toContain(`"${param}": ${value}`);
      }
    }
  });

  it("block_threshold seed matches the exported constant", () => {
    const sql = seedSql();
    expect(sql).toContain(
      `"threshold": ${SAFETY_PUBLISH_BLOCK_THRESHOLD}`,
    );
    expect(ruleNum(DEFAULT_SAFETY_RULES, "block_threshold", "threshold")).toBe(
      SAFETY_PUBLISH_BLOCK_THRESHOLD,
    );
  });

  it("dimension max_points sum to 100", () => {
    const dims = ["advertiser", "copyright", "originality", "metadata", "policy"];
    const total = dims.reduce(
      (s, d) => s + ruleNum(DEFAULT_SAFETY_RULES, `dimension.${d}`, "max_points"),
      0,
    );
    expect(total).toBe(100);
  });

  it("ruleNum falls back to defaults when the DB set is partial", () => {
    const partial: SafetyRuleConfig = {
      version: 99,
      params: { "metadata.all_caps": { deduct: 7 } },
    };
    expect(ruleNum(partial, "metadata.all_caps", "deduct")).toBe(7);
    // Missing rule falls back to v1 defaults.
    expect(ruleNum(partial, "metadata.punctuation", "deduct")).toBe(2);
  });

  it("ruleNum throws for a completely unknown rule", () => {
    expect(() => ruleNum(DEFAULT_SAFETY_RULES, "nope.nothing", "deduct")).toThrow();
  });
});

describe("getActiveSafetyRules", () => {
  function mockAdmin(rows: any[]) {
    return {
      from: (_table: string) => ({
        select: () => ({
          eq: (col: string, val: unknown) => ({
            order: (ocol: string, opts?: { ascending?: boolean }) => {
              // Honor the real query: active rows only, highest version first.
              const filtered = rows.filter((row) => row[col] === val);
              const sorted = [...filtered].sort((a, b) =>
                opts?.ascending === false ? b[ocol] - a[ocol] : a[ocol] - b[ocol],
              );
              return Promise.resolve({ data: sorted, error: null });
            },
          }),
        }),
      }),
    };
  }

  it("picks the highest active version", async () => {
    const admin = mockAdmin([
      { rule_key: "block_threshold", params: { threshold: 50 }, version: 1, active: true },
      { rule_key: "block_threshold", params: { threshold: 60 }, version: 2, active: true },
      { rule_key: "metadata.all_caps", params: { deduct: 9 }, version: 2, active: true },
      { rule_key: "block_threshold", params: { threshold: 10 }, version: 3, active: false },
    ]);
    const rules = await getActiveSafetyRules(admin);
    expect(rules.version).toBe(2);
    expect(rules.params["block_threshold"]).toEqual({ threshold: 60 });
    expect(rules.params["metadata.all_caps"]).toEqual({ deduct: 9 });
  });

  it("falls back to built-in v1 when the table is missing/empty", async () => {
    const admin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: [], error: { message: "nope" } }),
          }),
        }),
      }),
    };
    const rules = await getActiveSafetyRules(admin);
    expect(rules).toEqual(DEFAULT_SAFETY_RULES);
    expect(ACTIVE_RULE_VERSION).toBe(1);
  });
});

describe("rule-driven scoring", () => {
  const INPUTS = {
    script: "What the fuck is up guys. This shit is fucking crazy.",
    title: "A totally normal title about aqueducts and water",
    description: "Educational.",
    assets: [],
    sourceTexts: [],
    madeForKids: false,
    syntheticDisclosed: true,
    hasDisclaimer: false,
  };

  it("computeSafetyScore equals computeSafetyScoreWithRules(DEFAULT)", () => {
    const a = computeSafetyScore(INPUTS);
    const b = computeSafetyScoreWithRules(INPUTS, DEFAULT_SAFETY_RULES);
    expect(a.score).toBe(b.score);
    expect(a.ruleVersion).toBe(1);
  });

  it("a tuned rule set actually changes the score", () => {
    const tuned: SafetyRuleConfig = {
      version: 2,
      params: {
        ...DEFAULT_SAFETY_RULES.params,
        "advertiser.profanity": { deduct_per_hit: 0, cap_multiplier: 3 },
      },
    };
    const base = computeSafetyScoreWithRules(INPUTS, DEFAULT_SAFETY_RULES);
    const withTuning = computeSafetyScoreWithRules(INPUTS, tuned);
    expect(withTuning.score).toBeGreaterThan(base.score);
    expect(withTuning.ruleVersion).toBe(2);
  });

  it("zeroing every deduction scores 100 (sanity: rules drive the score)", () => {
    const zeroed: SafetyRuleConfig = {
      version: 3,
      params: Object.fromEntries(
        Object.entries(DEFAULT_SAFETY_RULES.params).map(([k, p]) => {
          // Keep weights/thresholds so the shape stays valid; zero deductions.
          if (k.startsWith("dimension.") || k === "block_threshold") return [k, p];
          const zeroedParams: Record<string, number> = {};
          for (const [pk, v] of Object.entries(p)) {
            zeroedParams[pk] = pk.startsWith("deduct") || pk === "cap" || pk === "cap_multiplier" || pk === "deduct_per_hit" || pk === "deduct_per_asset" ? 0 : v;
          }
          return [k, zeroedParams];
        }),
      ),
    };
    const r = computeSafetyScoreWithRules(INPUTS, zeroed);
    expect(r.score).toBe(100);
    expect(r.ruleVersion).toBe(3);
  });

  it("lowScoreWarningMessage names the score and the threshold", () => {
    expect(lowScoreWarningMessage(42)).toContain("42/100");
    expect(lowScoreWarningMessage(42)).toContain("50");
  });
});
