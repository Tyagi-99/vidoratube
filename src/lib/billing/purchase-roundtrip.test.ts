/**
 * Sprint 1-2: investor-required test-mode purchase verification.
 *
 * Full round trip for a one-time credit-pack purchase ("Growth pack", pack_m —
 * there is no "Maker" plan in the catalog; see docs/DECISIONS.md D6) on both
 * providers, with mocked fetch (no network, no real money):
 *
 *   checkout session creation -> webhook delivery -> signature verification
 *   -> event claim -> credit grant -> DUPLICATE delivery grants only once.
 *
 * The pipeline mirrors the thin route handlers
 * (src/routes/api/webhooks/{dodo,razorpay}.ts) step for step: verify, parse,
 * derive the stable event id, claimBillingEvent, normalize, resolve credits
 * from OUR plan catalog (never the payload), processDomainEvent.
 */
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { dodoProvider, normalizeDodoEvent, verifyDodoWebhookSignature } from "./dodo";
import { razorpayProvider, verifyRazorpayWebhookSignature } from "./razorpay";
import { getPlan } from "./plans";
import {
  claimBillingEvent,
  markBillingEventProcessed,
  processDomainEvent,
} from "./webhooks.server";

/* ---------------- mock supabase admin with a real claim-once behavior -------- */

interface MockState {
  claimed: Set<string>;
  rpcCalls: { name: string; args: Record<string, unknown> }[];
  upserts: { table: string; row: unknown }[];
}

function mockAdmin(state: MockState) {
  const updateChain = { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
  const admin = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      return { data: 1, error: null };
    }),
    from: (table: string) => ({
      insert: (row: { provider: string; event_id: string }) => {
        const key = `${table}:${row.provider}:${row.event_id}`;
        if (state.claimed.has(key)) {
          return Promise.resolve({ error: { code: "23505", message: "duplicate key" } });
        }
        state.claimed.add(key);
        return Promise.resolve({ error: null });
      },
      update: () => updateChain,
      upsert: (row: unknown) => {
        state.upserts.push({ table, row });
        return Promise.resolve({ error: null });
      },
    }),
  } as unknown as SupabaseClient<Database>;
  return admin;
}

const newState = (): MockState => ({ claimed: new Set(), rpcCalls: [], upserts: [] });

