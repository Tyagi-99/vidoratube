import { describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows up to max hits per window", () => {
    const limit = createRateLimiter({ windowMs: 60_000, max: 3 });
    expect(limit.check("a")).toBe(true);
    expect(limit.check("a")).toBe(true);
    expect(limit.check("a")).toBe(true);
    expect(limit.check("a")).toBe(false);
  });

  it("tracks keys independently", () => {
    const limit = createRateLimiter({ windowMs: 60_000, max: 1 });
    expect(limit.check("a")).toBe(true);
    expect(limit.check("a")).toBe(false);
    expect(limit.check("b")).toBe(true);
  });

  it("slides the window forward", () => {
    vi.useFakeTimers();
    try {
      const limit = createRateLimiter({ windowMs: 1_000, max: 1 });
      expect(limit.check("a")).toBe(true);
      expect(limit.check("a")).toBe(false);
      vi.advanceTimersByTime(1_001);
      expect(limit.check("a")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
