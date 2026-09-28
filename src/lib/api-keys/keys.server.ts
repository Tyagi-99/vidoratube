/**
 * Phase 4 Stream E (F41) — API key lifecycle + auth middleware.
 *
 * SERVER-ONLY (node:crypto, service-role DB). Never import from client
 * components.
 *
 * Security shape (D154):
 * - Raw key format `vdsk_` + 32 URL-safe chars, generated with
 *   crypto.randomBytes. The RAW key is returned to the caller ONCE at
 *   creation/rotation and NEVER stored — only the SHA-256 hex digest is
 *   persisted (`api_keys.key_hash`).
 * - Verification: indexed lookup by digest, then a constant-time
 *   `timingSafeEqual` re-compare of the recomputed digest vs the stored one
 *   (defense in depth; the digest is preimage-resistant so the indexed
 *   lookup leaks nothing useful).
 * - Auth: `Authorization: Bearer vdsk_...`. Failures are 401 (missing,
 *   malformed, unknown, revoked, expired) / 403 (scope) / 429 (rate limit).
 * - Rate limit: per-key in-memory sliding window, default 60/min from the
 *   key row (`rate_limit_per_min`). D155: multi-instance needs Redis.
 * - `last_used_at` is touched at most once per minute per key (best-effort).
 * - Every authenticated API call is audit-logged (the routes call
 *   `auditApiCall`; writes are fire-and-forget via `auditSafely` semantics).
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  API_KEY_PREFIX,
  SlidingWindowRateLimiter,
  hasScope,
  isValidApiKeyFormat,
  normalizeScopes,
  type ApiKeyScope,
  type RateLimitState,
} from "./keys";
// Structural DB surface (generated Database types are stale for api_keys).
export {
  untypedAdminDb,
  type UntypedDb,
  type UntypedQuery,
  type UntypedQueryResult,
  type UntypedSingleResult,
  type UntypedTable,
} from "../supabase/untyped";
import { untypedAdminDb, type UntypedDb } from "../supabase/untyped";

async function adminDb(): Promise<UntypedDb> {
  return untypedAdminDb();
}

// ---------------------------------------------------------------------------
// Key material
// ---------------------------------------------------------------------------

/** Generate a raw key: `vdsk_` + 32 URL-safe chars (24 random bytes, base64url). */
export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
}

/** SHA-256 hex digest of a raw key — the only form ever persisted. */
export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey, "utf8").digest("hex");
}

/** Constant-time compare of two hex digests. Length mismatch => false. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

/** Generate a raw invite-token (32 URL-safe chars, no prefix). */
export function generateInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

// ---------------------------------------------------------------------------
// Verified key + auth middleware
// ---------------------------------------------------------------------------

export interface VerifiedApiKey {
  id: string;
  workspaceId: string;
  name: string;
  scopes: ApiKeyScope[];
  rateLimitPerMin: number;
  createdBy: string | null;
  /** Internal: rate-limit bucket + last-used touch. Never sent to clients. */
  keyHash: string;
}

export interface ApiKeyMeta {
  id: string;
  name: string;
  scopes: ApiKeyScope[];
  rateLimitPerMin: number;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

interface ApiKeyRow {
  id: string;
  workspace_id: string;
  name: string;
  key_hash: string;
  scopes: string[];
  rate_limit_per_min: number;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  created_by: string | null;
  created_at: string;
}

function rowToMeta(row: ApiKeyRow): ApiKeyMeta {
  return {
    id: row.id,
    name: row.name,
    scopes: normalizeScopes(row.scopes),
    rateLimitPerMin: row.rate_limit_per_min,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
}

/** Look up a raw key and verify it. Returns null for any failure (fail closed). */
export async function verifyApiKey(rawKey: string, db?: UntypedDb): Promise<VerifiedApiKey | null> {
  if (!isValidApiKeyFormat(rawKey)) return null;
  const client = db ?? (await adminDb());
  const digest = hashApiKey(rawKey);
  const { data, error } = await client
    .from("api_keys")
    .select(
      "id, workspace_id, name, key_hash, scopes, rate_limit_per_min, expires_at, revoked_at, last_used_at, created_by, created_at",
    )
    .eq("key_hash", digest)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as ApiKeyRow;
  // Constant-time re-compare (defense in depth on top of the indexed lookup).
  if (!timingSafeEqualHex(row.key_hash, digest)) return null;
  if (row.revoked_at) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    scopes: normalizeScopes(row.scopes),
    rateLimitPerMin: row.rate_limit_per_min,
    createdBy: row.created_by,
    keyHash: row.key_hash,
  };
}

export type ApiAuthFailure = {
  status: 401 | 403 | 429;
  error: string;
  retryAfterMs?: number | undefined;
  /**
   * D178: present whenever the key passed the rate-limit check (so on 429
   * and on 403 after a successful check). Absent on 401, which runs before
   * any check.
   */
  rateLimit?: RateLimitState | undefined;
};

export type ApiAuthResult =
  | { ok: true; key: VerifiedApiKey; rateLimit: RateLimitState }
  | { ok: false; failure: ApiAuthFailure };

/** Shared in-memory limiter (D155: single-instance; Redis for multi-instance). */
export const apiKeyRateLimiter = new SlidingWindowRateLimiter();

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}

