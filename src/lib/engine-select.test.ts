import { describe, expect, it } from "vitest";
import { resolveEffectiveEngine } from "./engine-select";

describe("resolveEffectiveEngine", () => {
  it("keeps server when the worker is online", () => {
    expect(resolveEffectiveEngine("server", true)).toBe("server");
  });

  it("falls back to browser when server is selected but the worker is offline", () => {
    expect(resolveEffectiveEngine("server", false)).toBe("browser");
  });

  it("keeps browser regardless of worker availability", () => {
    expect(resolveEffectiveEngine("browser", true)).toBe("browser");
    expect(resolveEffectiveEngine("browser", false)).toBe("browser");
  });
});
