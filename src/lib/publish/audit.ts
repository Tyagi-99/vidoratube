import type { AuditAction, AuditLogInput } from "@/lib/audit-log.server";

/**
 * Phase 4, Stream A — audit events emitted by the publishing pipeline.
 *
 * The shared `AUDIT_ACTIONS` list in `@/lib/audit-log.server` is owned by
 * another stream, so Stream A's action literals live here instead of being
 * added to that union. The shared writer stores `action` as plain text, so a
 * narrow cast at the boundary is type-safe without touching shared code.
 * (Contract follow-up: propose folding these into the shared list / DB
 * contract once Phase 4 merges.)
 */
export const PUBLISH_AUDIT_ACTIONS = [
  "channel.connected",
  "channel.disconnected",
  "publish.rescheduled",
  "publish.rejected",
  "publish.metadata_overwritten",
] as const;

export type PublishAuditAction = (typeof PUBLISH_AUDIT_ACTIONS)[number];

export type PublishAuditInput = Omit<AuditLogInput, "action"> & {
  action: PublishAuditAction;
};

/**
 * Best-effort publish audit write (never throws): audit must not break the
 * domain mutation it records.
 */
export async function auditPublishEvent(input: PublishAuditInput): Promise<void> {
  try {
    const { auditSafely } = await import("@/lib/audit-log.server");
    await auditSafely({
      ...input,
      action: input.action as AuditAction,
    });
  } catch (error) {
    console.warn(
      "[vidora] publish audit write failed",
      error instanceof Error ? error.message : error,
    );
  }
}
