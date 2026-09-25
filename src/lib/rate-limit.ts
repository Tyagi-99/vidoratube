/**
 * Tiny dependency-free sliding-window rate limiter.
 *
 * Pure logic (no request context) so it is unit-testable; callers supply the
 * bucket key (e.g. client IP). State is in-memory: on serverless or
 * multi-instance deploys each instance keeps its own counters, so this blunts
 * casual abuse rather than enforcing a hard global cap. A shared store
 * (Redis/Upstash) would be needed for a strict guarantee.
 */

export interface RateLimiterOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Max allowed hits per key per window. */
  max: number;
}

export interface RateLimiter {
  /** Returns true when the hit is allowed, false when the key is over quota. */
  check: (key: string) => boolean;
}

export function createRateLimiter({ windowMs, max }: RateLimiterOptions): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    check(key: string): boolean {
      const now = Date.now();
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      // Opportunistic cleanup so the map cannot grow without bound.
      if (hits.size > 10000) {
        for (const [k, times] of hits) {
          if (times.length === 0 || now - times[times.length - 1]! > windowMs) hits.delete(k);
          if (hits.size <= 5000) break;
        }
      }
      return true;
    },
  };
}
