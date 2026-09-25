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

async function sendResendEmail(input: { to: string; subject: string; text: string }): Promise<void> {
  const key = process.env["RESEND_API_KEY"];
  if (!key) throw new Error("RESEND_API_KEY is not configured.");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
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
