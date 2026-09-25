/**
 * P9: Referral program server functions.
 *
 * - getMyReferralLink: returns (or creates) the caller's invite code + link.
 * - listMyReferrals: caller's referral rows (pending/verified/rewarded).
 * - claimReferralOnVerification (server-only, called from the email-verified
 *   hook): claims the invitee's pending referral, rewards both sides once,
 *   with anti-abuse guards (self-referral, one-per-invitee, cluster limit).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "./auth-user";
import {
  REFERRAL_REWARD_CREDITS,
  decideReferralClaim,
  generateReferralCode,
  isValidReferralCode,
} from "./referrals";
import { checkAbuseCluster } from "./abuse";

const ClaimSchema = z.object({
  code: z.string().trim().max(16),
  inviteeId: z.string().uuid(),
  deviceHash: z.string().max(128).optional(),
});

/** Invitees must come from a code that looks valid; otherwise no-op. */
export const getMyReferralLink = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .handler(async ({ context }) => {
    const admin = (await import("@/integrations/supabase/client.server")).supabaseAdmin;

    const { data: existing } = await admin
      .from("referrals")
      .select("code")
      .eq("referrer_id", context.userId)
      .is("invitee_id", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    let code = existing?.code;
    if (!code) {
      // Retry a few times on (astronomically unlikely) code collision.
      for (let attempt = 0; attempt < 5 && !code; attempt++) {
        const candidate = generateReferralCode();
        const { error } = await admin.from("referrals").insert({
          code: candidate,
          referrer_id: context.userId,
          status: "pending",
        });
        if (!error) code = candidate;
      }
      if (!code) throw new Error("Could not create a referral code right now");
    }

    const base = process.env.SITE_URL ?? "https://vidoratube.lovable.app";
    return { code, link: `${base}/r/${code}`, reward: REFERRAL_REWARD_CREDITS };
  });

export const listMyReferrals = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("referrals")
      .select("id,code,status,rewarded_at,created_at")
      .eq("referrer_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/**
 * Server-only claim. Called when an invitee's email is verified.
 * Never exposed to the client — the invitee could otherwise claim for
 * themselves.
 */
export async function claimReferralOnVerification(input: {
  code: string;
  inviteeId: string;
  deviceHash?: string;
}): Promise<{ rewarded: boolean; reason?: string }> {
  const parsed = ClaimSchema.safeParse(input);
  if (!parsed.success) return { rewarded: false, reason: "invalid_input" };
  const { code, inviteeId, deviceHash } = parsed.data;
  if (!isValidReferralCode(code)) return { rewarded: false, reason: "invalid_code" };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: referral } = await supabaseAdmin
    .from("referrals")
    .select("id,referrer_id,status")
    .eq("code", code)
    .is("invitee_id", null)
    .maybeSingle();
  if (!referral) return { rewarded: false, reason: "code_not_found" };

  const { count: existingClaims } = await supabaseAdmin
    .from("referrals")
    .select("id", { count: "exact", head: true })
    .eq("invitee_id", inviteeId)
    .in("status", ["verified", "rewarded"]);

  const decision = decideReferralClaim({
    inviteeId,
    referrerId: referral.referrer_id,
    existingClaimByInvitee: (existingClaims ?? 0) > 0,
    clusterCount: 0, // replaced by the log_abuse_signal cluster check below
    clusterLimit: Number.MAX_SAFE_INTEGER,
  });
  if (!decision.ok) return { rewarded: false, reason: decision.reason };

  // Abuse cluster check: same device/network farming too many accounts.
  try {
    await checkAbuseCluster(supabaseAdmin, {
      userId: inviteeId,
      deviceHash,
      signalType: "referral_claim",
    });
  } catch {
    return { rewarded: false, reason: "cluster" };
  }

  // Claim the row (pending -> verified). The is-null guard makes this
  // idempotent: only the first caller wins.
  const { data: claimed } = await supabaseAdmin
    .from("referrals")
    .update({ invitee_id: inviteeId, status: "verified", device_hash: deviceHash ?? null })
    .eq("id", referral.id)
    .eq("status", "pending")
    .is("invitee_id", null)
    .select("id")
    .maybeSingle();
  if (!claimed) return { rewarded: false, reason: "already_claimed" };

  const refId = `referral:${referral.id}`;
  const grant = async (userId: string) =>
    supabaseAdmin.rpc("grant_credits_once", {
      p_user_id: userId,
      p_amount: REFERRAL_REWARD_CREDITS,
      p_reason: "referral_reward",
      p_ref_id: `${refId}:${userId}`,
    });

  const [r1, r2] = await Promise.all([
    grant(referral.referrer_id),
    grant(inviteeId),
  ]);
  if (r1.error || r2.error) {
    // Grants are idempotent by ref; leave status as verified so a retry
    // (or admin job) can re-run the grant without double-paying.
    return { rewarded: false, reason: "grant_failed" };
  }

  await supabaseAdmin
    .from("referrals")
    .update({ status: "rewarded", rewarded_at: new Date().toISOString() })
    .eq("id", referral.id);

  return { rewarded: true };
}
