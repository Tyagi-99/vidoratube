import { describe, expect, it } from "vitest";
import { canEnterStage, DEFAULT_NICHE_SEEDS, isApprovedRights } from "./stages";

describe("rights gate", () => {
  it("blocks asset acquisition without approval", () => {
    const r = canEnterStage({ target: "asset_acquired", rightsStatus: "unknown" });
    expect(r.ok).toBe(false);
  });

  it("allows asset acquisition when licensed", () => {
    expect(canEnterStage({ target: "asset_acquired", rightsStatus: "licensed" })).toEqual({
      ok: true,
    });
  });

  it("allows early stages without rights approval", () => {
    expect(canEnterStage({ target: "shortlisted", rightsStatus: "unknown" })).toEqual({ ok: true });
    expect(canEnterStage({ target: "rights_check", rightsStatus: "permission_required" })).toEqual({
      ok: true,
    });
  });

  it("treats do_not_use as a hard stop", () => {
    const r = canEnterStage({ target: "approved", rightsStatus: "do_not_use" });
    expect(r.ok).toBe(false);
  });

  it("recognizes approved rights set", () => {
    expect(isApprovedRights("permission_granted")).toBe(true);
    expect(isApprovedRights("permission_requested")).toBe(false);
  });

  it("exposes seed niches as data", () => {
    expect(DEFAULT_NICHE_SEEDS.length).toBeGreaterThanOrEqual(13);
    expect(DEFAULT_NICHE_SEEDS.some((n) => n.slug === "nature")).toBe(true);
  });
});
