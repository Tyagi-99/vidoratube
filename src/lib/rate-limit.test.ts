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

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { checkPostgresRateLimit, enforcePostgresRateLimit } from "./rate-limit";

function mockAdmin(result: { data: boolean | null; error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { rpc, admin: { rpc } as unknown as SupabaseClient<Database> };
}

describe("checkPostgresRateLimit", () => {
  it("returns the RPC verdict and passes the bucket args through", async () => {
    const { rpc, admin } = mockAdmin({ data: true, error: null });
    await expect(
      checkPostgresRateLimit(admin, "job:create:u1", { max: 10, windowSeconds: 3600 }),
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("check_rate_limit", {
      p_key: "job:create:u1",
      p_max: 10,
      p_window_seconds: 3600,
    });

    const blocked = mockAdmin({ data: false, error: null });
    await expect(
      checkPostgresRateLimit(blocked.admin, "job:create:u1", { max: 10, windowSeconds: 3600 }),
    ).resolves.toBe(false);
  });

  it("fails open when the RPC errors", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { admin } = mockAdmin({ data: null, error: { message: "db down" } });
      await expect(
        checkPostgresRateLimit(admin, "k", { max: 1, windowSeconds: 60 }),
      ).resolves.toBe(true);
      expect(errSpy).toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe("enforcePostgresRateLimit", () => {
  it("throws the custom message when over quota", async () => {
    const { admin } = mockAdmin({ data: false, error: null });
    await expect(
      enforcePostgresRateLimit(admin, "k", { max: 5, windowSeconds: 3600 }, "Slow down!"),
    ).rejects.toThrow("Slow down!");
  });

  it("resolves when under quota", async () => {
    const { admin } = mockAdmin({ data: true, error: null });
    await expect(
      enforcePostgresRateLimit(admin, "k", { max: 5, windowSeconds: 3600 }),
    ).resolves.toBeUndefined();
  });
});
