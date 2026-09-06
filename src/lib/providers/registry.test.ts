import { describe, expect, it } from "vitest";
import { compliantVideoSource, providerHealthSnapshot } from "./registry";

describe("provider registry", () => {
  it("forbids YouTube download on the v1 video source policy", () => {
    expect(compliantVideoSource.supportsYouTubeDownload).toBe(false);
  });

  it("exposes a health snapshot without throwing", () => {
    const snap = providerHealthSnapshot();
    expect(snap.length).toBeGreaterThan(5);
    expect(snap.every((s) => typeof s.configured === "boolean")).toBe(true);
  });
});
