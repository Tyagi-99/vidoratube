import { createHash } from "node:crypto";

/**
 * P7: Normalized billing events + server-render cost math (pure, tested).
 *
 * Both providers' webhooks are reduced to a small set of domain events so
 * the handlers share one code path:
 *   purchase.completed  -> grant one-time pack credits / activate subscription
 *   subscription.renewed -> grant monthly credits
 *   subscription.ended   -> mark canceled/halted
 */

export type DomainBillingEvent =
  | { kind: "purchase.completed"; userId: string; planSlug: string; credits: number; provider: string; providerRef: string }
  | { kind: "subscription.renewed"; userId: string; planSlug: string; credits: number; provider: string; externalId: string; periodStart: string | null; periodEnd: string | null }
  | { kind: "subscription.ended"; provider: string; externalId: string; status: string };

/** Deterministic UUID (v5-style) for a provider event id — used as the
 *  idempotency ref for credit grants so webhook replays are no-ops. */
export function eventRefUuid(namespace: string, eventId: string): string {
  const hash = createHash("sha1").update(`${namespace}:${eventId}`, "utf8").digest("hex");
  // Format as a UUID with version nibble 5.
  return (
    `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}` +
    `-${((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0")}${hash.slice(18, 20)}` +
    `-${hash.slice(20, 32)}`
  );
}

/* ------------------------- server-render cost ------------------------- */

/** Started minutes for a render duration in seconds (minimum 1). */
export function startedMinutes(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 1;
  return Math.max(1, Math.ceil(durationSeconds / 60));
}

/**
 * Settle reserve -> actual: returns the signed adjustment (positive = debit
 * the user more, negative = refund) and the total credits charged.
 */
export function settleRenderBilling(reservedMinutes: number, actualMinutes: number): {
  adjustment: number;
  totalCharged: number;
} {
  const adjustment = actualMinutes - Math.max(0, Math.floor(reservedMinutes));
  return { adjustment, totalCharged: Math.max(0, Math.floor(reservedMinutes)) + adjustment };
}

/** Default minutes to reserve when a server render is enqueued. */
export const DEFAULT_RENDER_RESERVE_MINUTES = 10;
