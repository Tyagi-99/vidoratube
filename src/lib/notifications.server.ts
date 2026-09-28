/**
 * Sprint 1-2: render-completion notifications.
 *
 * The "close the tab" promise: when a render finishes, the user must learn
 * about it without keeping the tab open.
 *
 * Two channels, both behind feature detection:
 *
 *   1. In-app notification row (ALWAYS) — stored in `notifications`; the
 *      studio bell reads it. This channel works with zero email setup.
 *   2. Transactional email (only when RESEND_API_KEY is set) — sent via the
 *      Resend REST API directly (no SDK dependency). If sending fails, we
 *      log and keep going: the in-app row is the source of truth, so a
 *      failed email can never lose the completion signal.
 *
 * SMTP is deliberately not implemented here: Resend covers the founder's
 * path and a second provider doubles the test surface for a pre-launch
 * notification. See docs/FOUNDER_TODO.md item 10.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Email provider is live only when a Resend key is configured. */
export function isEmailConfigured(): boolean {
  return Boolean(process.env["RESEND_API_KEY"]);
}

/** Verified sender domain; must be a domain verified in the Resend dashboard. */
export function emailFrom(): string {
  return process.env["EMAIL_FROM"] ?? "Vidora <updates@vidora.ai>";
}

/**
 * Phase 4 Stream D — pinned notification type vocab.
 * Dotted names are canonical (docs/PHASE4_CONTRACTS.md); the legacy
 * `render_complete` rows from Sprint 1-2 still render via the bell label map.
 */
export type NotificationType =
  | "render.completed"
  | "render.failed"
  | "publish.approved"
  | "publish.published"
  | "publish.failed"
  | "approval.requested"
  | "budget.alert"
  | "quota.warning"
  | "experiment.concluded"
  | "intel.alert" // Phase 6 Stream E (P1): Watchtower competitor alerts
  | "render_complete"; // legacy Sprint 1-2 type

export interface EmitNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
  /**
   * Stable dedup key (see migration 2026092804d000). When set, a second
   * emit with the same key is a no-op — this is what makes the
   * consume-only triggers exactly-once.
   */
  dedupKey?: string | null;
  /** Optional email; only sent when RESEND_API_KEY is configured. */
  email?: { to: string; subject: string; text: string } | null;
}

export interface EmitNotificationResult {
  notified: boolean;
  /** True when an identical dedup_key row already existed. */
  duplicate: boolean;
  emailed: boolean;
  emailError: string | null;
}

/**
 * The single server-side notification writer (Stream D owns this file).
 * Writes the in-app row (always, never throws on email failure) and sends
 * email only when configured. Dedup is enforced in two layers: a SELECT
 * guard plus the partial UNIQUE(user_id, dedup_key) index as backstop
 * (23505 → duplicate).
 */
export async function emitNotification(
  supabaseAdmin: Pick<SupabaseClient, "from">,
  input: EmitNotificationInput,
): Promise<EmitNotificationResult> {
  const result: EmitNotificationResult = {
    notified: false,
    duplicate: false,
    emailed: false,
    emailError: null,
  };

  // Dedup guard.
  if (input.dedupKey) {
    try {
      const { data } = await supabaseAdmin
        .from("notifications")
        .select("id")
        .eq("user_id", input.userId)
        .eq("dedup_key", input.dedupKey)
        .limit(1);
      if ((data as unknown[] | null)?.length) {
        result.duplicate = true;
        return result;
      }
    } catch (e) {
      console.error("[notifications] dedup check failed", input.dedupKey, e);
    }
  }

  try {
    const { error } = await supabaseAdmin.from("notifications").insert({
      user_id: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      dedup_key: input.dedupKey ?? null,
    });
    if (error) {
      // 23505 = the partial unique index caught a race: already notified.
      if ((error as { code?: string }).code === "23505" && input.dedupKey) {
        result.duplicate = true;
        return result;
      }
      throw new Error((error as { message?: string }).message ?? "insert failed");
    }
    result.notified = true;
  } catch (e) {
    console.error("[notifications] store failed", input.type, e);
  }

  // Email — only when a provider key exists (existing pattern, kept).
  if (!input.email || !isEmailConfigured()) return result;
  if (!input.email.to) {
    result.emailError = "no user email";
    return result;
  }
  try {
    await sendResendEmail(input.email);
    result.emailed = true;
  } catch (e) {
    result.emailError = e instanceof Error ? e.message : "send failed";
    console.error("[notifications] email failed", input.type, e);
  }
  return result;
}

export interface RenderCompleteInput {
  userId: string;
  userEmail: string | null;
  renderId: string;
  /** Human title for the render (project title or filename). */
  title: string;
  /** Short-lived signed URL — NOT embedded in the email; email links to /studio. */
  downloadPath: string;
  durationSeconds: number | null;
}

export interface RenderCompleteResult {
  /** The in-app notification was stored. */
  notified: boolean;
  /** An email was accepted by the provider. */
  emailed: boolean;
  emailError: string | null;
}

/**
 * Record a render completion and, when configured, email the user.
 * Never throws: notification storage is best-effort so completion handling
 * can never be broken by a mail provider outage.
 */
export async function sendRenderCompleteEmail(
  supabaseAdmin: Pick<SupabaseClient, "from">,
  input: RenderCompleteInput,
): Promise<RenderCompleteResult> {
  const result: RenderCompleteResult = { notified: false, emailed: false, emailError: null };

  // 1) In-app notification — always, the reliable channel.
  try {
    const { error } = await supabaseAdmin.from("notifications").insert({
      user_id: input.userId,
      type: "render_complete",
      title: "Your video finished rendering",
      body: input.title,
      link: "/studio",
    });
    if (error) throw new Error(error.message);
    result.notified = true;
  } catch (e) {
    // Storage failed — still try email so the signal isn't fully lost.
    console.error("[notifications] store failed", input.renderId, e);
  }

  // 2) Email — only when a provider key exists.
  if (!isEmailConfigured()) return result;
  if (!input.userEmail) {
    result.emailError = "no user email";
    return result;
  }

  try {
    await sendResendEmail({
      to: input.userEmail,
      subject: `Your Vidora video is ready: ${input.title}`,
      text:
        `Your render "${input.title}" finished` +
        (input.durationSeconds ? ` (${Math.round(input.durationSeconds)}s)` : "") +
        `.\n\nOpen your studio to download it:\nhttps://vidoratube.lovable.app/studio\n\n` +
        `— Vidora`,
    });
    result.emailed = true;
  } catch (e) {
    result.emailError = e instanceof Error ? e.message : "send failed";
    console.error("[notifications] email failed", input.renderId, e);
  }
  return result;
}

/**
 * Shared Resend sender. Exported so the generic emitNotification path and
 * the legacy render-complete path use the same provider logic.
 * Throws on transport/API failure; callers decide whether to swallow.
 */
export async function sendResendEmail(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const key = process.env["RESEND_API_KEY"];
  if (!key) throw new Error("RESEND_API_KEY is not configured.");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: emailFrom(),
      to: [input.to],
      subject: input.subject,
      text: input.text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend API error (${res.status}): ${body.slice(0, 300)}`);
  }
}
