/**
 * Phase 4 Stream E (F40) — invite token helper tests (pure, no DB).
 */
import { describe, expect, it } from "vitest";
import {
  defaultInviteExpiry,
  generateInviteToken,
  hashInviteToken,
  isValidInviteTokenFormat,
  normalizeEmail,
} from "./invites";

describe("invite tokens", () => {
  it("generates vdinv_ + 32 URL-safe chars, unique each time", () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(isValidInviteTokenFormat(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it("rejects malformed tokens", () => {
    expect(isValidInviteTokenFormat("")).toBe(false);
    expect(isValidInviteTokenFormat("vdsk_" + "a".repeat(32))).toBe(false);
    expect(isValidInviteTokenFormat("vdinv_short")).toBe(false);
    expect(isValidInviteTokenFormat("vdinv_" + "a".repeat(31) + "!")).toBe(false);
    expect(isValidInviteTokenFormat("vdinv_" + "a".repeat(33))).toBe(false);
  });

  it("hashes are deterministic SHA-256 hex and never leak the raw token", () => {
    const raw = generateInviteToken();
    const h1 = hashInviteToken(raw);
    const h2 = hashInviteToken(raw);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).not.toContain(raw);
    expect(hashInviteToken(generateInviteToken())).not.toBe(h1);
  });

  it("default expiry is 7 days out", () => {
    const from = new Date("2026-09-28T00:00:00Z");
    const exp = defaultInviteExpiry(from);
    expect(exp.getTime() - from.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("normalizes emails for comparison", () => {
    expect(normalizeEmail("  Team@Example.COM ")).toBe("team@example.com");
  });
});
