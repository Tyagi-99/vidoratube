import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Sprint 1-2: static audit that every failure/cancellation path refunds
 * reserved credits through the fixed refund RPC — never by minting credits
 * or touching ledger rows directly.
 *
 * Behavioral money tests live in:
 *   - supabase/tests/finalize_render_billing.sql (settle math, psql)
 *   - worker/src/finish-job.test.ts (worker refund wiring, node:test)
 *   - src/lib/billing/*.test.ts (refund RPC regression, must stay green)
 */

const ROOT = resolve(process.cwd());
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("failure refund wiring (static audit)", () => {
  it("refundDebitedMinutes refunds the actual debit and never throws", () => {
    const src = read("src/lib/jobs.functions.ts");
    const helper = src.slice(src.indexOf("async function refundDebitedMinutes"));
    // Looks up the real negative ledger row and refunds exactly that amount.
    expect(helper).toMatch(/\.lt\("delta", 0\)/);
    expect(helper).toMatch(/Math\.abs\(debit\.delta\)/);
    // The refund RPC is fixed and idempotent; the helper swallows errors so a
    // refund problem can never mask the original render failure.
    expect(helper).toMatch(/refundMinutesForJob/);
    expect(helper).toMatch(/catch \{\s*\/\/ Never mask/);
  });

  it("failVideoJobCompose refunds the debited minutes on terminal failure", () => {
    const src = read("src/lib/jobs.functions.ts");
    const fn = src.slice(src.indexOf("export const failVideoJobCompose"));
    expect(fn).toMatch(/refundDebitedMinutes\(supabaseAdmin, context\.userId, data\.id\)/);
  });

  it("the provider-failed rendering branch refunds before marking failed", () => {
    const src = read("src/lib/jobs.functions.ts");
    const branch = src.slice(src.indexOf('if (status.status === "failed")'));
    expect(branch).toMatch(/refundDebitedMinutes\(supabaseAdmin, userId, job\.id\)/);
  });

  it("createVideoJob refunds the exact debit when the pipeline throws", () => {
    const src = read("src/lib/jobs.functions.ts");
    const fn = src.slice(src.indexOf("export const createVideoJob"));
    expect(fn).toMatch(/refundDebitedMinutes\(supabaseAdmin, userId, job\.id\)/);
  });

  it("cancelServerRender refunds the reserve on queued cancel", () => {
    const src = read("src/lib/server-renders.functions.ts");
    const fn = src.slice(src.indexOf("export const cancelServerRender"));
    expect(fn).toMatch(/refundMinutesForJob/);
    expect(fn).toMatch(/row\.reserved_minutes/);
  });

  it("worker finishJob refunds reserved minutes on failed/cancelled", () => {
    const src = read("worker/src/supabase.ts");
    const fn = src.slice(src.indexOf("export async function finishJob"));
    expect(fn).toMatch(/refund_credits_for_minutes/);
    expect(fn).toMatch(/p_ref_id:\s*jobId/);
    expect(fn).toMatch(/patch\.status === "completed"/);
  });

  it("no code path mints credits outside the fixed RPCs", () => {
    for (const p of ["src/lib/jobs.functions.ts", "worker/src/supabase.ts"]) {
      const src = read(p);
      // Direct inserts into the ledger are forbidden; all credit movement
      // goes through debit_/grant_/refund_ RPCs.
      expect(src).not.toMatch(/from\("credit_ledger"\)\s*\.insert/);
      expect(src).not.toMatch(/from\("credit_ledger"\)\s*\.update/);
      expect(src).not.toMatch(/from\("credit_ledger"\)\s*\.delete/);
    }
  });

  it("the settle behavioral SQL test covers the required cases", () => {
    const sql = read("supabase/tests/finalize_render_billing.sql");
    expect(sql).toMatch(/output 4/i);
    expect(sql).toMatch(/output 12/i);
    expect(sql).toMatch(/already_finalized/);
    expect(sql).toMatch(/wall-clock fallback/i);
    expect(sql).toMatch(/1h wall-clock/i);
    expect(sql).toMatch(/zero ledger delta/i);
  });
});
