/**
 * Phase 4 Stream E (F40) — workspace invite token helpers.
 *
 * Invites are bearer tokens shown/emailed ONCE; only the SHA-256 hash is
 * stored (same discipline as API keys, D136). A token can never mint
 * membership on its own — acceptance is an explicit signed-in action whose
 * account email must match the invited email.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const INVITE_TOKEN_PREFIX = "vdinv_";
export const INVITE_TOKEN_LENGTH = 32;

/** Generate a raw invite token: `vdinv_` + 32 URL-safe characters. */
export function generateInviteToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const bytes = randomBytes(INVITE_TOKEN_LENGTH);
  let out = "";
  for (const b of bytes) out += chars[b & 63];
  return `${INVITE_TOKEN_PREFIX}${out}`;
}

/** SHA-256 hex digest — the only form ever stored. */
export function hashInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/** Constant-time comparison of two hex digests. */
export function digestsEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function isValidInviteTokenFormat(token: string): boolean {
  if (typeof token !== "string") return false;
  if (!token.startsWith(INVITE_TOKEN_PREFIX)) return false;
  const body = token.slice(INVITE_TOKEN_PREFIX.length);
  return body.length === INVITE_TOKEN_LENGTH && /^[A-Za-z0-9\-_]+$/.test(body);
}

/** Invites live 7 days by default. */
export function defaultInviteExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
