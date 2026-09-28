import { describe, expect, it } from "vitest";
import {
  API_KEY_PREFIX,
  API_KEY_RANDOM_LENGTH,
  API_KEY_SCOPES,
  SlidingWindowRateLimiter,
  hasScope,
  isValidApiKeyFormat,
  normalizeScopes,
  provenanceBlock,
  rateLimitHeaders,
} from "./keys";

describe("API key format", () => {
  it("accepts vdsk_ + 32 URL-safe chars", () => {
    expect(isValidApiKeyFormat(`${API_KEY_PREFIX}${"a".repeat(API_KEY_RANDOM_LENGTH)}`)).toBe(true);
    expect(isValidApiKeyFormat(`${API_KEY_PREFIX}${"A-9_".repeat(8)}`)).toBe(true);
  });

  it("rejects malformed keys", () => {
    expect(isValidApiKeyFormat("vdsk_short")).toBe(false);
    expect(isValidApiKeyFormat(`${API_KEY_PREFIX}${"a".repeat(31)}`)).toBe(false);
    expect(isValidApiKeyFormat(`${API_KEY_PREFIX}${"a".repeat(33)}`)).toBe(false);
    expect(isValidApiKeyFormat(`${API_KEY_PREFIX}${"a".repeat(31)}!`)).toBe(false);
    expect(isValidApiKeyFormat("sk_live_abc")).toBe(false);
    expect(isValidApiKeyFormat("")).toBe(false);
    expect(isValidApiKeyFormat(null)).toBe(false);
    expect(isValidApiKeyFormat(undefined)).toBe(false);
    expect(isValidApiKeyFormat(123)).toBe(false);
  });
});

describe("scope vocab", () => {
  it("pins exactly the five contract scopes", () => {
    expect([...API_KEY_SCOPES]).toEqual([
      "read:projects",
      "write:projects",
      "read:analytics",
      "publish:request",
      "admin:keys",
    ]);
  });

  it("normalizes valid scopes and dedupes", () => {
    expect(normalizeScopes(["read:projects", "read:projects", "publish:request"])).toEqual([
      "read:projects",
      "publish:request",
    ]);
  });

  it("rejects unknown scopes and empty lists (fail closed)", () => {
    expect(() => normalizeScopes(["read:everything"])).toThrow(/unknown API key scope/);
    expect(() => normalizeScopes([])).toThrow(/at least one scope/);
    expect(() => normalizeScopes("read:projects")).toThrow(/must be an array/);
    expect(() => normalizeScopes([null])).toThrow(/unknown API key scope/);
  });

  it("hasScope is exact membership, no wildcards", () => {
    expect(hasScope(["read:projects"], "read:projects")).toBe(true);
    expect(hasScope(["read:projects"], "write:projects")).toBe(false);
    expect(hasScope(["read:*"], "read:projects")).toBe(false);
    expect(hasScope([], "admin:keys")).toBe(false);
  });
});

describe("provenance block", () => {
  it("accepts the four pinned kinds", () => {
    for (const kind of ["real", "estimate", "ai_analysis", "fixture"] as const) {
      expect(provenanceBlock(kind)).toEqual({ provenance: kind });
    }
  });

  it("carries an optional basis note", () => {
    expect(provenanceBlock("estimate", "revenue_usd is an ESTIMATE")).toEqual({
      provenance: "estimate",
      basis: "revenue_usd is an ESTIMATE",
    });
  });

  it("rejects unknown kinds", () => {
    expect(() => provenanceBlock("guess" as never)).toThrow(/unknown provenance kind/);
  });
});

