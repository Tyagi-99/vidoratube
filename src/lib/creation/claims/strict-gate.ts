/**
 * Stream B — reusable strict evidence gate (F11).
 *
 * Fail-closed rule (D105): when a project has `research_strict_mode` ON,
 * publishing (approval AND execution) and package export are blocked while
 * ANY claim linked to the project's research sources lacks review_state =
 * 'confirmed'. Both 'unreviewed' and 'waived' block: a waiver is an explicit
 * human decision NOT to verify a claim, so under strict mode the claim still
 * "lacks a confirmed source". Waivers satisfy non-strict review workflows
 * and stay visible in the counts; a waived claim can later be confirmed,
 * which is the unblock path — there is deliberately no silent removal.
 *
 * Verdict is recorded at confirm time but NOT gate-enforced: the human
 * confirm itself is the gate. No claim is ever auto-approved — the only
 * writer of review_state is the explicit confirm/waive endpoint, and this
 * gate never writes at all.
 *
 * This module is intentionally dependency-light: it takes a minimal
 * structural supabase surface (`GateDb`, the same `Pick<SupabaseClient,
 * "from">` convention the other Stream B modules use) so publish
 * approval, publish execution, and the UI gate-state endpoint all share
 * one implementation. Stream F: import { getProjectStrictGate } from
 * here — do not re-implement the rule.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Minimal surface of the service-role client used by this module. */
export type GateDb = Pick<SupabaseClient, "from">;

/** Serializable gate verdict — safe to return from a server fn. */
export type StrictGateVerdict = {
  /** Whether the project has strict review mode enabled. */
  strictMode: boolean;
  /** True when strict mode is on AND at least one claim is not confirmed. */
  blocked: boolean;
  /** Count of claims still lacking a human CONFIRM (unreviewed + waived). */
  unconfirmedCount: number;
  /** Total claims linked to the project's sources. */
  totalClaims: number;
  /** Human-readable status line for UI / error messages. */
  message: string;
};

/**
 * Evaluate the strict evidence gate for a project.
 * Throws when the project does not exist or is not owned by userId.
 * Never writes; fail-closed on query errors (a failed read blocks).
 *
 * Ownership note: research_claims carries its own user_id (Phase 1
 * migration), but the canonical scoping here goes through the project's
 * research_sources rows — a claim only counts when its source belongs to
 * this user AND this project.
 */
export async function getProjectStrictGate(
  supabase: GateDb,
  userId: string,
  projectId: string,
): Promise<StrictGateVerdict> {
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, research_strict_mode")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (projectError) throw new Error(`Strict gate check failed: ${projectError.message}`);
  if (!project) throw new Error("Project not found");

  const strictMode = project.research_strict_mode === true;
  if (!strictMode) {
    return {
      strictMode: false,
      blocked: false,
      unconfirmedCount: 0,
      totalClaims: 0,
      message: "Strict review is off — claim review is advisory.",
    };
  }

  const { data: sources, error: sourcesError } = await supabase
    .from("research_sources")
    .select("id")
    .eq("project_id", projectId)
    .eq("user_id", userId);
  if (sourcesError) throw new Error(`Strict gate check failed: ${sourcesError.message}`);
  const sourceIds = (sources ?? []).map((s: { id: string }) => s.id);

  let total = 0;
  let unconfirmed = 0;
  if (sourceIds.length > 0) {
    const { count: totalCount, error: totalError } = await supabase
      .from("research_claims")
      .select("id", { count: "exact", head: true })
      .in("source_id", sourceIds);
    if (totalError) throw new Error(`Strict gate check failed: ${totalError.message}`);
    total = totalCount ?? 0;

    // Fail-closed: anything that is not an explicit human CONFIRM blocks.
    const { count: unconfirmedCount, error: unconfirmedError } = await supabase
      .from("research_claims")
      .select("id", { count: "exact", head: true })
      .in("source_id", sourceIds)
      .neq("review_state", "confirmed");
    if (unconfirmedError) throw new Error(`Strict gate check failed: ${unconfirmedError.message}`);
    unconfirmed = unconfirmedCount ?? 0;
  }

  const blocked = unconfirmed > 0;
  return {
    strictMode: true,
    blocked,
    unconfirmedCount: unconfirmed,
    totalClaims: total,
    message: blocked
      ? `Strict review is ON — publishing and package export are blocked until ${unconfirmed} claim${unconfirmed === 1 ? "" : "s"} get${unconfirmed === 1 ? "s" : ""} a human CONFIRM in the Evidence desk (waived counts as unconfirmed).`
      : total === 0
        ? "Strict review is ON — no claims to review, publishing is allowed."
        : `Strict review is ON — all ${total} claims confirmed by a human reviewer. Publishing is allowed.`,
  };
}
