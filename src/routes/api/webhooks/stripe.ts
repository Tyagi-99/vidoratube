import { createFileRoute } from "@tanstack/react-router";
import { verifyStripeWebhookSignature, type StripeEvent } from "@/lib/billing/stripe";
import { getPlan } from "@/lib/billing/plans";
import {
  claimBillingEvent,
  markBillingEventProcessed,
  processDomainEvent,
} from "@/lib/billing/webhooks.server";

export const Route = createFileRoute("/api/webhooks/stripe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        try {
          verifyStripeWebhookSignature(rawBody, request.headers.get("stripe-signature"));
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "bad signature" }, { status: 400 });
        }

        let event: StripeEvent;
        try {
          event = JSON.parse(rawBody) as StripeEvent;
        } catch {
          return Response.json({ error: "invalid JSON" }, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const first = await claimBillingEvent(supabaseAdmin, "stripe", event.id, event.type, event);
        if (!first) {
          return Response.json({ ok: true, deduped: true });
        }

        try {
          await handleStripeEvent(supabaseAdmin, event);
          await markBillingEventProcessed(supabaseAdmin, "stripe", event.id);
          return Response.json({ ok: true });
        } catch (e) {
          // Leave processed_at null so the failure is visible in billing_events;
          // Stripe will retry, and the claim makes retries safe.
          console.error("[stripe-webhook]", event.type, e);
          return Response.json({ error: "handler failed" }, { status: 500 });
        }
      },
    },
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleStripeEvent(supabaseAdmin: any, event: StripeEvent): Promise<void> {
  const obj = event.data.object;

  if (event.type === "checkout.session.completed") {
    const meta = (obj["metadata"] ?? {}) as Record<string, string>;
    const userId = meta["user_id"];
    const plan = getPlan(meta["plan_slug"] ?? "");
    if (!userId || !plan) {
      console.warn("[stripe-webhook] checkout completed without user/plan metadata", event.id);
      return;
    }
    if (obj["mode"] === "subscription") {
      const subscriptionId = String(obj["subscription"] ?? "");
      const { stripeProvider } = await import("@/lib/billing/stripe");
      const sub = await stripeProvider.getSubscription(subscriptionId);
      await processDomainEvent(supabaseAdmin, {
        kind: "subscription.renewed",
        userId,
        planSlug: plan.slug,
        credits: plan.credits,
        provider: "stripe",
        externalId: subscriptionId,
        periodStart: sub.currentPeriodStart,
        periodEnd: sub.currentPeriodEnd,
      });
    } else {
      await processDomainEvent(supabaseAdmin, {
        kind: "purchase.completed",
        userId,
        planSlug: plan.slug,
        credits: plan.credits,
        provider: "stripe",
        providerRef: event.id,
      });
    }
    return;
  }

  if (event.type === "invoice.payment_succeeded") {
    // First invoice of a new subscription was already granted at checkout.
    if (obj["billing_reason"] === "subscription_create") return;
    const subscriptionId = String(obj["subscription"] ?? "");
    if (!subscriptionId) return;
    // Resolve owner + plan from our subscription row.
    const { data: row } = await supabaseAdmin
      .from("subscriptions")
      .select("user_id, plan_slug")
      .eq("provider", "stripe")
      .eq("external_id", subscriptionId)
      .maybeSingle();
    if (!row) {
      console.warn("[stripe-webhook] renewal for unknown subscription", subscriptionId);
      return;
    }
    const plan = getPlan(row.plan_slug);
    if (!plan) return;
    const { stripeProvider } = await import("@/lib/billing/stripe");
    const sub = await stripeProvider.getSubscription(subscriptionId);
    await processDomainEvent(supabaseAdmin, {
      kind: "subscription.renewed",
      userId: row.user_id,
      planSlug: plan.slug,
      credits: plan.credits,
      provider: "stripe",
      externalId: subscriptionId,
      periodStart: sub.currentPeriodStart,
      periodEnd: sub.currentPeriodEnd,
    });
    return;
  }

  if (event.type === "customer.subscription.updated") {
    const { stripeProvider } = await import("@/lib/billing/stripe");
    const sub = await stripeProvider.getSubscription(String(obj["id"]));
    const { error } = await supabaseAdmin
      .from("subscriptions")
      .update({
        status: sub.status,
        current_period_start: sub.currentPeriodStart,
        current_period_end: sub.currentPeriodEnd,
        cancel_at_period_end: sub.cancelAtPeriodEnd,
        updated_at: new Date().toISOString(),
      })
      .eq("provider", "stripe")
      .eq("external_id", sub.externalId);
    if (error) throw new Error(error.message);
    return;
  }

  if (event.type === "customer.subscription.deleted") {
    await processDomainEvent(supabaseAdmin, {
      kind: "subscription.ended",
      provider: "stripe",
      externalId: String(obj["id"]),
      status: "canceled",
    });
    return;
  }

  // Other event types: recorded in billing_events, no action.
}
