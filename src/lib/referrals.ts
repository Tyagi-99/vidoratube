/**
 * P9: Referral program — pure helpers (no I/O, fully unit-tested).
 *
 * Flow: referrer shares /r/{code} -> invitee signs up -> on email
 * verification the referral is claimed -> both sides get 5 credits once.
 */

export const REFERRAL_REWARD_CREDITS = 5;

/** 8-char URL-safe referral codes, e.g. "K7Q2M9XA". */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 lookalikes

export function generateReferralCode(rand: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  }
  return code;
}

/** Codes are exactly 8 chars from the alphabet above. */
export function isValidReferralCode(code: string): boolean {
  if (code.length !== 8) return false;
  for (const ch of code) {
    if (!CODE_ALPHABET.includes(ch)) return false;
  }
  return true;
}

/** Invite landing path, e.g. "/r/K7Q2M9XA". */
export function referralPath(code: string): string {
  return `/r/${code}`;
}

export type ReferralClaimDecision =
  | { ok: true }
  | { ok: false; reason: "self_referral" | "already_claimed" | "cluster" };

/**
 * Decide whether a referral claim is legitimate.
 *
 * - self_referral: invitee is the referrer (code belongs to invitee's own account)
 * - already_claimed: invitee already claimed any referral (one reward per invitee)
 * - cluster: invitee's device/IP already rewarded too many accounts (farming)
 */
export function decideReferralClaim(input: {
  inviteeId: string;
  referrerId: string;
  existingClaimByInvitee: boolean;
  clusterCount: number;
  clusterLimit: number;
}): ReferralClaimDecision {
  if (input.inviteeId === input.referrerId) return { ok: false, reason: "self_referral" };
  if (input.existingClaimByInvitee) return { ok: false, reason: "already_claimed" };
  if (input.clusterCount >= input.clusterLimit) return { ok: false, reason: "cluster" };
  return { ok: true };
}
