import { describe, expect, it } from "vitest";
import { provenanceSummary } from "./provenance";

describe("provenance", () => {
  it("summarises provider + model + license", () => {
    expect(
      provenanceSummary({
        provider: "ElevenLabs",
        model: "eleven_flash_v2_5",
        license: "Paid API output — yours to use",
      })
    ).toBe("Made with ElevenLabs (eleven_flash_v2_5) · Paid API output — yours to use");
  });

  it("omits model when absent", () => {
    expect(provenanceSummary({ provider: "Jamendo" })).toBe("Made with Jamendo");
  });

  it("omits license when absent", () => {
    expect(
      provenanceSummary({ provider: "Lovable AI", model: "gemini-2.5-flash-image" })
    ).toBe("Made with Lovable AI (gemini-2.5-flash-image)");
  });
});
