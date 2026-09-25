import { describe, expect, it, vi } from "vitest";
import {
  decideReferralClaim,
  generateReferralCode,
  isValidReferralCode,
  REFERRAL_REWARD_CREDITS,
  referralPath,
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
