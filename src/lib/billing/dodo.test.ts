import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dodoProvider,
  isDodoConfigured,
  normalizeDodoEvent,
  verifyDodoWebhookSignature,
} from "./dodo";
import { paymentsLive } from "./payments-live";
import { claimBillingEvent } from "./webhooks.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Dodo Payments (USD) adapter tests.
 *
 * Covers: Standard-Webhooks signature verification (success, bad signature,
 * missing headers, stale timestamp = replay), event normalization, webhook
 * dedupe via claimBillingEvent, and the paymentsLive feature flag.
 * No network calls — DODO_* env vars are stubbed per test.
 */

const SECRET = "whsec_test_secret_123";

function sign(id: string, timestamp: string, body: string, secret: string = SECRET): string {
  const sig = createHmac("sha256", secret)
    .update(`${id}.${timestamp}.${body}`, "utf8")
    .digest("base64");
  return `v1,${sig}`;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("verifyDodoWebhookSignature", () => {
  it("accepts a valid signature", () => {
    vi.stubEnv("DODO_WEBHOOK_SECRET", SECRET);
    const body = JSON.stringify({ type: "payment.succeeded", data: {} });
    const ts = String(Math.floor(Date.now() / 1000));
    expect(() =>
      verifyDodoWebhookSignature(
        body,
        { id: "wh_123", signature: sign("wh_123", ts, body), timestamp: ts },
      ),
    ).not.toThrow();
  });

  it("accepts a base64-encoded secret (whsec_ prefix, decoded bytes)", () => {
    const raw = Buffer.from("test_secret_123").toString("base64");
    vi.stubEnv("DODO_WEBHOOK_SECRET", `whsec_${raw}`);
    const body = JSON.stringify({ type: "payment.succeeded", data: {} });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac("sha256", Buffer.from(raw, "base64"))
      .update(`wh_123.${ts}.${body}`, "utf8")
      .digest("base64");
    expect(() =>
      verifyDodoWebhookSignature(
        body,
        { id: "wh_123", signature: `v1,${sig}`, timestamp: ts },
      ),
    ).not.toThrow();
  });

  it("rejects a bad signature", () => {
    vi.stubEnv("DODO_WEBHOOK_SECRET", SECRET);
    const body = JSON.stringify({ type: "payment.succeeded", data: {} });
    const ts = String(Math.floor(Date.now() / 1000));
    expect(() =>
      verifyDodoWebhookSignature(
        body,
        { id: "wh_123", signature: "v1,bm90YXJlYWxzaWduYXR1cmU=", timestamp: ts },
      ),
    ).toThrow(/Invalid Dodo webhook signature/);
  });

  it("rejects when the secret is wrong", () => {
    vi.stubEnv("DODO_WEBHOOK_SECRET", "different-secret");
    const body = JSON.stringify({ type: "payment.succeeded", data: {} });
    const ts = String(Math.floor(Date.now() / 1000));
    expect(() =>
      verifyDodoWebhookSignature(
        body,
        { id: "wh_123", signature: sign("wh_123", ts, body, SECRET), timestamp: ts },
      ),
    ).toThrow(/Invalid Dodo webhook signature/);
  });

  it("rejects missing headers", () => {
    vi.stubEnv("DODO_WEBHOOK_SECRET", SECRET);
    expect(() =>
      verifyDodoWebhookSignature("{}", { id: null, signature: "v1,x", timestamp: "1" }),
    ).toThrow(/webhook-id/);
    expect(() =>
      verifyDodoWebhookSignature("{}", { id: "a", signature: null, timestamp: "1" }),
    ).toThrow(/webhook-signature/);
  });

  it("rejects stale timestamps (replay protection)", () => {
    vi.stubEnv("DODO_WEBHOOK_SECRET", SECRET);
    const body = "{}";
    const oldTs = String(Math.floor(Date.now() / 1000) - 3600);
    expect(() =>
      verifyDodoWebhookSignature(
        body,
        { id: "wh_123", signature: sign("wh_123", oldTs, body), timestamp: oldTs },
      ),
    ).toThrow(/outside tolerance/);
  });

  it("throws when the webhook secret is not configured", () => {
    vi.stubEnv("DODO_WEBHOOK_SECRET", "");
    expect(() =>
      verifyDodoWebhookSignature("{}", { id: "a", signature: "v1,x", timestamp: "1" }),
    ).toThrow(/DODO_WEBHOOK_SECRET/);
  });
});

describe("normalizeDodoEvent", () => {
  const meta = { user_id: "user_1", plan_slug: "pack_s" };

  it("maps payment.succeeded to purchase.completed", () => {
    const e = normalizeDodoEvent({
      type: "payment.succeeded",
      data: { payment_id: "pay_1", metadata: meta },
    });
    expect(e).toMatchObject({
      kind: "purchase.completed",
      userId: "user_1",
      planSlug: "pack_s",
      provider: "dodo",
      providerRef: "pay_1",
    });
  });

  it("ignores payment.succeeded carrying a subscription_id (no double grant)", () => {
    const e = normalizeDodoEvent({
      type: "payment.succeeded",
      data: { payment_id: "pay_1", subscription_id: "sub_1", metadata: meta },
    });
    expect(e).toBeNull();
  });

  it("maps subscription.renewed to subscription.renewed", () => {
    const e = normalizeDodoEvent({
      type: "subscription.renewed",
      data: { subscription_id: "sub_1", metadata: meta },
    });
    expect(e).toMatchObject({
      kind: "subscription.renewed",
      provider: "dodo",
      externalId: "sub_1",
    });
  });

  it("maps subscription.cancelled to subscription.ended", () => {
    const e = normalizeDodoEvent({
      type: "subscription.cancelled",
      data: { subscription_id: "sub_1" },
    });
    expect(e).toMatchObject({ kind: "subscription.ended", status: "canceled" });
  });

  it("returns null for unknown event types", () => {
    expect(normalizeDodoEvent({ type: "refund.succeeded", data: {} })).toBeNull();
  });

  it("returns null when user/plan metadata is missing", () => {
    expect(
      normalizeDodoEvent({ type: "payment.succeeded", data: { payment_id: "pay_1" } }),
    ).toBeNull();
  });
});

describe("dodo webhook idempotency", () => {
  it("claims a fresh dodo event, dedupes a replay", async () => {
    let calls = 0;
    const from = vi.fn().mockReturnValue({
      insert: () => {
        calls += 1;
        return Promise.resolve(calls === 1 ? { error: null } : { error: { code: "23505" } });
      },
    });
    const admin = { from } as unknown as SupabaseClient<Database>;
    expect(await claimBillingEvent(admin, "dodo", "wh_1", "payment.succeeded", {})).toBe(true);
    expect(await claimBillingEvent(admin, "dodo", "wh_1", "payment.succeeded", {})).toBe(false);
  });
});

describe("paymentsLive feature flag", () => {
  it("is off when no keys are set (checkout shows Coming soon)", () => {
    vi.stubEnv("DODO_API_KEY", "");
    vi.stubEnv("DODO_WEBHOOK_SECRET", "");
    vi.stubEnv("RAZORPAY_KEY_ID", "");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "");
    expect(isDodoConfigured()).toBe(false);
    expect(paymentsLive()).toEqual({ dodo: false, razorpay: false, any: false });
  });

  it("turns dodo on when both dodo secrets exist", () => {
    vi.stubEnv("DODO_API_KEY", "key_test");
    vi.stubEnv("DODO_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("RAZORPAY_KEY_ID", "");
    const live = paymentsLive();
    expect(live.dodo).toBe(true);
    expect(live.razorpay).toBe(false);
    expect(live.any).toBe(true);
  });
});

describe("dodoProvider.createCheckout (mocked fetch)", () => {
  const plan = { slug: "studio", name: "Studio" } as never;

  beforeEach(() => {
    vi.stubEnv("DODO_API_KEY", "test_key");
    vi.stubEnv("DODO_PRODUCT_IDS", JSON.stringify({ studio: "prod_studio_123" }));
  });

  function mockFetchOnce(json: unknown, ok = true, status = 200) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return {
          ok,
          status,
          json: async () => json,
          text: async () => JSON.stringify(json),
        };
      }),
    );
    return calls;
  }

  it("posts a checkout session with product, customer, and metadata", async () => {
    const calls = mockFetchOnce({
      checkout_url: "https://checkout.dodo.test/s/abc",
      session_id: "sess_abc",
    });
    const res = await dodoProvider.createCheckout({
      plan,
      userId: "user-1",
      userEmail: "user@example.com",
      currency: "usd",
      successUrl: "https://vidoratube.lovable.app/billing?ok=1",
      cancelUrl: "https://vidoratube.lovable.app/billing",
    });
    expect(res.redirectUrl).toBe("https://checkout.dodo.test/s/abc");
    expect(res.purchaseRef).toBe("sess_abc");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/checkout/sessions");
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.product_cart).toEqual([{ product_id: "prod_studio_123", quantity: 1 }]);
    expect(body.customer).toEqual({ email: "user@example.com" });
    expect(body.metadata).toEqual({ plan_slug: "studio", user_id: "user-1" });
    expect(body.return_url).toBe("https://vidoratube.lovable.app/billing?ok=1");
  });

  it("rejects non-USD currency (Razorpay handles INR)", async () => {
    const calls = mockFetchOnce({});
    await expect(
      dodoProvider.createCheckout({
        plan,
        userId: "user-1",
        userEmail: "user@example.com",
        currency: "inr",
        successUrl: "https://x",
        cancelUrl: "https://x",
      }),
    ).rejects.toThrow("USD only");
    expect(calls).toHaveLength(0);
  });

  it("throws when Dodo returns no checkout_url", async () => {
    mockFetchOnce({ session_id: "sess_no_url" });
    await expect(
      dodoProvider.createCheckout({
        plan,
        userId: "user-1",
        userEmail: "user@example.com",
        currency: "usd",
        successUrl: "https://x",
        cancelUrl: "https://x",
      }),
    ).rejects.toThrow("checkout_url");
  });

  it("throws a readable error on Dodo API failure", async () => {
    mockFetchOnce({ message: "bad product" }, false, 400);
    await expect(
      dodoProvider.createCheckout({
        plan,
        userId: "user-1",
        userEmail: "user@example.com",
        currency: "usd",
        successUrl: "https://x",
        cancelUrl: "https://x",
      }),
    ).rejects.toThrow("Dodo API error (400)");
  });
});
