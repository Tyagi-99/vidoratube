/**
 * Tiny dependency-free sliding-window rate limiter.
 *
 * Pure logic (no request context) so it is unit-testable; callers supply the
 * bucket key (e.g. client IP). State is in-memory: on serverless or
 * multi-instance deploys each instance keeps its own counters, so this blunts
 * casual abuse rather than enforcing a hard global cap. For a strict global
 * guarantee use checkPostgresRateLimit() below, which is backed by Postgres.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

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

export interface PostgresRateLimit {
  /** Max hits per key per window. */
  max: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/**
 * Postgres-backed sliding-window rate limit — the source of truth across
 * instances. Backed by the atomic `check_rate_limit()` RPC (service_role
 * only): concurrent callers serialize on the bucket row, so the cap is a
 * hard global cap, not per-instance.
 *
 * Fails OPEN: if the RPC errors, the hit is allowed and the error is logged.
 * A broken rate limiter must not become a self-inflicted outage.
 */
export async function checkPostgresRateLimit(
  supabaseAdmin: SupabaseClient<Database>,
  key: string,
  { max, windowSeconds }: PostgresRateLimit,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("check_rate_limit", {
    p_key: key,
    p_max: max,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("[rate-limit] check_rate_limit RPC failed:", error.message);
    return true;
  }
  return data === true;
}

/** Convenience: enforce a Postgres rate limit, throwing a friendly error when hit. */
export async function enforcePostgresRateLimit(
  supabaseAdmin: SupabaseClient<Database>,
  key: string,
  limit: PostgresRateLimit,
  message = "Too many requests. Please slow down and try again later.",
): Promise<void> {
  if (!(await checkPostgresRateLimit(supabaseAdmin, key, limit))) {
    throw new Error(message);
  }
}
