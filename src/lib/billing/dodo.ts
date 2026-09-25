/**
 * Dodo Payments adapter (USD, Merchant of Record).
 *
 * Direct REST via fetch — no SDK. Dodo follows the Standard Webhooks spec:
 * headers `webhook-id` / `webhook-signature` / `webhook-timestamp`, where the
 * signature is base64(HMAC-SHA256(secret, "{id}.{timestamp}.{rawBody}")),
 * sent as `v1,<sig>`. Timestamp tolerance: 5 minutes.
 *
 * TEST MODE: DODO_ENVIRONMENT defaults to "test". Products must be created in
 * the Dodo dashboard; map plan slugs to Dodo product ids via DODO_PRODUCT_IDS
 * (JSON, e.g. {"creator":"prod_abc","pack_s":"prod_def"}).
 *
 * Sources: Dodo Payments webhook docs (docs.dodopayments.com) + Standard
 * Webhooks spec. Stripe remains addable later: it just needs a stripe.ts
 * adapter implementing BillingProvider — no business-logic changes.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  BillingProvider,
  CheckoutRequest,
  CheckoutResult,
  ProviderSubscription,
} from "./providers";

const TEST_API = "https://test.dodopayments.com";
const LIVE_API = "https://live.dodopayments.com";
const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

function apiKey(): string {
  const v = process.env["DODO_API_KEY"];
  if (!v) throw new Error("Dodo Payments is not configured (DODO_API_KEY missing).");
  return v;
}

function webhookSecret(): string {
  const v = process.env["DODO_WEBHOOK_SECRET"];
  if (!v) throw new Error("DODO_WEBHOOK_SECRET is not configured.");
  return v;
}

function apiBase(): string {
  return process.env["DODO_ENVIRONMENT"] === "live" ? LIVE_API : TEST_API;
}

export function isDodoConfigured(): boolean {
  return Boolean(process.env["DODO_API_KEY"] && process.env["DODO_WEBHOOK_SECRET"]);
}

/** Plan slug -> Dodo product id mapping (dashboard-created products). */
function productIdForPlan(planSlug: string): string {
  const raw = process.env["DODO_PRODUCT_IDS"] ?? "{}";
  let map: Record<string, string>;
  try {
    map = JSON.parse(raw) as Record<string, string>;
  } catch {
    throw new Error("DODO_PRODUCT_IDS is not valid JSON.");
  }
  const id = map[planSlug];
  if (!id) {
    throw new Error(
      `No Dodo product configured for plan "${planSlug}". Create the product in the Dodo dashboard and add it to DODO_PRODUCT_IDS.`,
    );
  }
  return id;
}

async function dodoFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Dodo API error (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<unknown>;
}

export interface DodoWebhookHeaders {
  id: string | null;
  signature: string | null;
  timestamp: string | null;
}

/**
 * Verify a Dodo webhook (Standard Webhooks). Throws on failure.
 * Pure and fully unit-testable.
 */
