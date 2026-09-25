import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  claimBillingEvent,
  grantEventCredits,
  processDomainEvent,
} from "./webhooks.server";

/**
 * P7 webhook idempotency tests.
 *
 * The production guarantee is two-layered:
 *   1. billing_events UNIQUE(provider, event_id) -> claimBillingEvent returns
 *      false for replays (Postgres 23505).
 *   2. grant_credits_once with a deterministic ref -> even a double-process
 *      grants only once.
 * These tests prove the client-side logic calls the RPCs with the right
 * deterministic refs; the SQL-level guarantees are in the migration.
 */

function mockAdmin() {
  const rpc = vi.fn().mockResolvedValue({ data: 100, error: null });
  const insert = vi.fn();
  const update = vi.fn();
  const upsert = vi.fn();
  const chain = {
    insert: (row: unknown) => {
      insert(row);
      return Promise.resolve({ error: null });
    },
    update: (row: unknown) => {
      update(row);
      return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
    },
    upsert: (row: unknown, opts: unknown) => {
      upsert(row, opts);
      return Promise.resolve({ error: null });
    },
  };
  const from = vi.fn().mockReturnValue(chain);
  const admin = { rpc, from } as unknown as SupabaseClient<Database>;
  return { rpc, insert, update, upsert, from, admin };
}

describe("claimBillingEvent", () => {
  it("claims a fresh event", async () => {
    const { admin, insert } = mockAdmin();
    const first = await claimBillingEvent(admin, "stripe", "evt_1", "checkout.session.completed", {});
    expect(first).toBe(true);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "stripe", event_id: "evt_1" }),
    );
  });

  it("returns false on unique-violation replay (23505)", async () => {
    const from = vi.fn().mockReturnValue({
      insert: () => Promise.resolve({ error: { code: "23505", message: "duplicate" } }),
    });
    const admin = { from } as unknown as SupabaseClient<Database>;
    const first = await claimBillingEvent(admin, "stripe", "evt_1", "checkout.session.completed", {});
    expect(first).toBe(false);
  });

  it("throws on unexpected insert errors", async () => {
    const from = vi.fn().mockReturnValue({
      insert: () => Promise.resolve({ error: { code: "500", message: "boom" } }),
    });
    const admin = { from } as unknown as SupabaseClient<Database>;
    await expect(claimBillingEvent(admin, "stripe", "evt_1", "x", {})).rejects.toThrow();
  });
});

describe("grantEventCredits", () => {
  it("grants via grant_credits_once with a deterministic ref", async () => {
    const { admin, rpc } = mockAdmin();
    await grantEventCredits(admin, "user-1", 70, "stripe purchase: pack_m", "stripe", "evt_abc");
    expect(rpc).toHaveBeenCalledWith("grant_credits_once", {
      p_user_id: "user-1",
      p_amount: 70,
      p_reason: "stripe purchase: pack_m",
      p_ref_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    // Same provider event -> same ref (idempotent).
    const firstRef = rpc.mock.calls[0]![1].p_ref_id;
    await grantEventCredits(admin, "user-1", 70, "stripe purchase: pack_m", "stripe", "evt_abc");
    expect(rpc.mock.calls[1]![1].p_ref_id).toBe(firstRef);
    // Different event -> different ref.
    await grantEventCredits(admin, "user-1", 70, "stripe purchase: pack_m", "stripe", "evt_xyz");
    expect(rpc.mock.calls[2]![1].p_ref_id).not.toBe(firstRef);
  });
});

describe("processDomainEvent", () => {
  it("purchase.completed grants pack credits", async () => {
    const { admin, rpc } = mockAdmin();
    await processDomainEvent(admin, {
      kind: "purchase.completed",
      userId: "user-1",
      planSlug: "pack_m",
      credits: 70,
      provider: "razorpay",
      providerRef: "pay_123",
    });
    expect(rpc).toHaveBeenCalledWith(
      "grant_credits_once",
      expect.objectContaining({ p_user_id: "user-1", p_amount: 70 }),
    );
  });

  it("subscription.renewed upserts the subscription AND grants monthly credits", async () => {
    const { admin, rpc, upsert } = mockAdmin();
    await processDomainEvent(admin, {
      kind: "subscription.renewed",
      userId: "user-2",
      planSlug: "creator",
      credits: 60,
      provider: "stripe",
      externalId: "sub_123",
      periodStart: "2026-09-01T00:00:00Z",
      periodEnd: "2026-10-01T00:00:00Z",
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-2",
        provider: "stripe",
        external_id: "sub_123",
        plan_slug: "creator",
        status: "active",
      }),
      { onConflict: "provider,external_id" },
    );
    expect(rpc).toHaveBeenCalledWith(
      "grant_credits_once",
      expect.objectContaining({ p_user_id: "user-2", p_amount: 60 }),
    );
  });

  it("subscription.ended marks the subscription canceled", async () => {
    const { admin, update } = mockAdmin();
    await processDomainEvent(admin, {
      kind: "subscription.ended",
      provider: "stripe",
      externalId: "sub_123",
      status: "canceled",
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: "canceled" }));
  });
});
