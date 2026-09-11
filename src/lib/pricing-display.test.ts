import { describe, expect, it } from "vitest";
import { displayPlanFeatures, PRICING_FOOTNOTE } from "./pricing-display";

describe("displayPlanFeatures", () => {
  it("does not advertise unshipped 4K, cloning, or API access", () => {
    const studio = displayPlanFeatures({
      slug: "studio",
      features: ["4K exports", "Voice cloning", "API access", "70 video credits / month"],
    });
    const joined = studio.join(" ").toLowerCase();
    expect(joined).not.toMatch(/4k/);
    expect(joined).not.toMatch(/cloning/);
    expect(joined).not.toMatch(/api access/);
    expect(studio.length).toBeGreaterThan(0);
  });

  it("keeps 1080p and captions on starter", () => {
    const starter = displayPlanFeatures({ slug: "starter", features: [] });
    const joined = starter.join(" ").toLowerCase();
    expect(joined).toMatch(/1080p/);
    expect(joined).toMatch(/caption/);
  });

  it("tells people checkout is not live", () => {
    expect(PRICING_FOOTNOTE.toLowerCase()).toMatch(/not live|no card|free/);
  });
});
