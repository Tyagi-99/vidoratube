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

/**
 * Deterministic UUIDv5 (RFC 4122), used for grant_credits_once ref ids.
 * grant_credits_once expects p_ref_id UUID; deriving it from the
 * referral row id + grantee keeps replays idempotent without new state.
 */
export const REFERRAL_GRANT_NAMESPACE = "9b4f2c1a-7e3d-4a8b-b6f0-1d2c3e4f5a6b";

export function uuidv5(name: string, namespace: string): string {
  const nsBytes = namespace.replace(/-/g, "");
  // FIPS-180 SHA-1 over namespace bytes + name, implemented inline so this
  // module stays dependency-free and works in browser + server + tests.
  const data = new Uint8Array(nsBytes.length / 2 + name.length * 4);
  for (let i = 0; i < nsBytes.length; i += 2) {
    data[i / 2] = parseInt(nsBytes.slice(i, i + 2), 16);
  }
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(name);
  data.set(nameBytes, nsBytes.length / 2);
  const bytes = data.slice(0, nsBytes.length / 2 + nameBytes.length);
  const digest = sha1(bytes);
  digest[6] = (digest[6]! & 0x0f) | 0x50; // version 5
  digest[8] = (digest[8]! & 0x3f) | 0x80; // variant RFC 4122
  const hex = [...digest.slice(0, 16)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Minimal SHA-1 (public-domain style implementation, ~60 lines). */
function sha1(input: Uint8Array): Uint8Array {
  const ml = input.length * 8;
  const withOne = input.length + 1;
  const padLen = (64 - ((withOne + 8) % 64)) % 64;
  const msg = new Uint8Array(withOne + padLen + 8);
  msg.set(input);
  msg[input.length] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(msg.length - 8, Math.floor(ml / 0x100000000), false);
  view.setUint32(msg.length - 4, ml >>> 0, false);

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe,
      h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);

  for (let off = 0; off < msg.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 80; i++) {
      const v = w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!;
      w[i] = ((v << 1) | (v >>> 31)) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const temp = ((((a << 5) | (a >>> 27)) >>> 0) + f + e + k + w[i]!) >>> 0;
      e = d; d = c; c = ((b << 30) | (b >>> 2)) >>> 0; b = a; a = temp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }

  const out = new Uint8Array(20);
  const oview = new DataView(out.buffer);
  oview.setUint32(0, h0, false); oview.setUint32(4, h1, false);
  oview.setUint32(8, h2, false); oview.setUint32(12, h3, false);
  oview.setUint32(16, h4, false);
  return out;
}