export function verifyDodoWebhookSignature(
  rawBody: string,
  headers: DodoWebhookHeaders,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): void {
  const secret = webhookSecret();
  if (!headers.id) throw new Error("Missing webhook-id header.");
  if (!headers.signature) throw new Error("Missing webhook-signature header.");
  if (!headers.timestamp) throw new Error("Missing webhook-timestamp header.");

  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts)) throw new Error("Invalid webhook-timestamp header.");
  if (Math.abs(nowSeconds - ts) > TIMESTAMP_TOLERANCE_SECONDS) {
    throw new Error("Webhook timestamp outside tolerance (possible replay).");
  }

  const signed = `${headers.id}.${headers.timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(signed, "utf8").digest("base64");
  const candidates = headers.signature.split(/[,\s]+/).map((s) => s.replace(/^v1,/, ""));
  const ok = candidates.some((sig) => {
    const a = Buffer.from(sig, "utf8");
    const b = Buffer.from(expected, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  });
  if (!ok) throw new Error("Invalid Dodo webhook signature.");
}

export interface DodoEvent {
  /** Standard Webhooks envelope id (also in the header). */
  id?: string;
  type: string;
  data: Record<string, unknown>;
}

/** Normalize a Dodo event to a domain billing event. Returns null for ignored types. */
export function normalizeDodoEvent(event: DodoEvent): import("./billing-math").DomainBillingEvent | null {
  const data = event.data ?? {};
  const metadata = (data["metadata"] ?? {}) as Record<string, string>;
  const userId = metadata["user_id"];
  const planSlug = metadata["plan_slug"];

  switch (event.type) {
    case "payment.succeeded": {
      // One-time product purchase (credit packs). Subscriptions report via
      // subscription.* events; skip payment.succeeded when it carries a
      // subscription_id to avoid double-granting.
      if (data["subscription_id"] || !userId || !planSlug) return null;
      return {
        kind: "purchase.completed",
        userId,
        planSlug,
        credits: 0, // resolved by the handler from the plan catalog
        provider: "dodo",
        providerRef: String(data["payment_id"] ?? event.id ?? ""),
      };
    }
    case "subscription.active":
    case "subscription.renewed": {
      if (!userId || !planSlug) return null;
      return {
        kind: "subscription.renewed",
        userId,
        planSlug,
        credits: 0, // resolved by the handler from the plan catalog
        provider: "dodo",
        externalId: String(data["subscription_id"] ?? ""),
        periodStart: null,
        periodEnd: null,
      };
    }
    case "subscription.cancelled":
    case "subscription.expired": {
      return {
        kind: "subscription.ended",
        provider: "dodo",
        externalId: String(data["subscription_id"] ?? ""),
        status: "canceled",
      };
    }
    default:
      return null;
  }
}

export const dodoProvider: BillingProvider = {
  name: "dodo",
  isConfigured: isDodoConfigured,

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    if (req.currency !== "usd") {
      throw new Error("Dodo checkout supports USD only; use Razorpay for INR.");
    }
    const productId = productIdForPlan(req.plan.slug);
    const session = (await dodoFetch("/checkout/sessions", {
      method: "POST",
      body: JSON.stringify({
        product_cart: [{ product_id: productId, quantity: 1 }],
        customer: { email: req.userEmail },
        return_url: req.successUrl,
        metadata: { plan_slug: req.plan.slug, user_id: req.userId },
      }),
    })) as { checkout_url: string; session_id: string };
    if (!session.checkout_url) throw new Error("Dodo did not return a checkout_url.");
    return {
      provider: "dodo",
      redirectUrl: session.checkout_url,
      purchaseRef: session.session_id,
    };
  },

  async createCustomerPortalUrl(externalCustomerId: string, returnUrl: string): Promise<string> {
    const res = (await dodoFetch("/customers/portal-sessions", {
      method: "POST",
      body: JSON.stringify({ customer_id: externalCustomerId, return_url: returnUrl }),
    })) as { portal_url?: string; url?: string };
    const url = res.portal_url ?? res.url;
    if (!url) throw new Error("Dodo did not return a portal URL.");
    return url;
  },

  async cancelSubscription(externalSubscriptionId: string): Promise<void> {
    await dodoFetch(`/subscriptions/${externalSubscriptionId}/cancel`, { method: "POST" });
  },

  async getSubscription(externalSubscriptionId: string): Promise<ProviderSubscription> {
    const sub = (await dodoFetch(`/subscriptions/${externalSubscriptionId}`)) as {
      subscription_id?: string;
      id?: string;
      status?: string;
      current_period_start?: string | null;
      current_period_end?: string | null;
      cancel_at_next_billing_date?: boolean;
      customer_id?: string;
    };
    return {
      externalId: String(sub.subscription_id ?? sub.id ?? externalSubscriptionId),
      status: String(sub.status ?? "unknown"),
      currentPeriodStart: sub.current_period_start ?? null,
      currentPeriodEnd: sub.current_period_end ?? null,
      cancelAtPeriodEnd: Boolean(sub.cancel_at_next_billing_date),
    };
  },

  async getCustomerIdForSubscription(externalSubscriptionId: string): Promise<string> {
    const sub = (await dodoFetch(`/subscriptions/${externalSubscriptionId}`)) as {
      customer_id?: string;
    };
    if (!sub.customer_id) throw new Error("Dodo subscription has no customer id.");
    return sub.customer_id;
  },
};
