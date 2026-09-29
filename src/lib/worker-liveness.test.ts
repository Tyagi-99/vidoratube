/**
 * Behavioral tests for assertServerWorkerAvailable (P1, 2026-09-29 QA).
 *
 * Proves the enqueue paths refuse to debit when no render worker is alive,
 * so a paid job can never be stranded in `queued` forever.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { assertServerWorkerAvailable } from "./server-renders.functions";

/** Minimal fake admin serving canned rows for the two liveness queries. */
function fakeAdmin(opts: { heartbeatAt: string | null; claimedAt: string | null }) {
  const from = vi.fn((table: string) => {
    const rows =
      table === "worker_heartbeats"
        ? opts.heartbeatAt
          ? [{ last_seen_at: opts.heartbeatAt }]
          : []
        : opts.claimedAt
          ? [{ updated_at: opts.claimedAt }]
          : [];
    const api: Record<string, unknown> = {};
    const chain = () => api;
    for (const m of ["select", "order", "limit", "eq", "not"]) api[m] = chain;
    api["maybeSingle"] = async () => ({ data: rows[0] ?? null, error: null });
    return api;
  });
  return { from } as unknown as Pick<SupabaseClient<Database>, "from">;
}

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

describe("assertServerWorkerAvailable", () => {
  it("passes with a fresh heartbeat", async () => {
    const admin = fakeAdmin({ heartbeatAt: iso(60_000), claimedAt: null });
    await expect(assertServerWorkerAvailable(admin)).resolves.toBeUndefined();
  });

  it("passes on the old-build fallback: a recent claim, no heartbeat", async () => {
    const admin = fakeAdmin({ heartbeatAt: null, claimedAt: iso(5 * 60_000) });
    await expect(assertServerWorkerAvailable(admin)).resolves.toBeUndefined();
  });

  it("throws when the heartbeat is stale and no recent claim exists", async () => {
    const admin = fakeAdmin({ heartbeatAt: iso(60 * 60_000), claimedAt: null });
    await expect(assertServerWorkerAvailable(admin)).rejects.toThrow(/no render worker is online/i);
  });

  it("throws when no worker has ever been seen", async () => {
    const admin = fakeAdmin({ heartbeatAt: null, claimedAt: null });
    await expect(assertServerWorkerAvailable(admin)).rejects.toThrow(/browser render instead/i);
  });

  it("throws when the last claim is also stale", async () => {
    const admin = fakeAdmin({ heartbeatAt: null, claimedAt: iso(60 * 60_000) });
    await expect(assertServerWorkerAvailable(admin)).rejects.toThrow(/no render worker is online/i);
  });
});
