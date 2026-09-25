/**
 * Worker finishJob billing tests (run with: npx tsx --test src/*.test.ts).
 *
 * Covers Sprint 1-2 billing wiring:
 *   - completed -> finalize_render_billing (idempotent settle), no refund.
 *   - failed/cancelled -> refund_credits_for_minutes with the row's
 *     reserved_minutes and p_ref_id = job id (idempotent per job, clamps to
 *     the actual debit — never mints credits).
 *   - a refund RPC failure is logged, never throws (the render already
 *     reached a terminal state).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { finishJob } from "./supabase.js";

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

function stubSupabase(opts: { reservedMinutes?: number; rpcError?: string } = {}) {
  const rpcCalls: RpcCall[] = [];
  const updates: { table: string; patch: unknown }[] = [];
  const stub = {
    from: (table: string) => ({
      update: (patch: unknown) => {
        updates.push({ table, patch });
        return { eq: async () => ({ error: null }) };
      },
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              user_id: "user-1",
              reserved_minutes: opts.reservedMinutes ?? 25,
            },
            error: null,
          }),
        }),
      }),
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return opts.rpcError ? { error: { message: opts.rpcError } } : { error: null };
    },
  };
  return { stub, rpcCalls, updates };
}

describe("finishJob billing", () => {
  it("completed: settles via finalize_render_billing, never refunds", async () => {
    const { stub, rpcCalls } = stubSupabase();
    await finishJob(stub as any, "job-1", { status: "completed", duration: 600 });
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0]!.name, "finalize_render_billing");
    assert.deepEqual(rpcCalls[0]!.args, { p_render_id: "job-1" });
  });

  it("failed: refunds the reserved minutes with p_ref_id = job id", async () => {
    const { stub, rpcCalls } = stubSupabase({ reservedMinutes: 25 });
    await finishJob(stub as any, "job-2", { status: "failed", error: "boom" });
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0]!.name, "refund_credits_for_minutes");
    assert.equal(rpcCalls[0]!.args.p_user_id, "user-1");
    assert.equal(rpcCalls[0]!.args.p_minutes, 25);
    assert.equal(rpcCalls[0]!.args.p_ref_id, "job-2");
    assert.match(String(rpcCalls[0]!.args.p_reason), /failed/);
  });

  it("cancelled: refunds the reserved minutes too", async () => {
    const { stub, rpcCalls } = stubSupabase({ reservedMinutes: 10 });
    await finishJob(stub as any, "job-3", { status: "cancelled" });
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0]!.name, "refund_credits_for_minutes");
    assert.equal(rpcCalls[0]!.args.p_minutes, 10);
    assert.equal(rpcCalls[0]!.args.p_ref_id, "job-3");
  });

  it("marks the row terminal before any billing call", async () => {
    const { stub, updates } = stubSupabase();
    await finishJob(stub as any, "job-4", { status: "failed", error: "x" });
    assert.equal(updates.length, 1);
    const patch = updates[0]!.patch as Record<string, unknown>;
    assert.equal(patch.status, "failed");
    assert.ok(patch.render_completed_at);
  });

  it("a refund RPC failure is logged, not thrown", async () => {
    const { stub, rpcCalls } = stubSupabase({ rpcError: "db down" });
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => errors.push(a);
    try {
      await finishJob(stub as any, "job-5", { status: "failed" });
    } finally {
      console.error = orig;
    }
    assert.equal(rpcCalls.length, 1);
    assert.equal(errors.length, 1);
  });
});
