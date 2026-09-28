/**
 * Phase 4 Stream E (F41) — API key lifecycle + auth middleware tests.
 *
 * Uses REAL-format keys (generated via generateApiKey, never hardcoded
 * fakes) against an in-memory fake of the UntypedDb surface. The crypto
 * (SHA-256, timingSafeEqual) and the format/scope/rate-limit logic are all
 * real; only the network is faked.
 */
import { describe, expect, it } from "vitest";
import {
  authenticateApiKey,
  createApiKey,
  generateApiKey,
  hashApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  timingSafeEqualHex,
  verifyApiKey,
  type UntypedDb,
  type UntypedQuery,
} from "./keys.server";
import { SlidingWindowRateLimiter } from "./keys";

// ---------------------------------------------------------------------------
// In-memory fake of UntypedDb
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Filter = { col: string; op: "eq" | "neq" | "isnull"; val: unknown };

function makeFakeDb(): UntypedDb & { tables: Map<string, Row[]> } {
  const tables = new Map<string, Row[]>();
  let seq = 0;
  const rowsOf = (t: string): Row[] => {
    if (!tables.has(t)) tables.set(t, []);
    return tables.get(t)!;
  };

  const makeQuery = (
    tname: string,
    mode: "select" | "insert" | "update" | "delete",
    payload?: Row,
  ): UntypedQuery => {
    const filters: Filter[] = [];
    let orderCol: string | null = null;
    let orderAsc = true;
    let limitN: number | null = null;

    const applyFilters = (): Row[] => {
      let rows = rowsOf(tname).slice();
      for (const f of filters) {
        rows = rows.filter((r) => {
          const v = r[f.col];
          if (f.op === "eq") return v === f.val;
          if (f.op === "neq") return v !== f.val;
          return v === null || v === undefined;
        });
      }
      if (orderCol) {
        const col = orderCol;
        rows = rows.slice().sort((a, b) => {
          const av = a[col];
          const bv = b[col];
          if (av === bv) return 0;
          if (av == null) return 1;
          if (bv == null) return -1;
          return (av < bv ? -1 : 1) * (orderAsc ? 1 : -1);
        });
      }
      if (limitN !== null) rows = rows.slice(0, limitN);
      return rows;
    };

    const run = (): { data: Row[] | null; error: { message: string } | null } => {
      if (mode === "insert") {
        seq += 1;
        const row: Row = {
          id: `fake-id-${seq}`,
          created_at: new Date().toISOString(),
          ...payload,
        };
        rowsOf(tname).push(row);
        return { data: [row], error: null };
      }
      if (mode === "update") {
        const matched = applyFilters();
        for (const r of matched) Object.assign(r, payload);
        return { data: matched, error: null };
      }
      if (mode === "delete") {
        const matched = applyFilters();
        const rest = rowsOf(tname).filter((r) => !matched.includes(r));
        tables.set(tname, rest);
        return { data: matched, error: null };
      }
      return { data: applyFilters(), error: null };
    };

    const q = {
      select(_cols?: string) {
        return q;
      },
      eq(col: string, val: unknown) {
        filters.push({ col, op: "eq", val });
        return q;
      },
      neq(col: string, val: unknown) {
        filters.push({ col, op: "neq", val });
        return q;
      },
      is(col: string, val: null) {
        filters.push({ col, op: "isnull", val });
        return q;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderCol = col;
        orderAsc = opts?.ascending ?? true;
        return q;
      },
      limit(n: number) {
        limitN = n;
        return q;
      },
      async maybeSingle() {
        const r = run();
        return { data: r.data?.[0] ?? null, error: r.error };
      },
      async single() {
        const r = await q.maybeSingle();
        if (!r.data) return { data: null as unknown as Row, error: { message: "no rows" } };
        return { data: r.data, error: null };
      },
      then(onF: unknown, onR: unknown) {
        const r = run();
        return Promise.resolve(r).then(
          onF as (v: unknown) => unknown,
          onR as (e: unknown) => unknown,
        );
      },
    } as unknown as UntypedQuery;
    return q;
  };

  const db = {
    tables,
    from(tname: string) {
      return {
        select: (cols?: string) => makeQuery(tname, "select").select(cols),
        insert: (row: Row) => makeQuery(tname, "insert", row),
        update: (patch: Row) => makeQuery(tname, "update", patch),
        delete: () => makeQuery(tname, "delete"),
      };
    },
  };
  return db as unknown as UntypedDb & { tables: Map<string, Row[]> };
}

