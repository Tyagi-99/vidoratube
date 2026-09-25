/**
 * Client IP extraction + abuse-cluster enforcement for free-credit farming.
 *
 * The Postgres function `log_abuse_signal` (service_role only) records the
 * signal and returns how many distinct free-tier users share the caller's
 * /24 (IPv4) or /64 (IPv6) — or the same device hash — in the last 30 days.
 * More than ABUSE_CLUSTER_LIMIT distinct free-tier users on one network or
 * device means the free credits are being farmed, and job creation is blocked
 * with an actionable error.
 *
 * Telemetry failures fail OPEN: a broken abuse log must never block a
 * legitimate user. The error is still written to server logs.
 */
import { getRequest } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** Block when more than this many distinct free-tier users share a network/device. */
export const ABUSE_CLUSTER_LIMIT = 2;

/**
 * Pure IP parsing (unit-testable): first entry of X-Forwarded-For wins,
 * then Cloudflare / reverse-proxy headers.
 */
export function parseClientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    headers.get("cf-connecting-ip")?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    null
  );
}

/** Best-effort client IP from the current server request; null when unavailable. */
export function getClientIp(): string | null {
  try {
    const request = getRequest();
    const headers = request?.headers;
    if (!headers) return null;
    return parseClientIp(headers);
  } catch {
    return null;
  }
}

export interface AbuseCheckOptions {
  userId: string;
  /** e.g. "job_create", "voiceover_create", "autoedit_create" */
  signalType: string;
  /** Opaque per-browser id sent by the client; null when the client didn't send one. */
  deviceHash?: string | null | undefined;
}

/**
 * Log an abuse signal and throw when the caller is part of a free-credit
 * farming cluster. Call with the service-role client.
 */
export async function checkAbuseCluster(
  supabaseAdmin: SupabaseClient<Database>,
  opts: AbuseCheckOptions,
): Promise<void> {
  const ip = getClientIp();
  const deviceHash = (opts.deviceHash ?? "").trim() || null;
  if (!ip && !deviceHash) return; // nothing to correlate on — fail open

  const { data, error } = await supabaseAdmin.rpc("log_abuse_signal", {
    p_user_id: opts.userId,
    p_ip: ip,
    p_device_hash: deviceHash,
    p_signal_type: opts.signalType,
  });
  if (error) {
    console.error("[abuse] log_abuse_signal failed:", error.message);
    return; // fail open
  }
  if (typeof data === "number" && data > ABUSE_CLUSTER_LIMIT) {
    throw new Error(
      "This device or network has already claimed free credits on too many accounts. " +
        "Sign in with Google or contact support to keep creating videos.",
    );
  }
}