/**
 * Auth middleware for key-authenticated HTTP endpoints.
 *
 * Order: authenticate -> rate limit -> authorize (scope). Every failure is a
 * plain `{ ok: false, failure }` — the route maps it to the HTTP status.
 */
export async function authenticateApiKey(
  request: Request,
  requiredScopes: readonly ApiKeyScope[],
  opts?: { db?: UntypedDb; limiter?: SlidingWindowRateLimiter },
): Promise<ApiAuthResult> {
  const token = bearerToken(request);
  if (!token) {
    return { ok: false, failure: { status: 401, error: "missing Authorization Bearer token" } };
  }
  const key = await verifyApiKey(token, opts?.db);
  if (!key) {
    // Deliberately vague: malformed / unknown / revoked / expired are one bucket.
    return { ok: false, failure: { status: 401, error: "invalid API key" } };
  }

  const limiter = opts?.limiter ?? apiKeyRateLimiter;
  const limit = limiter.check(`api-key:${key.keyHash}`, key.rateLimitPerMin);
  const rateLimit: RateLimitState = {
    limit: limit.limit,
    remaining: limit.remaining,
    reset: limit.resetAt,
  };
  if (!limit.allowed) {
    return {
      ok: false,
      failure: {
        status: 429,
        error: `rate limit exceeded (${key.rateLimitPerMin}/min)`,
        retryAfterMs: limit.retryAfterMs,
        rateLimit,
      },
    };
  }

  for (const scope of requiredScopes) {
    if (!hasScope(key.scopes, scope)) {
      return {
        ok: false,
        failure: { status: 403, error: `missing required scope: ${scope}`, rateLimit },
      };
    }
  }

  // Best-effort last-used touch, at most once per minute per key.
  await touchLastUsed(opts?.db, key).catch(() => {});
  return { ok: true, key, rateLimit };
}

async function touchLastUsed(db: UntypedDb | undefined, key: VerifiedApiKey): Promise<void> {
  const client = db ?? (await adminDb());
  const { data, error } = await client
    .from("api_keys")
    .select("last_used_at")
    .eq("id", key.id)
    .maybeSingle();
  if (error || !data) return;
  const last = (data as unknown as { last_used_at: string | null }).last_used_at;
  if (last && Date.now() - new Date(last).getTime() < 60_000) return;
  await client.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", key.id);
}

// ---------------------------------------------------------------------------
// Lifecycle: create / list / revoke / rotate (service-role)
// ---------------------------------------------------------------------------

export interface CreateApiKeyInput {
  workspaceId: string;
  name: string;
  scopes: unknown;
  rateLimitPerMin?: number | undefined;
  expiresAt?: string | null | undefined;
  createdBy: string;
}

export interface CreatedApiKey {
  /** Metadata for the UI. */
  meta: ApiKeyMeta;
  /**
   * The RAW key — returned ONCE. Callers must surface it in the creation
   * response only and never persist or log it.
   */
  rawKey: string;
}