const WS = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

function authed(rawKey: string) {
  return new Request("https://x.test/api/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${rawKey}` },
  });
}

describe("key material", () => {
  it("generates real-format keys (vdsk_ + 32 URL-safe chars)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const k = generateApiKey();
      expect(k).toMatch(/^vdsk_[A-Za-z0-9_-]{32}$/);
      seen.add(k);
    }
    expect(seen.size).toBe(50); // no collisions in 50 draws
  });

  it("hashes deterministically with SHA-256 hex", () => {
    const k = generateApiKey();
    expect(hashApiKey(k)).toBe(hashApiKey(k));
    expect(hashApiKey(k)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(generateApiKey())).not.toBe(hashApiKey(k));
  });

  it("timingSafeEqualHex compares digests in constant time", () => {
    const h = hashApiKey(generateApiKey());
    expect(timingSafeEqualHex(h, h)).toBe(true);
    expect(timingSafeEqualHex(h, hashApiKey(generateApiKey()))).toBe(false);
    expect(timingSafeEqualHex(h, "abc")).toBe(false);
    expect(timingSafeEqualHex("", "")).toBe(false);
  });
});

describe("create / verify / list / revoke round-trip", () => {
  it("creates a key, returns the raw key ONCE, verifies it", async () => {
    const db = makeFakeDb();
    const created = await createApiKey(
      { workspaceId: WS, name: "mcp-agent", scopes: ["read:projects"], createdBy: USER },
      db,
    );
    expect(created.rawKey).toMatch(/^vdsk_/);

    // The stored row holds the hash, never the raw key.
    const stored = db.tables.get("api_keys")!;
    expect(stored).toHaveLength(1);
    expect(stored[0]!["key_hash"]).toBe(hashApiKey(created.rawKey));
    expect(JSON.stringify(stored[0])).not.toContain(created.rawKey.slice(5));

    const verified = await verifyApiKey(created.rawKey, db);
    expect(verified).not.toBeNull();
    expect(verified!.workspaceId).toBe(WS);
    expect(verified!.scopes).toEqual(["read:projects"]);
    expect(verified!.name).toBe("mcp-agent");
  });

  it("lists metadata only (no hash, no raw key)", async () => {
    const db = makeFakeDb();
    const created = await createApiKey(
      { workspaceId: WS, name: "list-me", scopes: ["read:projects"], createdBy: USER },
      db,
    );
    const metas = await listApiKeys(WS, db);
    expect(metas).toHaveLength(1);
    expect(metas[0]!.id).toBe(created.meta.id);
    expect(metas[0]!.name).toBe("list-me");
    expect(JSON.stringify(metas[0])).not.toContain(created.rawKey.slice(5));
    expect("key_hash" in (metas[0] as object)).toBe(false);
  });

  it("revoked keys stop verifying", async () => {
    const db = makeFakeDb();
    const created = await createApiKey(
      { workspaceId: WS, name: "doomed", scopes: ["read:projects"], createdBy: USER },
      db,
    );
    expect(await verifyApiKey(created.rawKey, db)).not.toBeNull();
    await revokeApiKey(created.meta.id, WS, db);
    expect(await verifyApiKey(created.rawKey, db)).toBeNull();
    await expect(revokeApiKey(created.meta.id, WS, db)).rejects.toThrow(/already revoked/);
  });

  it("expired keys stop verifying", async () => {
    const db = makeFakeDb();
    const created = await createApiKey(
      {
        workspaceId: WS,
        name: "short-lived",
        scopes: ["read:projects"],
        createdBy: USER,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
      db,
    );
    expect(await verifyApiKey(created.rawKey, db)).not.toBeNull();
    // Expire it directly.
    db.tables.get("api_keys")![0]!["expires_at"] = new Date(Date.now() - 1000).toISOString();
    expect(await verifyApiKey(created.rawKey, db)).toBeNull();
  });

  it("rejects bad create input (fail closed)", async () => {
    const db = makeFakeDb();
    await expect(
      createApiKey({ workspaceId: WS, name: "", scopes: ["read:projects"], createdBy: USER }, db),
    ).rejects.toThrow(/name/);
    await expect(
      createApiKey({ workspaceId: WS, name: "x", scopes: ["nope"], createdBy: USER }, db),
    ).rejects.toThrow(/unknown API key scope/);
    await expect(
      createApiKey({ workspaceId: WS, name: "x", scopes: [], createdBy: USER }, db),
    ).rejects.toThrow(/at least one scope/);
    await expect(
      createApiKey(
        {
          workspaceId: WS,
          name: "x",
          scopes: ["read:projects"],
          rateLimitPerMin: 0,
          createdBy: USER,
        },
        db,
      ),
    ).rejects.toThrow(/positive integer/);
  });
});

describe("rotate", () => {
  it("issues a new raw key and revokes the old one", async () => {
    const db = makeFakeDb();
    const first = await createApiKey(
      {
        workspaceId: WS,
        name: "rot",
        scopes: ["read:projects", "publish:request"],
        createdBy: USER,
      },
      db,
    );
    const rotated = await rotateApiKey(first.meta.id, WS, USER, db);
    expect(rotated.rawKey).not.toBe(first.rawKey);
    expect(rotated.rawKey).toMatch(/^vdsk_/);
    // New key carries the same scopes.
    const verified = await verifyApiKey(rotated.rawKey, db);
    expect(verified!.scopes).toEqual(["read:projects", "publish:request"]);
    // Old key is dead.
    expect(await verifyApiKey(first.rawKey, db)).toBeNull();
    const metas = await listApiKeys(WS, db);
    expect(metas).toHaveLength(2);
    expect(metas.filter((m) => m.revokedAt).length).toBe(1);
  });

  it("refuses to rotate an already-revoked key", async () => {
    const db = makeFakeDb();
    const first = await createApiKey(
      { workspaceId: WS, name: "rot2", scopes: ["read:projects"], createdBy: USER },
      db,
    );
    await revokeApiKey(first.meta.id, WS, db);
    await expect(rotateApiKey(first.meta.id, WS, USER, db)).rejects.toThrow(/already revoked/);
  });
});

describe("authenticateApiKey middleware", () => {
  async function setup(scopes: string[] = ["read:projects"], rateLimitPerMin = 60) {
    const db = makeFakeDb();
    const created = await createApiKey(
      { workspaceId: WS, name: "mw", scopes, createdBy: USER, rateLimitPerMin },
      db,
    );
    return { db, rawKey: created.rawKey };
  }

  it("401 when the Authorization header is missing or malformed", async () => {
    const { db } = await setup();
    const noHeader = await authenticateApiKey(new Request("https://x.test/"), [], { db });
    expect(noHeader.ok).toBe(false);
    if (!noHeader.ok) expect(noHeader.failure.status).toBe(401);

    const badScheme = await authenticateApiKey(
      new Request("https://x.test/", { headers: { authorization: "Token abc" } }),
      [],
      { db },
    );
    expect(badScheme.ok).toBe(false);
    if (!badScheme.ok) expect(badScheme.failure.status).toBe(401);
  });

  it("401 for unknown keys and wrong-format tokens", async () => {
    const { db } = await setup();
    const unknown = generateApiKey(); // well-formed but never issued
    const r1 = await authenticateApiKey(authed(unknown), [], { db });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.failure.status).toBe(401);

    const r2 = await authenticateApiKey(authed("vdsk_not-a-real-key"), [], { db });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.failure.status).toBe(401);
  });

  it("403 when a required scope is missing", async () => {
    const { db, rawKey } = await setup(["read:projects"]);
    const r = await authenticateApiKey(authed(rawKey), ["write:projects"], { db });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.status).toBe(403);
      expect(r.failure.error).toMatch(/write:projects/);
    }
  });

  it("429 when the per-key rate limit is exceeded", async () => {
    const { db, rawKey } = await setup(["read:projects"], 2);
    const limiter = new SlidingWindowRateLimiter();
    expect((await authenticateApiKey(authed(rawKey), [], { db, limiter })).ok).toBe(true);
    expect((await authenticateApiKey(authed(rawKey), [], { db, limiter })).ok).toBe(true);
    const third = await authenticateApiKey(authed(rawKey), [], { db, limiter });
    expect(third.ok).toBe(false);
    if (!third.ok) {
      expect(third.failure.status).toBe(429);
      expect(third.failure.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it("200-path: verified key passes with its scopes", async () => {
    const { db, rawKey } = await setup(["read:projects", "publish:request"]);
    const r = await authenticateApiKey(authed(rawKey), ["publish:request"], { db });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.key.workspaceId).toBe(WS);
      expect(r.key.createdBy).toBe(USER);
    }
  });
});
