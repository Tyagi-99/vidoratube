import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { defaultCurrency, formatPrice, getPlan, PLANS } from "./plans";
import {
  eventRefUuid,
  settleRenderBilling,
  startedMinutes,
  DEFAULT_RENDER_RESERVE_MINUTES,
} from "./billing-math";

describe("plans", () => {
  it("catalog has subscriptions and packs with both currencies", () => {
    expect(PLANS.length).toBeGreaterThanOrEqual(5);
    for (const p of PLANS) {
      expect(getPlan(p.slug)).toBe(p);
      expect(p.credits).toBeGreaterThan(0);
    }
  });

  it("formats INR and USD prices", () => {
    const creator = getPlan("creator")!;
    expect(formatPrice(creator, "inr")).toContain("₹");
    expect(formatPrice(creator, "usd")).toContain("$");
    expect(formatPrice(creator, "inr")).toBe("₹1,599");
    expect(formatPrice(creator, "usd")).toBe("$19");
  });

  it("defaults to INR for India, USD elsewhere", () => {
    expect(defaultCurrency("IN")).toBe("inr");
    expect(defaultCurrency("in")).toBe("inr");
    expect(defaultCurrency("US")).toBe("usd");
    expect(defaultCurrency(null)).toBe("usd");
    expect(defaultCurrency(undefined)).toBe("usd");
  });
});

describe("billing-math", () => {
  it("eventRefUuid is deterministic and UUID-shaped", () => {
    const a = eventRefUuid("stripe", "evt_123");
    const b = eventRefUuid("stripe", "evt_123");
    const c = eventRefUuid("stripe", "evt_124");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("startedMinutes rounds up with a 1-minute floor", () => {
    expect(startedMinutes(1)).toBe(1);
    expect(startedMinutes(60)).toBe(1);
    expect(startedMinutes(61)).toBe(2);
    expect(startedMinutes(600)).toBe(10);
    expect(startedMinutes(0)).toBe(1);
    expect(startedMinutes(-5)).toBe(1);
    expect(startedMinutes(NaN)).toBe(1);
  });

  it("settleRenderBilling computes adjustments", () => {
    // Over the reserve: debit the difference.
    expect(settleRenderBilling(10, 14)).toEqual({ adjustment: 4, totalCharged: 14 });
    // Under the reserve: refund the difference.
    expect(settleRenderBilling(10, 6)).toEqual({ adjustment: -4, totalCharged: 6 });
    // Exact: no adjustment.
    expect(settleRenderBilling(10, 10)).toEqual({ adjustment: 0, totalCharged: 10 });
  });

  it("default reserve is sane", () => {
    expect(DEFAULT_RENDER_RESERVE_MINUTES).toBeGreaterThanOrEqual(5);
  });
});

describe("webhook signatures", () => {
  it("stripe signature verification accepts a valid fixture", async () => {
    process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_test_secret";
    const { verifyStripeWebhookSignature } = await import("./stripe");
    const rawBody = JSON.stringify({ id: "evt_test", type: "checkout.session.completed" });
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = createHmac("sha256", "whsec_test_secret").update(`${ts}.${rawBody}`).digest("hex");
    expect(() => verifyStripeWebhookSignature(rawBody, `t=${ts},v1=${sig}`)).not.toThrow();
    // Tampered body must fail.
    expect(() => verifyStripeWebhookSignature(rawBody + "x", `t=${ts},v1=${sig}`)).toThrow();
    // Wrong secret must fail.
    const bad = createHmac("sha256", "whsec_wrong").update(`${ts}.${rawBody}`).digest("hex");
    expect(() => verifyStripeWebhookSignature(rawBody, `t=${ts},v1=${bad}`)).toThrow();
    // Stale timestamp must fail (replay protection).
    const oldTs = (Math.floor(Date.now() / 1000) - 3600).toString();
    const oldSig = createHmac("sha256", "whsec_test_secret").update(`${oldTs}.${rawBody}`).digest("hex");
    expect(() => verifyStripeWebhookSignature(rawBody, `t=${oldTs},v1=${oldSig}`)).toThrow();
    delete process.env["STRIPE_WEBHOOK_SECRET"];
  });

  it("razorpay webhook signature verification accepts a valid fixture", async () => {
    process.env["RAZORPAY_WEBHOOK_SECRET"] = "rzp_test_secret";
    const { verifyRazorpayWebhookSignature } = await import("./razorpay");
    const rawBody = JSON.stringify({ event: "payment.captured" });
    const sig = createHmac("sha256", "rzp_test_secret").update(rawBody).digest("hex");
    expect(() => verifyRazorpayWebhookSignature(rawBody, sig)).not.toThrow();
    expect(() => verifyRazorpayWebhookSignature(rawBody + "x", sig)).toThrow();
    expect(() => verifyRazorpayWebhookSignature(rawBody, null)).toThrow();
    delete process.env["RAZORPAY_WEBHOOK_SECRET"];
  });

  it("razorpay payment verification uses order_id|payment_id", async () => {
    process.env["RAZORPAY_KEY_ID"] = "rzp_test_key";
    process.env["RAZORPAY_KEY_SECRET"] = "rzp_test_secret2";
    const { verifyRazorpayPayment } = await import("./razorpay");
    const orderId = "order_abc";
    const paymentId = "pay_xyz";
    const sig = createHmac("sha256", "rzp_test_secret2").update(`${orderId}|${paymentId}`).digest("hex");
    expect(verifyRazorpayPayment(orderId, paymentId, sig)).toBe(true);
    expect(verifyRazorpayPayment(orderId, "pay_other", sig)).toBe(false);
    delete process.env["RAZORPAY_KEY_ID"];
    delete process.env["RAZORPAY_KEY_SECRET"];
  });
});
