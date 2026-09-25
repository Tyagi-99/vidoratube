import { describe, expect, it, vi } from "vitest";
import {
  decideReferralClaim,
  generateReferralCode,
  isValidReferralCode,
  REFERRAL_GRANT_NAMESPACE,
  REFERRAL_REWARD_CREDITS,
  referralPath,
  uuidv5,
} from "./referrals";

describe("referral codes", () => {
  it("generates 8-char codes from the unambiguous alphabet", () => {
    for (let i = 0; i < 100; i++) {
      const code = generateReferralCode();
      expect(code).toHaveLength(8);
      expect(isValidReferralCode(code)).toBe(true);
    }
  });

  it("accepts seeded randomness deterministically", () => {
    const code = generateReferralCode(vi.fn().mockReturnValue(0));
    expect(code).toBe("AAAAAAAA");
  });

  it("rejects malformed codes", () => {
    expect(isValidReferralCode("short")).toBe(false);
    expect(isValidReferralCode("TOOLONGCODE")).toBe(false);
    expect(isValidReferralCode("K7Q2M9X0")).toBe(false); // 0 not in alphabet
    expect(isValidReferralCode("k7q2m9xa")).toBe(false); // lowercase not in alphabet
  });

  it("builds invite paths", () => {
    expect(referralPath("K7Q2M9XA")).toBe("/r/K7Q2M9XA");
  });

  it("rewards 5 credits per side", () => {
    expect(REFERRAL_REWARD_CREDITS).toBe(5);
  });
});

describe("decideReferralClaim", () => {
  const base = {
    inviteeId: "invitee-1",
    referrerId: "referrer-1",
    existingClaimByInvitee: false,
    clusterCount: 0,
    clusterLimit: 3,
  };

  it("allows a clean claim", () => {
    expect(decideReferralClaim(base)).toEqual({ ok: true });
  });

  it("blocks self-referral", () => {
    expect(decideReferralClaim({ ...base, referrerId: "invitee-1" })).toEqual({
      ok: false,
      reason: "self_referral",
    });
  });

  it("blocks a second claim by the same invitee", () => {
    expect(decideReferralClaim({ ...base, existingClaimByInvitee: true })).toEqual({
      ok: false,
      reason: "already_claimed",
    });
  });

  it("blocks farming clusters at the limit", () => {
    expect(decideReferralClaim({ ...base, clusterCount: 3 })).toEqual({
      ok: false,
      reason: "cluster",
    });
  });

  it("allows under the cluster limit", () => {
    expect(decideReferralClaim({ ...base, clusterCount: 2 })).toEqual({ ok: true });
  });
});

describe("uuidv5 (grant ref ids)", () => {
  // RFC 4122 test vector: uuidv5("www.example.com", DNS namespace)
  const DNS_NS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

  it("matches the RFC 4122 test vector", () => {
    expect(uuidv5("www.example.com", DNS_NS)).toBe(
      "2ed6657d-e927-568b-95e1-2665a8aea6a2",
    );
  });

  it("is deterministic for the same name", () => {
    const a = uuidv5("referral:abc:user1", REFERRAL_GRANT_NAMESPACE);
    const b = uuidv5("referral:abc:user1", REFERRAL_GRANT_NAMESPACE);
    expect(a).toBe(b);
  });

  it("differs per grantee and per referral", () => {
    const a = uuidv5("referral:abc:user1", REFERRAL_GRANT_NAMESPACE);
    const b = uuidv5("referral:abc:user2", REFERRAL_GRANT_NAMESPACE);
    const c = uuidv5("referral:xyz:user1", REFERRAL_GRANT_NAMESPACE);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it("produces a valid UUID v5", () => {
    const id = uuidv5("referral:abc:user1", REFERRAL_GRANT_NAMESPACE);
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
