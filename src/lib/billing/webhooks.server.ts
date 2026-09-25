/**
 * P7: Shared webhook processing (server-only).
 *
 * Flow for every incoming webhook:
 *   1. Provider adapter verifies the signature (throws on failure).
 *   2. `claimBillingEvent` inserts into billing_events; the UNIQUE
 *      (provider, event_id) constraint makes replays no-ops.
 *   3. The event is normalized to a domain event and processed.
 *   4. Credit grants use grant_credits_once with a deterministic ref so even
 *      a double-process can never double-grant.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { DomainBillingEvent } from "./billing-math";
import { eventRefUuid } from "./billing-math";

export type WebhookProvider = "dodo" | "stripe" | "razorpay";

/**
 * Try to claim a webhook event for processing. Returns true when this is
 * the first time the event is seen (caller should process it), false when
 * it was already processed (replay -> skip).
 */
export async function claimBillingEvent(
  supabaseAdmin: SupabaseClient<Database>,
  provider: WebhookProvider,
  eventId: string,
  type: string,
  payload: unknown,
): Promise<boolean> {
  const { error } = await supabaseAdmin.from("billing_events").insert({
    provider,
    event_id: eventId,
    type,
    payload: payload as never,
  });
  if (error) {
    // Unique violation on (provider, event_id) => already processed.
    if (error.code === "23505") return false;
    throw new Error(`billing_events insert failed: ${error.message}`);
  }
  return true;
}

export async function markBillingEventProcessed(
  supabaseAdmin: SupabaseClient<Database>,
  provider: WebhookProvider,
  eventId: string,
): Promise<void> {
  await supabaseAdmin
    .from("billing_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("provider", provider)
    .eq("event_id", eventId);
}

/** Idempotent credit grant for a domain billing event. */
export async function grantEventCredits(
  supabaseAdmin: SupabaseClient<Database>,
  userId: string,
  credits: number,
  reason: string,
  provider: WebhookProvider,
  providerRef: string,
): Promise<void> {
  const refId = eventRefUuid(provider, providerRef);
  const { error } = await supabaseAdmin.rpc("grant_credits_once", {
    p_user_id: userId,
    p_amount: credits,
    p_reason: reason,
    p_ref_id: refId,
  });
  if (error) throw new Error(`grant failed: ${error.message}`);
}

async function upsertSubscription(
  supabaseAdmin: SupabaseClient<Database>,
  input: {
    userId: string;
    provider: WebhookProvider;
    externalId: string;
    planSlug: string;
    status: string;
    periodStart: string | null;
    periodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  },
): Promise<void> {
  const { error } = await supabaseAdmin.from("subscriptions").upsert(
    {
      user_id: input.userId,
      provider: input.provider,
      external_id: input.externalId,
      plan_slug: input.planSlug,
      status: input.status,
      current_period_start: input.periodStart,
      current_period_end: input.periodEnd,
      cancel_at_period_end: input.cancelAtPeriodEnd,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "provider,external_id" },
  );
  if (error) throw new Error(`subscription upsert failed: ${error.message}`);
}

async function setSubscriptionStatus(
  supabaseAdmin: SupabaseClient<Database>,
  provider: WebhookProvider,
  externalId: string,
  status: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("subscriptions")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("provider", provider)
    .eq("external_id", externalId);
  if (error) throw new Error(`subscription status update failed: ${error.message}`);
}

/** Process one normalized domain event. All grants are idempotent. */
export async function processDomainEvent(
  supabaseAdmin: SupabaseClient<Database>,
  event: DomainBillingEvent,
): Promise<void> {
  switch (event.kind) {
    case "purchase.completed": {
      await grantEventCredits(
        supabaseAdmin,
        event.userId,
        event.credits,
        `${event.provider} purchase: ${event.planSlug}`,
        event.provider as WebhookProvider,
        event.providerRef,
      );
      break;
    }
    case "subscription.renewed": {
      await upsertSubscription(supabaseAdmin, {
        userId: event.userId,
        provider: event.provider as WebhookProvider,
        externalId: event.externalId,
        planSlug: event.planSlug,
        status: "active",
        periodStart: event.periodStart,
        periodEnd: event.periodEnd,
        cancelAtPeriodEnd: false,
      });
      await grantEventCredits(
        supabaseAdmin,
        event.userId,
        event.credits,
        `${event.provider} subscription renewal: ${event.planSlug}`,
        event.provider as WebhookProvider,
        `${event.externalId}:${event.periodStart ?? "renewal"}`,
      );
      break;
    }
    case "subscription.ended": {
      await setSubscriptionStatus(
        supabaseAdmin,
        event.provider as WebhookProvider,
        event.externalId,
        event.status,
      );
      break;
    }
  }
}
