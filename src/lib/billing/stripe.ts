/**
 * P7: Stripe adapter (global / USD).
 *
 * Direct REST via fetch — no SDK. Webhook signature verification is pure
 * HMAC-SHA256 (Stripe scheme: header `t=<ts>,v1=<sig>`, signed payload
 * `<ts>.<rawBody>`).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  BillingProvider,
  CheckoutRequest,
  CheckoutResult,
  ProviderSubscription,
} from "./providers";

const API = "https://api.stripe.com/v1";

function secretKey(): string {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) throw new Error("Stripe is not configured (STRIPE_SECRET_KEY missing).");
  return key;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env["STRIPE_SECRET_KEY"]);
}

async function stripeFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Stripe API error (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<unknown>;
}

/** Verify a Stripe webhook signature. Throws on failure. */
export function verifyStripeWebhookSignature(rawBody: string, header: string | null): void {
  const secret = process.env["STRIPE_WEBHOOK_SECRET"];
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not configured.");
  if (!header) throw new Error("Missing Stripe signature header.");
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=", 2) as [string, string]));
  const ts = parts["t"];
  const v1 = parts["v1"];
  if (!ts || !v1) throw new Error("Malformed Stripe signature header.");
  // Reject stale signatures (>5 min) to blunt replay attacks.
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) {
    throw new Error("Stripe webhook timestamp too old.");
  }
  const expected = createHmac("sha256", secret).update(`${ts}.${rawBody}`, "utf8").digest("hex");
  const a = Buffer.from(v1, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("Invalid Stripe webhook signature.");
  }
}

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

function form(params: Record<string, string | undefined>): string {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body.append(k, v);
  return body.toString();
}

export const stripeProvider: BillingProvider = {
  name: "stripe",
  isConfigured: isStripeConfigured,

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    if (req.currency !== "usd") {
      throw new Error("Stripe checkout supports USD only; use Razorpay for INR.");
    }
    const cents = req.plan.priceUsdCents;
    if (cents == null) throw new Error(`Plan ${req.plan.slug} has no USD price.`);
    const mode = req.plan.kind === "subscription" ? "subscription" : "payment";
    const params: Record<string, string | undefined> = {
      mode,
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(cents),
      "line_items[0][price_data][product_data][name]": `Vidora — ${req.plan.name}`,
      "line_items[0][quantity]": "1",
      success_url: `${req.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: req.cancelUrl,
      client_reference_id: req.userId,
      customer_email: req.userEmail || undefined,
      "metadata[plan_slug]": req.plan.slug,
      "metadata[user_id]": req.userId,
    };
    if (req.plan.kind === "subscription") {
      params["line_items[0][price_data][recurring][interval]"] = "month";
    }
    const session = (await stripeFetch("/checkout/sessions", {
      method: "POST",
      body: form(params),
    })) as { id: string; url: string };
    return { provider: "stripe", redirectUrl: session.url, purchaseRef: session.id };
  },

  async createCustomerPortalUrl(externalCustomerId: string, returnUrl: string): Promise<string> {
    const session = (await stripeFetch("/billing_portal/sessions", {
      method: "POST",
      body: form({ customer: externalCustomerId, return_url: returnUrl }),
    })) as { url: string };
    return session.url;
  },

  async cancelSubscription(externalSubscriptionId: string): Promise<void> {
    await stripeFetch(`/subscriptions/${externalSubscriptionId}`, {
      method: "DELETE",
      body: form({}),
    });
  },

  async getSubscription(externalSubscriptionId: string): Promise<ProviderSubscription> {
    const sub = (await stripeFetch(`/subscriptions/${externalSubscriptionId}`)) as {
      id: string;
      status: string;
      current_period_start: number;
      current_period_end: number;
      cancel_at_period_end: boolean;
    };
    return {
      externalId: sub.id,
      status: sub.status,
      currentPeriodStart: new Date(sub.current_period_start * 1000).toISOString(),
      currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    };
  },
};