describe("SlidingWindowRateLimiter", () => {
  it("allows up to the limit, then denies with a retry delay", () => {
    const now = 1_000_000;
    const limiter = new SlidingWindowRateLimiter(() => now);
    for (let i = 0; i < 60; i++) {
      expect(limiter.check("k1", 60).allowed).toBe(true);
    }
    const denied = limiter.check("k1", 60);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it("slides: old hits expire out of the window", () => {
    let now = 1_000_000;
    const limiter = new SlidingWindowRateLimiter(() => now);
    expect(limiter.check("k", 1).allowed).toBe(true);
    expect(limiter.check("k", 1).allowed).toBe(false);
    now += 60_001; // window slides past the first hit
    expect(limiter.check("k", 1).allowed).toBe(true);
  });

  it("is per-bucket isolated", () => {
    const now = 1_000_000;
    const limiter = new SlidingWindowRateLimiter(() => now);
    expect(limiter.check("a", 1).allowed).toBe(true);
    expect(limiter.check("a", 1).allowed).toBe(false);
    expect(limiter.check("b", 1).allowed).toBe(true);
  });

  it("reset clears a bucket", () => {
    const now = 1_000_000;
    const limiter = new SlidingWindowRateLimiter(() => now);
    expect(limiter.check("k", 1).allowed).toBe(true);
    expect(limiter.check("k", 1).allowed).toBe(false);
    limiter.reset("k");
    expect(limiter.check("k", 1).allowed).toBe(true);
  });

  it("rejects non-positive limits", () => {
    const limiter = new SlidingWindowRateLimiter();
    expect(() => limiter.check("k", 0)).toThrow(/positive/);
    expect(() => limiter.check("k", -5)).toThrow(/positive/);
  });

  // D178: decisions expose remaining + epoch-second reset for headers.
  it("decision exposes limit, remaining, and epoch-second reset", () => {
    const now = 1_000_000; // fixed clock
    const limiter = new SlidingWindowRateLimiter(() => now);
    const first = limiter.check("k", 3);
    expect(first.allowed).toBe(true);
    expect(first.limit).toBe(3);
    expect(first.remaining).toBe(2);
    expect(first.resetAt).toBe(Math.floor((now + 60_000) / 1000));
    const second = limiter.check("k", 3);
    expect(second.remaining).toBe(1);
    limiter.check("k", 3); // exhausts
    const denied = limiter.check("k", 3);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.resetAt).toBe(Math.floor((now + 60_000) / 1000));
  });
});

describe("rateLimitHeaders", () => {
  it("emits the standard trio from a rate-limit state", () => {
    expect(
      rateLimitHeaders({ limit: 60, remaining: 41, reset: 1_759_000_000 }),
    ).toEqual({
      "X-RateLimit-Limit": "60",
      "X-RateLimit-Remaining": "41",
      "X-RateLimit-Reset": "1759000000",
    });
  });

  it("round-trips limiter decisions on allow and deny", () => {
    const limiter = new SlidingWindowRateLimiter(() => 2_000_000);
    const ok = limiter.check("k", 1);
    const okHeaders = rateLimitHeaders({
      limit: ok.limit,
      remaining: ok.remaining,
      reset: ok.resetAt,
    });
    expect(okHeaders["X-RateLimit-Limit"]).toBe("1");
    expect(okHeaders["X-RateLimit-Remaining"]).toBe("0");
    expect(okHeaders["X-RateLimit-Reset"]).toBe(String(Math.floor(2_060_000 / 1000)));
    const denied = limiter.check("k", 1);
    expect(denied.allowed).toBe(false);
    const denyHeaders = rateLimitHeaders({
      limit: denied.limit,
      remaining: denied.remaining,
      reset: denied.resetAt,
    });
    expect(denyHeaders["X-RateLimit-Remaining"]).toBe("0");
    // Reset is epoch seconds (X-RateLimit-Reset), not milliseconds.
    expect(Number(denyHeaders["X-RateLimit-Reset"])).toBeLessThan(10_000_000_000);
  });

  it("returns {} when there is no rate-limit state (e.g. 401 before any check)", () => {
    expect(rateLimitHeaders(undefined)).toEqual({});
  });
});
