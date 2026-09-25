import { createFileRoute } from "@tanstack/react-router";
import { verifyRazorpayWebhookSignature, type RazorpayEvent } from "@/lib/billing/razorpay";
import { getPlan } from "@/lib/billing/plans";
import {
  claimBillingEvent,
  markBillingEventProcessed,
  processDomainEvent,
} from "@/lib/billing/webhooks.server";

export const Route = createFileRoute("/api/webhooks/razorpay")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        try {
          verifyRazorpayWebhookSignature(rawBody, request.headers.get("x-razorpay-signature"));
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "bad signature" }, { status: 400 });
        }

        let event: RazorpayEvent & { event_id?: string };
        try {
          event = JSON.parse(rawBody) as RazorpayEvent & { event_id?: string };
        } catch {
          return Response.json({ error: "invalid JSON" }, { status: 400 });
        }

        // Razorpay webhooks don't carry a stable event id; derive one from the
        // payload so replays dedupe. payment/subscription entity ids are unique
        // per lifecycle event.
        const entityId =
          event.payload.payment?.entity?.["id"] ??
          event.payload.subscription?.entity?.["id"] ??
          event.payload.order?.entity?.["id"] ??
          "unknown";
        const eventId = `${event.event}:${String(entityId)}`;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const first = await claimBillingEvent(supabaseAdmin, "razorpay", eventId, event.event, event);
        if (!first) {
          return Response.json({ ok: true, deduped: true });
        }

        try {
          await handleRazorpayEvent(supabaseAdmin, event);
          await markBillingEventProcessed(supabaseAdmin, "razorpay", eventId);
          return Response.json({ ok: true });
        } catch (e) {
          console.error("[razorpay-webhook]", event.event, e);
          return Response.json({ error: "handler failed" }, { status: 500 });
        }
      },
    },
  },
});

type RazorpayHandlerEvent = RazorpayEvent;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleRazorpayEvent(supabaseAdmin: any, event: RazorpayHandlerEvent): Promise<void> {
  if (event.event === "payment.captured") {
    const payment = event.payload.payment?.entity ?? {};
    const notes = (payment["notes"] ?? {}) as Record<string, string>;
    const userId = notes["user_id"];
    const plan = getPlan(notes["plan_slug"] ?? "");
    if (!userId || !plan || plan.kind !== "pack") {
      console.warn("[razorpay-webhook] payment.captured without user/pack metadata");
      return;
    }
    await processDomainEvent(supabaseAdmin, {
      kind: "purchase.completed",
      userId,
      planSlug: plan.slug,
      credits: plan.credits,
      provider: "razorpay",
      providerRef: String(payment["id"] ?? ""),
    });
    return;
  }

  if (event.event === "subscription.charged") {
    const sub = event.payload.subscription?.entity ?? {};
    const notes = (sub["notes"] ?? {}) as Record<string, string>;
    const userId = notes["user_id"];
    const plan = getPlan(notes["plan_slug"] ?? "");
    if (!userId || !plan) {
      console.warn("[razorpay-webhook] subscription.charged without user/plan metadata");
      return;
    }
    const { razorpayProvider } = await import("@/lib/billing/razorpay");
    const details = await razorpayProvider.getSubscription(String(sub["id"]));
    await processDomainEvent(supabaseAdmin, {
      kind: "subscription.renewed",
      userId,
      planSlug: plan.slug,
      credits: plan.credits,
      provider: "razorpay",
      externalId: String(sub["id"]),
      periodStart: details.currentPeriodStart,
      periodEnd: details.currentPeriodEnd,
    });
    return;
  }

  if (
    event.event === "subscription.cancelled" ||
    event.event === "subscription.halted" ||
    event.event === "subscription.completed"
  ) {
    const sub = event.payload.subscription?.entity ?? {};
    await processDomainEvent(supabaseAdmin, {
      kind: "subscription.ended",
      provider: "razorpay",
      externalId: String(sub["id"]),
      status: event.event === "subscription.cancelled" ? "canceled" : "halted",
    });
    return;
  }

  // Other event types: recorded in billing_events, no action.
}
