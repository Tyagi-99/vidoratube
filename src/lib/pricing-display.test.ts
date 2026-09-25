import { describe, expect, it } from "vitest";
import { displayPlanFeatures, PRICING_FOOTNOTE, PRICING_FOOTNOTE_SETUP } from "./pricing-display";

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

  it("keeps the footnote honest about free credits", () => {
    expect(PRICING_FOOTNOTE.toLowerCase()).toMatch(/no card|free/);
    expect(PRICING_FOOTNOTE_SETUP.toLowerCase()).toMatch(/set up|no card|free/);
  });
});