export async function createApiKey(
  input: CreateApiKeyInput,
  db?: UntypedDb,
): Promise<CreatedApiKey> {
  const client = db ?? (await adminDb());
  const name = input.name.trim();
  if (name.length < 1 || name.length > 80) throw new Error("name must be 1–80 chars");
  const scopes = normalizeScopes(input.scopes);
  const rateLimitPerMin = input.rateLimitPerMin ?? 60;
  if (!Number.isInteger(rateLimitPerMin) || rateLimitPerMin <= 0) {
    throw new Error("rateLimitPerMin must be a positive integer");
  }
  if (input.expiresAt !== undefined && input.expiresAt !== null) {
    const ts = new Date(input.expiresAt).getTime();
    if (!Number.isFinite(ts) || ts <= Date.now())
      throw new Error("expiresAt must be in the future");
  }

  const rawKey = generateApiKey();
  const { data, error } = await client
    .from("api_keys")
    .insert({
      workspace_id: input.workspaceId,
      name,
      key_hash: hashApiKey(rawKey),
      scopes,
      rate_limit_per_min: rateLimitPerMin,
      expires_at: input.expiresAt ?? null,
      created_by: input.createdBy,
    })
    .select(
      "id, workspace_id, name, key_hash, scopes, rate_limit_per_min, expires_at, revoked_at, last_used_at, created_by, created_at",
    )
    .single();
  if (error) throw new Error(`could not create API key: ${error.message}`);
  return { meta: rowToMeta(data as unknown as ApiKeyRow), rawKey };
}

/** List key METADATA only — the hash is not reversible, but the UI never needs it. */
export async function listApiKeys(workspaceId: string, db?: UntypedDb): Promise<ApiKeyMeta[]> {
  const client = db ?? (await adminDb());
  const { data, error } = await client
    .from("api_keys")
    .select(
      "id, workspace_id, name, scopes, rate_limit_per_min, expires_at, revoked_at, last_used_at, created_by, created_at",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`could not list API keys: ${error.message}`);
  return ((data ?? []) as unknown as (ApiKeyRow & { key_hash?: string })[]).map((row) =>
    rowToMeta({ ...row, key_hash: row.key_hash ?? "" } as ApiKeyRow),
  );
}

export async function revokeApiKey(
  keyId: string,
  workspaceId: string,
  db?: UntypedDb,
): Promise<void> {
  const client = db ?? (await adminDb());
  const { data, error } = await client
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId)
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`could not revoke API key: ${error.message}`);
  if (!data) throw new Error("API key not found or already revoked");
}

/**
 * Rotate: create a new key with the same name/scopes/rate-limit/expiry,
 * then revoke the old one. The new RAW key is returned ONCE.
 */
export async function rotateApiKey(
  keyId: string,
  workspaceId: string,
  actorUserId: string,
  db?: UntypedDb,
): Promise<CreatedApiKey> {
  const client = db ?? (await adminDb());
  const { data: oldRow, error: oldError } = await client
    .from("api_keys")
    .select("id, name, scopes, rate_limit_per_min, expires_at, revoked_at")
    .eq("id", keyId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (oldError || !oldRow) throw new Error("API key not found");
  const old = oldRow as unknown as Pick<
    ApiKeyRow,
    "name" | "scopes" | "rate_limit_per_min" | "expires_at" | "revoked_at"
  >;
  if (old.revoked_at) throw new Error("API key is already revoked");

  // Create the replacement FIRST so there is never a gap with zero live keys.
  const created = await createApiKey(
    {
      workspaceId,
      name: old.name,
      scopes: old.scopes,
      rateLimitPerMin: old.rate_limit_per_min,
      expiresAt: old.expires_at,
      createdBy: actorUserId,
    },
    client,
  );
  try {
    await revokeApiKey(keyId, workspaceId, client);
  } catch (e) {
    // The new key is live but the old one survived — loud, not silent.
    console.error(
      "[api-keys] rotation created a new key but failed to revoke the old one",
      JSON.stringify({ oldKeyId: keyId, newKeyId: created.meta.id }),
      e instanceof Error ? e.message : String(e),
    );
    throw new Error("new key created, but revoking the old key failed — revoke it manually");
  }
  return created;
}

// ---------------------------------------------------------------------------
// Audit (D157: fire-and-forget single row per authenticated call)
// ---------------------------------------------------------------------------

export async function auditApiCall(
  input: {
    workspaceId: string;
    actorUserId: string | null;
    action: string;
    entityType?: string | undefined;
    entityId?: string | null | undefined;
    metadata?: Record<string, unknown> | undefined;
  },
  db?: UntypedDb,
): Promise<void> {
  const client = db ?? (await adminDb());
  try {
    const { error } = await client.from("audit_logs").insert({
      workspace_id: input.workspaceId,
      actor_user_id: input.actorUserId,
      action: input.action,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      metadata: input.metadata ?? {},
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    // Audit must never break the API call it records.
    console.warn(
      "[audit] failed to write API audit log",
      JSON.stringify({ action: input.action, workspaceId: input.workspaceId }),
      err instanceof Error ? err.message : String(err),
    );
  }
}
