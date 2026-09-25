import { createFileRoute } from "@tanstack/react-router";
import {
  normalizeDodoEvent,
  verifyDodoWebhookSignature,
  type DodoEvent,
} from "@/lib/billing/dodo";
import { getPlan } from "@/lib/billing/plans";
import {
  claimBillingEvent,
  markBillingEventProcessed,
  processDomainEvent,
} from "@/lib/billing/webhooks.server";

export const Route = createFileRoute("/api/webhooks/dodo")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        try {
          verifyDodoWebhookSignature(rawBody, {
            id: request.headers.get("webhook-id"),
            signature: request.headers.get("webhook-signature"),
            timestamp: request.headers.get("webhook-timestamp"),
          });
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "bad signature" }, { status: 400 });
        }

        let event: DodoEvent;
        try {
          event = JSON.parse(rawBody) as DodoEvent;
        } catch {
          return Response.json({ error: "invalid JSON" }, { status: 400 });
        }
        if (!event.type) {
          return Response.json({ error: "missing event type" }, { status: 400 });
        }

        // webhook-id is the stable unique id — replays dedupe on it.
        const eventId = request.headers.get("webhook-id") ?? `${event.type}:${event.id ?? "unknown"}`;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const first = await claimBillingEvent(supabaseAdmin, "dodo", eventId, event.type, event);
        if (!first) {
          return Response.json({ ok: true, deduped: true });
        }

        try {
          await handleDodoEvent(supabaseAdmin, event);
          await markBillingEventProcessed(supabaseAdmin, "dodo", eventId);
          return Response.json({ ok: true });
        } catch (e) {
          console.error("[dodo-webhook]", event.type, e);
          return Response.json({ error: "handler failed" }, { status: 500 });
        }
      },
    },
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleDodoEvent(supabaseAdmin: any, event: DodoEvent): Promise<void> {
  const domain = normalizeDodoEvent(event);
  if (!domain) return; // Recorded in billing_events; no action for this type.

  // Resolve credits from our plan catalog (never trust the provider payload).
  const plan = getPlan(domain.kind === "purchase.completed" || domain.kind === "subscription.renewed" ? domain.planSlug : "");
  if (domain.kind === "purchase.completed") {
    if (!plan) {
      console.warn("[dodo-webhook] payment.succeeded without known plan metadata");
      return;
    }
    await processDomainEvent(supabaseAdmin, { ...domain, credits: plan.credits });
    return;
  }
  if (domain.kind === "subscription.renewed") {
    if (!plan) {
      console.warn("[dodo-webhook] subscription event without known plan metadata");
      return;
    }
    await processDomainEvent(supabaseAdmin, { ...domain, credits: plan.credits });
    return;
  }
  await processDomainEvent(supabaseAdmin, domain);
}
