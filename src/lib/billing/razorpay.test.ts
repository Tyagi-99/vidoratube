import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isRazorpayConfigured,
  verifyRazorpayWebhookSignature,
} from "./razorpay";
import { paymentsLive } from "./payments-live";

const ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ENV };
});

afterEach(() => {
  process.env = { ...ENV };
  vi.restoreAllMocks();
});

describe("verifyRazorpayWebhookSignature", () => {
  const secret = "test_webhook_secret";

  beforeEach(() => {
    process.env["RAZORPAY_WEBHOOK_SECRET"] = secret;
  });

  it("accepts a valid signature", () => {
    const body = JSON.stringify({ event: "payment.captured", payload: {} });
    const sig = createHmac("sha256", secret).update(body, "utf8").digest("hex");
    expect(() => verifyRazorpayWebhookSignature(body, sig)).not.toThrow();
  });

  it("rejects a bad signature", () => {
    expect(() =>
      verifyRazorpayWebhookSignature("{}", "0".repeat(64)),
    ).toThrow("Invalid Razorpay webhook signature.");
  });

  it("rejects a missing signature header", () => {
    expect(() => verifyRazorpayWebhookSignature("{}", null)).toThrow(
      "Missing Razorpay signature header.",
    );
  });

  it("throws when the webhook secret is not configured", () => {
    delete process.env["RAZORPAY_WEBHOOK_SECRET"];
    expect(() => verifyRazorpayWebhookSignature("{}", "abc")).toThrow(
      "RAZORPAY_WEBHOOK_SECRET is not configured.",
    );
  });
});

describe("paymentsLive razorpay flag", () => {
  it("requires all three Razorpay vars (key id, key secret, webhook secret)", () => {
    delete process.env["RAZORPAY_KEY_ID"];
    delete process.env["RAZORPAY_KEY_SECRET"];
    delete process.env["RAZORPAY_WEBHOOK_SECRET"];
    expect(paymentsLive().razorpay).toBe(false);
    expect(isRazorpayConfigured()).toBe(false);

    process.env["RAZORPAY_KEY_ID"] = "rzp_test_id";
    process.env["RAZORPAY_KEY_SECRET"] = "rzp_test_secret";
    // Webhook secret still missing -> still off.
    expect(paymentsLive().razorpay).toBe(false);
    expect(isRazorpayConfigured()).toBe(false);

    process.env["RAZORPAY_WEBHOOK_SECRET"] = "rzp_test_whsec";
    expect(paymentsLive().razorpay).toBe(true);
    expect(isRazorpayConfigured()).toBe(true);
  });
});
