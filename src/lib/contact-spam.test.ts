import { describe, expect, it } from "vitest";
import { contactLimiter } from "./public.functions";

describe("contact form spam protection", () => {
  it("allows a handful of messages then blocks the IP for the window", () => {
    const ip = `test-ip-${Date.now()}`;
    for (let i = 0; i < 5; i++) {
      expect(contactLimiter.check(ip)).toBe(true);
    }
    // 6th message within the hour is rejected with a clear error upstream.
    expect(contactLimiter.check(ip)).toBe(false);
  });

  it("tracks IPs independently", () => {
    const ip = `test-ip-other-${Date.now()}`;
    expect(contactLimiter.check(ip)).toBe(true);
  });
});
