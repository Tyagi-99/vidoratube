import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static audit for 20260925220000_exact_render_settle.sql.
 *
 * finalize_render_billing gains an exact-settlement branch: rows enqueued
 * with meta.expected_credits (the deterministic quote from
 * quoteMultiAspectRender) settle at exactly the quoted credits — no debit,
 * no refund. Rows enqueued before exact quoting keep the legacy
 * wall-clock settle path. The migration must stay non-destructive
 * (function body replacement only).
 */

const SQL = readFileSync(
  join(resolve(process.cwd(), "supabase/migrations"), "20260925220000_exact_render_settle.sql"),
  "utf8",
);

describe("exact_render_settle migration (static audit)", () => {
  it("replaces finalize_render_billing as SECURITY DEFINER with locked search_path", () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.finalize_render_billing\(p_render_id UUID\)/i);
    expect(SQL).toMatch(/SECURITY DEFINER/i);
    expect(SQL).toMatch(/SET\s+search_path\s*=\s*public/i);
  });

  it("settles quoted rows at exactly the quoted credits with no debit/refund", () => {
    expect(SQL).toMatch(/meta\s*->>\s*'expected_credits'/i);
    // The exact branch records billed_minutes/credits_charged from the quote…
    expect(SQL).toMatch(/credits_charged\s*=\s*v_expected_credits/i);
    // …and never debits or grants in that branch.
    const exactBranch = SQL.slice(
      SQL.indexOf("v_expected_credits := (v_render.meta"),
      SQL.indexOf("-- Legacy path"),
    );
    expect(exactBranch).not.toMatch(/debit_credits_amount_once/i);
    expect(exactBranch).not.toMatch(/grant_credits_once/i);
  });

  it("legacy path bills on finished OUTPUT duration, wall-clock only as fallback", () => {
    // Actual output duration drives billing…
    expect(SQL).toMatch(/v_render\.duration\s+IS\s+NOT\s+NULL/i);
    expect(SQL).toMatch(/CEIL\(v_render\.duration\s*\/\s*60\.0\)/i);
    // …worker wall-clock elapsed is only the fallback for rows without it.
    expect(SQL).toMatch(/render_completed_at\s*-\s*render_started_at/i);
    expect(SQL).toMatch(/settlement', 'wall_clock_legacy'/);
  });

  it("stays service_role-only", () => {
    expect(SQL).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.finalize_render_billing\(UUID\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i,
    );
  });

  it("is non-destructive (no tables, no bulk data changes, no drops)", () => {
    expect(SQL).not.toMatch(/CREATE TABLE/i);
    expect(SQL).not.toMatch(/ALTER TABLE/i);
    expect(SQL).not.toMatch(/DROP TABLE/i);
    expect(SQL).not.toMatch(/DROP FUNCTION/i);
    expect(SQL).not.toMatch(/^\s*DELETE\s+FROM\s+public\./im);
  });
});
