/**
 * P7: Razorpay adapter (India / INR).
 *
 * Direct REST via fetch — no SDK. Webhook signature: header
 * `x-razorpay-signature` = HMAC-SHA256(rawBody, webhook_secret).
 * Payment verification (client callback): HMAC-SHA256(order_id|payment_id).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  BillingProvider,
  CheckoutRequest,
  CheckoutResult,
  ProviderSubscription,
} from "./providers";

const API = "https://api.razorpay.com/v1";

function keyId(): string {
  const v = process.env["RAZORPAY_KEY_ID"];
  if (!v) throw new Error("Razorpay is not configured (RAZORPAY_KEY_ID missing).");
  return v;
}

function keySecret(): string {
  const v = process.env["RAZORPAY_KEY_SECRET"];
  if (!v) throw new Error("Razorpay is not configured (RAZORPAY_KEY_SECRET missing).");
  return v;
}

export function isRazorpayConfigured(): boolean {
  return Boolean(
    process.env["RAZORPAY_KEY_ID"] &&
      process.env["RAZORPAY_KEY_SECRET"] &&
      process.env["RAZORPAY_WEBHOOK_SECRET"],
  );
}

async function razorpayFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId()}:${keySecret()}`).toString("base64")}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Razorpay API error (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<unknown>;
}

/** Verify a Razorpay webhook signature. Throws on failure. */
export function verifyRazorpayWebhookSignature(rawBody: string, signature: string | null): void {
  const secret = process.env["RAZORPAY_WEBHOOK_SECRET"];
  if (!secret) throw new Error("RAZORPAY_WEBHOOK_SECRET is not configured.");
  if (!signature) throw new Error("Missing Razorpay signature header.");
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("Invalid Razorpay webhook signature.");
  }
}

/** Verify a Razorpay checkout payment callback (order_id|payment_id). */
export function verifyRazorpayPayment(orderId: string, paymentId: string, signature: string): boolean {
  const expected = createHmac("sha256", keySecret())
    .update(`${orderId}|${paymentId}`, "utf8")
    .digest("hex");
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface RazorpayEvent {
  event: string;
  payload: {
    payment?: { entity: Record<string, unknown> };
    order?: { entity: Record<string, unknown> };
    subscription?: { entity: Record<string, unknown> };
  };
}

export const razorpayProvider: BillingProvider = {
  name: "razorpay",
  isConfigured: isRazorpayConfigured,

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    if (req.currency !== "inr") {
      throw new Error("Razorpay checkout supports INR only; use Dodo for USD.");
    }
    const paise = req.plan.priceInrPaise;
    if (paise == null) throw new Error(`Plan ${req.plan.slug} has no INR price.`);
    if (req.plan.kind === "subscription") {
      // Subscriptions need a Razorpay plan id created in the dashboard.
      // Until then, fail with a clear message (see docs/BILLING.md).
      throw new Error(
        "Razorpay subscriptions are not set up yet. Choose a credit pack, or pay with Dodo (USD).",
      );
    }
    const order = (await razorpayFetch("/orders", {
      method: "POST",
      body: JSON.stringify({
        amount: paise,
        currency: "INR",
        receipt: `vidora_${req.userId.slice(0, 8)}_${Date.now()}`,
        notes: { plan_slug: req.plan.slug, user_id: req.userId },
      }),
    })) as { id: string; amount: number; currency: string };
    return {
      provider: "razorpay",
      razorpayOrder: { orderId: order.id, amount: order.amount, currency: order.currency, keyId: keyId() },
      purchaseRef: order.id,
    };
  },

  async createCustomerPortalUrl(): Promise<string> {
    throw new Error("Razorpay has no customer portal; manage subscriptions from the billing page.");
  },

  async cancelSubscription(externalSubscriptionId: string): Promise<void> {
    await razorpayFetch(`/subscriptions/${externalSubscriptionId}/cancel`, { method: "POST" });
  },

  async getSubscription(externalSubscriptionId: string): Promise<ProviderSubscription> {
    const sub = (await razorpayFetch(`/subscriptions/${externalSubscriptionId}`)) as {
      id: string;
      status: string;
      current_start: number | null;
      current_end: number | null;
      cancel_at_cycle_end?: boolean;
      customer_id?: string;
    };
    return {
      externalId: sub.id,
      status: sub.status,
      currentPeriodStart: sub.current_start ? new Date(sub.current_start * 1000).toISOString() : null,
      currentPeriodEnd: sub.current_end ? new Date(sub.current_end * 1000).toISOString() : null,
      cancelAtPeriodEnd: Boolean(sub.cancel_at_cycle_end),
    };
  },

  async getCustomerIdForSubscription(externalSubscriptionId: string): Promise<string> {
    const sub = (await razorpayFetch(`/subscriptions/${externalSubscriptionId}`)) as {
      customer_id?: string;
    };
    if (!sub.customer_id) throw new Error("Razorpay subscription has no customer id.");
    return sub.customer_id;
  },
};
