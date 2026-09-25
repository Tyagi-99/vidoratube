/**
 * Sprint 7-8, workstream C — server-side safety-rule loading.
 *
 * Reads the ACTIVE rule-set version from the `safety_rules` table
 * (highest active version wins). Falls back to DEFAULT_SAFETY_RULES when the
 * table is unavailable (e.g. the migration hasn't been applied yet), so
 * scoring never hard-fails on a missing table — the seed equals v1 anyway.
 */

import {
  ACTIVE_RULE_VERSION,
  DEFAULT_SAFETY_RULES,
  type SafetyRuleConfig,
} from "./safety-rules";

interface SafetyRuleRow {
  rule_key: string;
  params: Record<string, unknown> | null;
  version: number;
  active: boolean;
}

/** Resolves the active rule set from the DB (service-role client). */
export async function getActiveSafetyRules(
  admin: any,
): Promise<SafetyRuleConfig> {
  try {
    const { data, error } = await admin
      .from("safety_rules")
      .select("rule_key, params, version, active")
      .eq("active", true)
      .order("version", { ascending: false });
    if (error || !data || data.length === 0) {
      console.warn(
        "[vidora] safety_rules unavailable, using built-in v1 defaults",
        error?.message ?? "(no active rows)",
      );
      return DEFAULT_SAFETY_RULES;
    }
    const rows = data as SafetyRuleRow[];
    const version = rows[0]!.version;
    const params: SafetyRuleConfig["params"] = {};
    for (const row of rows) {
      if (row.version !== version) continue;
      const numeric: Record<string, number> = {};
      for (const [k, v] of Object.entries(row.params ?? {})) {
        if (typeof v === "number" && Number.isFinite(v)) numeric[k] = v;
      }
      params[row.rule_key] = numeric;
    }
    return { version, params };
  } catch (e) {
    console.warn(
      "[vidora] safety_rules read failed, using built-in v1 defaults:",
      e instanceof Error ? e.message : e,
    );
    return DEFAULT_SAFETY_RULES;
  }
}

export { ACTIVE_RULE_VERSION };
