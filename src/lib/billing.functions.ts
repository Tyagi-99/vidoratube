import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireAppUser } from "./server-auth";
import { getPlan, type Currency } from "./billing/plans";
import { isDodoConfigured } from "./billing/dodo";
import { isRazorpayConfigured } from "./billing/razorpay";
import { DEFAULT_RENDER_RESERVE_MINUTES } from "./billing/billing-math";

/**
 * P7: Billing server functions.
 *
 * - getBillingConfig: which providers are configured (public).
 * - getBillingState: balance, plans, own subscriptions, recent ledger (auth).
 * - createCheckout: hosted checkout for a plan/pack (auth, rate-limited).
 * - cancelSubscription: cancel own subscription at provider + DB (auth).
 * - createPortalSession: Stripe billing portal (auth).
 *
 * Money rules: test mode until the user completes docs/BILLING.md go-live.
 * Card data never touches our servers — provider-hosted checkout only.
 */

const CheckoutSchema = z.object({
  planSlug: z.string().min(1).max(50),
  currency: z.enum(["inr", "usd"]),
});

async function enforceBillingRateLimit(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { enforcePostgresRateLimit } = await import("./rate-limit");
  await enforcePostgresRateLimit(
    supabaseAdmin,
    `billing:checkout:${userId}`,
    { max: 10, windowSeconds: 3600 },
    "Too many checkout attempts. Please wait a bit and try again.",
  );
}

/** Public: which payment providers are configured. */
export const getBillingConfig = createServerFn({ method: "GET" }).handler(async () => ({
  dodo: isDodoConfigured(),
  razorpay: isRazorpayConfigured(),
}));

/** Authenticated billing overview. */
export const getBillingState = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: profile } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();

    const { data: plans } = await supabase
      .from("plans")
      .select("slug,name,kind,credits_granted,interval,price_usd_cents,price_inr_paise")
      .eq("active", true)
      .order("price_usd_cents", { ascending: true });

    const { data: subscriptions } = await supabase
      .from("subscriptions")
      .select("id,provider,plan_slug,status,current_period_end,cancel_at_period_end")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    const { data: ledger } = await supabase
      .from("credit_ledger")
      .select("delta,reason,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);

    return {
      credits: profile?.credits ?? 0,
      plans: plans ?? [],
      subscriptions: subscriptions ?? [],
      ledger: ledger ?? [],
    };
  });

/** Create a hosted checkout session/order for a plan. */
export const createCheckout = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => CheckoutSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await enforceBillingRateLimit(userId);

    const plan = getPlan(data.planSlug);
    if (!plan) throw new Error("Unknown plan.");

    // Currency -> provider routing: INR -> Razorpay, USD -> Dodo Payments.
    // (Stripe is not approved; its adapter stays in the codebase for later.)
    const currency: Currency = data.currency;
    const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email = userData.user?.email ?? "";

    const origin = process.env["SITE_URL"] ?? "https://vidoratube.lovable.app";
    const req = {
      plan,
      currency,
      userId,
      userEmail: email,
      successUrl: `${origin}/billing?purchase=success`,
      cancelUrl: `${origin}/billing?purchase=cancelled`,
    };

    if (currency === "inr") {
      const { razorpayProvider } = await import("./billing/razorpay");
      if (!razorpayProvider.isConfigured()) throw new Error("INR checkout is not set up yet.");
      return await razorpayProvider.createCheckout(req);
    }
    const { dodoProvider } = await import("./billing/dodo");
    if (!dodoProvider.isConfigured()) throw new Error("USD checkout is not set up yet.");
    return await dodoProvider.createCheckout(req);
  });

/** Cancel the caller's own subscription (at the provider, then DB syncs via webhook). */
export const cancelSubscription = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ subscriptionId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("id,provider,external_id,status")
      .eq("id", data.subscriptionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!sub) throw new Error("Subscription not found.");
    if (sub.status === "canceled") return { ok: true, already: true };

    if (sub.provider === "dodo") {
      const { dodoProvider } = await import("./billing/dodo");
      await dodoProvider.cancelSubscription(sub.external_id);
    } else if (sub.provider === "stripe") {
      const { stripeProvider } = await import("./billing/stripe");
      await stripeProvider.cancelSubscription(sub.external_id);
    } else {
      const { razorpayProvider } = await import("./billing/razorpay");
      await razorpayProvider.cancelSubscription(sub.external_id);
    }
    // Mark locally too; the provider webhook confirms it.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("subscriptions")
      .update({ status: "canceled", cancel_at_period_end: true, updated_at: new Date().toISOString() })
      .eq("id", sub.id);
    return { ok: true };
  });

/** Stripe customer portal for managing payment methods (Stripe subs only). */
export const createPortalSession = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("external_id")
      .eq("user_id", userId)
      .eq("provider", "stripe")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sub) throw new Error("No Stripe subscription found.");
    const { stripeProvider } = await import("./billing/stripe");
    const origin = process.env["SITE_URL"] ?? "https://vidoratube.lovable.app";
    const customerId = await stripeProvider.getCustomerIdForSubscription(sub.external_id);
    const url = await stripeProvider.createCustomerPortalUrl(customerId, `${origin}/billing`);
    return { url };
  });

/**
 * Reserve the exact quoted render cost when a server render is enqueued.
 * Idempotent per render id. Call BEFORE the worker picks the job up.
 *
 * The amount is the deterministic quote from quoteMultiAspectRender
 * (finished minutes x mode multipliers) — the same number the UI showed
 * before the render. Kept as a parameter (not computed here) so the
 * caller and the UI share one pricing function.
 */
export async function reserveRenderBilling(
  supabaseAdmin: SupabaseClient<Database>,
  userId: string,
  renderId: string,
  quotedCredits: number = DEFAULT_RENDER_RESERVE_MINUTES,
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("debit_credits_amount_once", {
    p_user_id: userId,
    p_amount: quotedCredits,
    p_reason: `Server render reserve (${quotedCredits} credits)`,
    p_ref_id: renderId,
  });
  if (error) {
    const msg = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
    if (msg.includes("INSUFFICIENT_CREDITS")) {
      throw new Error(
        `Not enough credits to start a server render (needs ${quotedCredits}). Top up or use the fast browser render.`,
      );
    }
    throw new Error(msg);
  }
}

/**
 * Sprint 1: measured cost analytics for the /admin panel.
 *
 * These read the api_usage rows written by recordApiCost (every provider
 * call) and turn them into investor-facing numbers. Admin-only: the admin
 * UI calls these; never expose them to non-admins.
 */

/** Admin: measured provider cost per finished minute for a billing mode. */
export const getMeasuredCostPerMinute = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z.object({ mode: z.enum(["story", "cinema"]).default("story") }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { assertAdmin } = await import("./admin.server");
    await assertAdmin(supabaseAdmin, context.userId);
    const { measuredCostPerMinute } = await import("./billing/measured-cost");
    const result = await measuredCostPerMinute(supabaseAdmin, data.mode);
    return {
      ...result,
      estimateNote:
        "Gateway (Lovable AI) rows are passthrough cost ESTIMATES — the gateway does not report exact USD. Direct-provider rows (ElevenLabs, Shotstack) use published rates.",
    };
  });

/** Admin: plan price vs measured provider cost of each plan's credits. */
export const getPlanMargins = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { assertAdmin } = await import("./admin.server");
    await assertAdmin(supabaseAdmin, context.userId);
    const { planMargins } = await import("./billing/measured-cost");
    return planMargins(supabaseAdmin);
  });
