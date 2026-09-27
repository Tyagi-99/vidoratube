/**
 * Phase 4 Stream E (F41) — API key primitives.
 *
 * PURE module (no node:, no DB, no Supabase): safe to import anywhere,
 * including unit tests. Server-only concerns (random generation, SHA-256,
 * DB access) live in `keys.server.ts`.
 *
 * Pinned contract (docs/PHASE4_CONTRACTS.md):
 * - Format: `vdsk_` + 32 URL-safe random chars.
 * - Header: `Authorization: Bearer vdsk_...`.
 * - Scope vocab: read:projects | write:projects | read:analytics |
 *   publish:request | admin:keys.
 * - `publish:request` creates a publish_job in `draft` ONLY — it can NEVER
 *   publish. Enforced in `src/lib/mcp/server.ts` and tested there.
 * - Default 60 req/min per key (in-memory sliding window here; multi-instance
 *   deployments need Redis — see D155).
 */

export const API_KEY_PREFIX = "vdsk_" as const;
/** 32 URL-safe chars after the prefix. */
export const API_KEY_RANDOM_LENGTH = 32 as const;

export const API_KEY_SCOPES = [
  "read:projects",
  "write:projects",
  "read:analytics",
  "publish:request",
  "admin:keys",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/** `vdsk_` + exactly 32 of [A-Za-z0-9_-]. */
const API_KEY_RE = /^vdsk_[A-Za-z0-9_-]{32}$/;

/** Format check only — says nothing about whether the key is valid/live. */
export function isValidApiKeyFormat(key: unknown): key is string {
  return typeof key === "string" && API_KEY_RE.test(key);
}

/**
 * Validate + dedupe a scope list against the pinned vocab. Throws on any
 * unknown scope — an API key must never carry a scope the server doesn't
 * understand (fail closed).
 */
export function normalizeScopes(input: unknown): ApiKeyScope[] {
  if (!Array.isArray(input)) throw new Error("scopes must be an array");
  const out = new Set<ApiKeyScope>();
  for (const s of input) {
    if (typeof s !== "string" || !(API_KEY_SCOPES as readonly string[]).includes(s)) {
      throw new Error(`unknown API key scope: ${String(s)}`);
    }
    out.add(s as ApiKeyScope);
  }
  if (out.size === 0) throw new Error("at least one scope is required");
  return [...out];
}

/** Scope check for the auth middleware: exact membership, no wildcards. */
export function hasScope(
  granted: readonly ApiKeyScope[] | readonly string[],
  required: ApiKeyScope,
): boolean {
  return (granted as readonly string[]).includes(required);
}

// ---------------------------------------------------------------------------
// Provenance block (pinned: every MCP tool response carries one)
// ---------------------------------------------------------------------------

export const PROVENANCE_KINDS = ["real", "estimate", "ai_analysis", "fixture"] as const;
export type ProvenanceKind = (typeof PROVENANCE_KINDS)[number];

export interface ProvenanceBlock {
  provenance: ProvenanceKind;
  /**
   * Human-readable basis note, e.g. "revenue_usd is an ESTIMATE" or
   * "caller-supplied text stored verbatim". Required whenever the kind is
   * not plain `real`.
   */
  basis?: string | undefined;
}

export function provenanceBlock(kind: ProvenanceKind, basis?: string | undefined): ProvenanceBlock {
  if (!(PROVENANCE_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`unknown provenance kind: ${String(kind)}`);
  }
  const block: ProvenanceBlock = { provenance: kind };
  if (basis !== undefined) block.basis = basis;
  return block;
}

// ---------------------------------------------------------------------------
// In-memory sliding-window rate limiter
// ---------------------------------------------------------------------------
// D155: per-process sliding window is correct for a single instance. A
// multi-instance deployment must move this to Redis (shared counters);
// the limiter is deliberately small and swappable so that migration is a
// one-file change.

export interface RateLimitDecision {
  allowed: boolean;
  /** ms until the oldest hit in the window expires (0 when allowed). */
  retryAfterMs: number;
}

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  check(bucket: string, limitPerMin: number): RateLimitDecision {
    if (!Number.isFinite(limitPerMin) || limitPerMin <= 0) {
      throw new Error("limitPerMin must be a positive number");
    }
    const now = this.now();
    const windowStart = now - 60_000;
    const recent = (this.hits.get(bucket) ?? []).filter((t) => t > windowStart);
    if (recent.length >= limitPerMin) {
      // oldest hit still inside the window decides the retry delay
      const oldest = recent[0] ?? now;
      this.hits.set(bucket, recent);
      return { allowed: false, retryAfterMs: Math.max(0, oldest + 60_000 - now) };
    }
    recent.push(now);
    this.hits.set(bucket, recent);
    // Opportunistic cleanup so a key spray can't grow the map forever.
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) {
        if (v.length === 0 || v[v.length - 1]! <= windowStart) this.hits.delete(k);
        if (this.hits.size <= 5_000) break;
      }
    }
    return { allowed: true, retryAfterMs: 0 };
  }

  reset(bucket?: string): void {
    if (bucket === undefined) this.hits.clear();
    else this.hits.delete(bucket);
  }
}