function grantCalls(state: MockState) {
  return state.rpcCalls.filter((c) => c.name === "grant_credits_once");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const USER_ID = "user_roundtrip_1";
const PLAN_SLUG = "pack_m"; // Growth pack: 70 credits, one-time — the purchase path on both providers.

/* ============================ DODO (USD) =================================== */

describe("Dodo USD purchase round trip (test mode)", () => {
  const SECRET = "whsec_dodo_test_secret";

  beforeEach(() => {
    vi.stubEnv("DODO_API_KEY", "dodo_test_key");
    vi.stubEnv("DODO_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("DODO_PRODUCT_IDS", JSON.stringify({ [PLAN_SLUG]: "prod_test_pack_m" }));
  });

  function sign(id: string, ts: string, body: string): string {
    const sig = createHmac("sha256", SECRET)
      .update(`${id}.${ts}.${body}`, "utf8")
      .digest("base64");
    return `v1,${sig}`;
  }

  it("checkout -> webhook -> signature -> claim -> 70 credits granted; duplicate grants nothing", async () => {
    const plan = getPlan(PLAN_SLUG)!;
    expect(plan.credits).toBe(70);

    // 1) Checkout session creation (mocked Dodo TEST API).
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          checkout_url: "https://checkout.dodo.test/sess_test_1",
          session_id: "sess_test_1",
        }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const checkout = await dodoProvider.createCheckout({
      plan,
      currency: "usd",
      userId: USER_ID,
      userEmail: "buyer@example.com",
      successUrl: "https://vidoratube.lovable.app/billing?purchase=success",
      cancelUrl: "https://vidoratube.lovable.app/billing?purchase=cancelled",
    });
    expect(checkout.provider).toBe("dodo");
    expect(checkout.redirectUrl).toBe("https://checkout.dodo.test/sess_test_1");

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://test.dodopayments.com/checkout/sessions");
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.metadata).toEqual({ plan_slug: PLAN_SLUG, user_id: USER_ID });

    // 2) Webhook delivery: payment.succeeded with our metadata.
    const body = JSON.stringify({
      id: "wh_test_1",
      type: "payment.succeeded",
      data: {
        payment_id: "pay_test_1",
        metadata: { user_id: USER_ID, plan_slug: PLAN_SLUG },
      },
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const headers = { id: "wh_test_1", signature: sign("wh_test_1", ts, body), timestamp: ts };

    // 3) Signature verification (real crypto).
    expect(() => verifyDodoWebhookSignature(body, headers)).not.toThrow();

    // 4) Claim + normalize + grant (route pipeline).
    const state = newState();
    const admin = mockAdmin(state);
    const eventId = headers.id;
    const first = await claimBillingEvent(admin, "dodo", eventId, "payment.succeeded", JSON.parse(body));
    expect(first).toBe(true);

    const domain = normalizeDodoEvent(JSON.parse(body));
    // Credits come from OUR catalog, never the payload.
    if (domain?.kind !== "purchase.completed") throw new Error("expected purchase.completed");
    await processDomainEvent(admin, { ...domain, credits: plan.credits });
    await markBillingEventProcessed(admin, "dodo", eventId);

    const grants = grantCalls(state);
    expect(grants).toHaveLength(1);
    expect(grants[0]!.args).toMatchObject({
      p_user_id: USER_ID,
      p_amount: 70,
      p_reason: `dodo purchase: ${PLAN_SLUG}`,
    });
    const ref = grants[0]!.args["p_ref_id"] as string;
    expect(ref).toMatch(/^[0-9a-f-]{36}$/);

    // 5) DUPLICATE delivery: same webhook-id -> claim returns false -> no grant.
    const replay = await claimBillingEvent(admin, "dodo", eventId, "payment.succeeded", JSON.parse(body));
    expect(replay).toBe(false);
    expect(grantCalls(state)).toHaveLength(1); // still exactly one grant
  });

  it("a tampered webhook body fails signature verification", () => {
    const body = JSON.stringify({ id: "wh_test_1", type: "payment.succeeded", data: {} });
    const ts = String(Math.floor(Date.now() / 1000));
    const tampered = body.replace("payment.succeeded", "payment.failed");
    expect(() =>
      verifyDodoWebhookSignature(tampered, {
        id: "wh_test_1",
        signature: sign("wh_test_1", ts, body),
        timestamp: ts,
      }),
    ).toThrow(/Invalid Dodo webhook signature/);
  });

  it("subscription.active grants the plan's monthly credits and upserts the subscription", async () => {
    const plan = getPlan("creator")!;
    const body = JSON.stringify({
      id: "wh_test_2",
      type: "subscription.active",
      data: {
        subscription_id: "sub_test_1",
        metadata: { user_id: USER_ID, plan_slug: "creator" },
      },
    });
    const ts = String(Math.floor(Date.now() / 1000));
    expect(() =>
      verifyDodoWebhookSignature(body, {
        id: "wh_test_2",
        signature: sign("wh_test_2", ts, body),
        timestamp: ts,
      }),
    ).not.toThrow();

    const state = newState();
    const admin = mockAdmin(state);
    expect(await claimBillingEvent(admin, "dodo", "wh_test_2", "subscription.active", {})).toBe(true);
    const domain = normalizeDodoEvent(JSON.parse(body));
    if (domain?.kind !== "subscription.renewed") throw new Error("expected subscription.renewed");
    await processDomainEvent(admin, { ...domain, credits: plan.credits });

    expect(state.upserts).toHaveLength(1);
    expect(state.upserts[0]!.row).toMatchObject({ user_id: USER_ID, provider: "dodo" });
    const grants = grantCalls(state);
    expect(grants).toHaveLength(1);
    expect(grants[0]!.args["p_amount"]).toBe(60);
  });
});

/* =========================== RAZORPAY (INR) ================================ */

describe("Razorpay INR purchase round trip (test mode)", () => {
  const WEBHOOK_SECRET = "rzp_test_webhook_secret";

  beforeEach(() => {
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_key");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "rzp_test_secret");
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", WEBHOOK_SECRET);
  });

  it("order -> payment.captured webhook -> signature -> claim -> 70 credits; duplicate grants nothing", async () => {
    const plan = getPlan(PLAN_SLUG)!;
    expect(plan.priceInrPaise).toBe(159900);

    // 1) Order creation (mocked Razorpay API).
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "order_test_1", amount: 159900, currency: "INR" }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const checkout = await razorpayProvider.createCheckout({
      plan,
      currency: "inr",
      userId: USER_ID,
      userEmail: "buyer@example.com",
      successUrl: "https://vidoratube.lovable.app/billing?purchase=success",
      cancelUrl: "https://vidoratube.lovable.app/billing?purchase=cancelled",
    });
    expect(checkout.provider).toBe("razorpay");
    expect(checkout.razorpayOrder?.orderId).toBe("order_test_1");

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.razorpay.com/v1/orders");
    expect((init.headers as Record<string, string>)["Authorization"]).toMatch(/^Basic /);
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody).toMatchObject({ amount: 159900, currency: "INR" });

    // 2) Webhook delivery: payment.captured.
    const body = JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_rz_test_1",
            notes: { user_id: USER_ID, plan_slug: PLAN_SLUG },
          },
        },
      },
    });
    const signature = createHmac("sha256", WEBHOOK_SECRET).update(body, "utf8").digest("hex");

    // 3) Signature verification (real crypto).
    expect(() => verifyRazorpayWebhookSignature(body, signature)).not.toThrow();

    // 4) Claim + handle (mirrors the route: event id derived from the payload).
    const state = newState();
    const admin = mockAdmin(state);
    const eventId = `payment.captured:pay_rz_test_1`;
    expect(await claimBillingEvent(admin, "razorpay", eventId, "payment.captured", {})).toBe(true);

    // Route's handleRazorpayEvent for payment.captured (packs only):
    const payment = JSON.parse(body).payload.payment.entity;
    const notes = payment.notes as Record<string, string>;
    const packPlan = getPlan(notes["plan_slug"] ?? "");
    expect(packPlan?.kind).toBe("pack");
    await processDomainEvent(admin, {
      kind: "purchase.completed",
      userId: notes["user_id"]!,
      planSlug: packPlan!.slug,
      credits: packPlan!.credits,
      provider: "razorpay",
      providerRef: String(payment["id"] ?? ""),
    });
    await markBillingEventProcessed(admin, "razorpay", eventId);

    const grants = grantCalls(state);
    expect(grants).toHaveLength(1);
    expect(grants[0]!.args).toMatchObject({
      p_user_id: USER_ID,
      p_amount: 70,
      p_reason: `razorpay purchase: ${PLAN_SLUG}`,
    });

    // 5) DUPLICATE delivery -> deduped, no second grant.
    expect(await claimBillingEvent(admin, "razorpay", eventId, "payment.captured", {})).toBe(false);
    expect(grantCalls(state)).toHaveLength(1);
  });

  it("a wrong webhook secret fails verification", () => {
    const body = JSON.stringify({ event: "payment.captured", payload: {} });
    const bad = createHmac("sha256", "wrong_secret").update(body, "utf8").digest("hex");
    expect(() => verifyRazorpayWebhookSignature(body, bad)).toThrow(
      /Invalid Razorpay webhook signature/,
    );
  });
});
