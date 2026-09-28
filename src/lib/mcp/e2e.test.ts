/**
 * Phase 5 Stream B (D179) — MCP E2E harness (permanent test).
 *
 * Drives ALL 8 pinned tools through the REAL `handleJsonRpc` JSON-RPC
 * envelope with the FAKE data port (the fake port IS the sandbox workspace
 * here) and a REAL `authenticateApiKey` implementation against an
 * in-memory key store (real SHA-256 key verification, real per-key
 * sliding-window rate limits, real scope checks).
 *
 * Coverage: tools/list, tools/call success for all 8 tools, unknown tool,
 * insufficient scope, invalid arguments, 429 rate limit (with retry_after_ms
 * + rate-limit state for X-RateLimit-* headers), and audit-hook invocation
 * (including on failures).
 *
 * No network calls: the port, the key store, and the generator are all
 * in-memory fakes; only the security plumbing (auth, scopes, rate limits,
 * JSON-RPC envelope, dispatcher) is real.
 */
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  MCP_TOOLS,
  handleJsonRpc,
  type McpCallDeps,
  type McpDataPort,
  type McpHttpDeps,
} from "./server";
import {
  authenticateApiKey,
  createApiKey,
  type UntypedDb,
  type UntypedQuery,
  type UntypedQueryResult,
  type UntypedSingleResult,
} from "../api-keys/keys.server";
import {
  SlidingWindowRateLimiter,
  type ApiKeyScope,
  type RateLimitState,
} from "../api-keys/keys";

// ---------------------------------------------------------------------------
// Minimal in-memory UntypedDb (api_keys table only)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

class FakeQuery implements UntypedQuery {
  private filters: Array<{ col: string; val: unknown }> = [];
  /** Eagerly inserted row (insert executes at construction, like postgrest). */
  private readonly inserted: Row | null;

  constructor(
    private readonly rows: Row[],
    private readonly mode: "select" | "insert" | "update",
    private readonly payload?: Row,
  ) {
    if (mode === "insert") {
      const row: Row = { id: randomUUID(), created_at: new Date().toISOString(), ...payload };
      rows.push(row);
      this.inserted = row;
    } else {
      this.inserted = null;
    }
  }

  private apply(): Row[] {
    if (this.inserted) return [this.inserted];
    return this.rows.filter((r) => this.filters.every((f) => r[f.col] === f.val));
  }

  select(_cols?: string): UntypedQuery {
    return this;
  }
  eq(col: string, val: unknown): UntypedQuery {
    this.filters.push({ col, val });
    return this;
  }
  neq(_col: string, _val: unknown): UntypedQuery {
    return this;
  }
  gt(_col: string, _val: unknown): UntypedQuery {
    return this;
  }
  ilike(_col: string, _pattern: string): UntypedQuery {
    return this;
  }
  is(_col: string, _val: null): UntypedQuery {
    return this;
  }
  order(_col: string, _opts?: { ascending?: boolean }): UntypedQuery {
    return this;
  }
  limit(_n: number): UntypedQuery {
    return this;
  }

  private execute(): UntypedQueryResult {
    if (this.mode === "update") {
      const targets = this.rows.filter((r) => this.filters.every((f) => r[f.col] === f.val));
      for (const t of targets) Object.assign(t, this.payload);
      return { data: targets, error: null };
    }
    return { data: this.apply(), error: null };
  }

  then<TResult1 = UntypedQueryResult, TResult2 = never>(
    onfulfilled?:
      | ((value: UntypedQueryResult) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  async maybeSingle(): Promise<UntypedSingleResult> {
    const data = this.apply();
    return { data: data[0] ?? null, error: null };
  }

  async single(): Promise<{ data: Record<string, unknown>; error: { message: string } | null }> {
    const data = this.apply();
    const first = data[0];
    if (!first) return { data: {}, error: { message: "no rows" } };
    return { data: first, error: null };
  }
}

function makeKeyStore(): UntypedDb & { rows: Row[] } {
  const rows: Row[] = [];
  return {
    rows,
    from: (table: string) => {
      if (table !== "api_keys") throw new Error(`e2e key store only has api_keys, got ${table}`);
      return {
        select: (_cols?: string) => new FakeQuery(rows, "select"),
        insert: (row: Row) => new FakeQuery(rows, "insert", row),
        // e2e fake: upsert behaves like insert (no conflict handling needed here).
        upsert: (row: Row, _opts?: { onConflict?: string }) =>
          new FakeQuery(rows, "insert", row),
        update: (patch: Row) => new FakeQuery(rows, "update", patch),
        delete: () => new FakeQuery(rows, "select"),
      };
    },
    storage: {
      from: () => {
        throw new Error("no storage in e2e");
      },
    },
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: null }, error: null }),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Fake data port (the sandbox workspace)
// ---------------------------------------------------------------------------

function makeFakePort(): McpDataPort {
  const chId = randomUUID();
  const projId = randomUUID();
  const ids = { chId, projId };
  const port: McpDataPort = {
    async searchChannels() {
      return [
        {
          id: chId,
          platform: "youtube",
          handle: "@e2e",
          title: "E2E Channel",
          is_own: true,
          status: "tracked",
        },
      ];
    },
    async getChannel(input) {
      return {
        id: input.channelId,
        platform: "youtube",
        handle: "@e2e",
        title: "E2E Channel",
        is_own: true,
        status: "tracked",
        external_channel_id: "UCe2e",
        latest_snapshot: null,
      };
    },
    async listProjects() {
      return [
        {
          id: projId,
          title: "E2E Project",
          topic: "e2e",
          status: "draft",
          updated_at: "2026-09-28T00:00:00.000Z",
        },
      ];
    },
    async getProject(input) {
      return {
        id: input.projectId,
        title: "E2E Project",
        topic: "e2e",
        status: "draft",
        updated_at: "2026-09-28T00:00:00.000Z",
        mode: "stock",
        language: "English",
        duration_minutes: 5,
        latest_script: null,
      };
    },
    async createDraftScript() {
      return { script_id: randomUUID(), version_number: 1, status: "draft" as const };
    },
    // Sandbox generator: no network, no real LLM — the dispatcher still
    // exercises the generate path and its provenance block.
    async generateScriptDraft() {
      return {
        ok: true as const,
        result: {
          script_id: randomUUID(),
          version_number: 1,
          status: "draft" as const,
          estimated_credits: 1,
          actual_credits: 1,
        },
        estimatedCredits: 1,
        actualCredits: 1,
      };
    },
    async createDraftPublishJob() {
      return { publish_job_id: randomUUID(), status: "draft" as const };
    },
    async getChannelAnalytics(input) {
      return {
        channel_id: input.channelId,
        snapshot: {
          snapshot_date: "2026-09-28",
          metrics: { views: 100 },
          revenue_usd: 2.5,
          revenue_basis: "estimate",
        },
      };
    },
    async listLearnings() {
      return [
        {
          id: randomUUID(),
          kind: "retention",
          status: "validated",
          confidence: 0.8,
          origin: "ai_analysis" as const,
          evidence: null,
          created_at: "2026-09-28T00:00:00.000Z",
        },
      ];
    },
  };
  return Object.assign(port, { ids });
}

// ---------------------------------------------------------------------------
// Env builder: real auth against the in-memory key store
// ---------------------------------------------------------------------------

const ALL_SCOPES: ApiKeyScope[] = [
  "read:projects",
  "write:projects",
  "read:analytics",
  "publish:request",
];

interface AuditEntry {
  tool: string;
  ok: boolean;
  errorCode?: string | undefined;
}

interface Env {
  depsFor: (rawKey: string, audit?: McpCallDeps["audit"]) => McpHttpDeps;
  auditLog: AuditEntry[];
  lastRateLimit: { current: RateLimitState | undefined };
  fullKey: string;
  readOnlyKey: string;
  tinyKey: string;
  ids: { chId: string; projId: string };
}

async function makeEnv(): Promise<Env> {
  const store = makeKeyStore();
  const limiter = new SlidingWindowRateLimiter();
  const auditLog: AuditEntry[] = [];
  const lastRateLimit: { current: RateLimitState | undefined } = { current: undefined };

  const mkKey = async (scopes: ApiKeyScope[], rateLimitPerMin: number): Promise<string> => {
    const created = await createApiKey(
      {
        workspaceId: randomUUID(),
        name: `e2e-${randomUUID()}`,
        scopes,
        rateLimitPerMin,
        createdBy: randomUUID(),
      },
      store,
    );
    return created.rawKey;
  };

  const fullKey = await mkKey(ALL_SCOPES, 60);
  const readOnlyKey = await mkKey(["read:projects", "read:analytics"], 60);
  const tinyKey = await mkKey(ALL_SCOPES, 1);

  const port = makeFakePort() as McpDataPort & { ids: { chId: string; projId: string } };

  const depsFor = (rawKey: string, audit?: McpCallDeps["audit"]): McpHttpDeps => ({
    // REAL authenticateApiKey — real bearer parsing, real SHA-256 lookup,
    // real sliding-window rate limit, real scope checks. Only the DB is
    // an in-memory key store.
    authenticate: async (requiredScopes: ApiKeyScope[]) => {
      const request = new Request("https://e2e.test/api/mcp", {
        headers: { authorization: `Bearer ${rawKey}` },
      });
      const auth = await authenticateApiKey(request, requiredScopes, { db: store, limiter });
      if (!auth.ok) {
        const body: Record<string, unknown> = { error: auth.failure.error };
        if (auth.failure.retryAfterMs !== undefined) {
          body["retry_after_ms"] = auth.failure.retryAfterMs;
        }
        lastRateLimit.current = auth.failure.rateLimit;
        return {
          failure: {
            status: auth.failure.status,
            body,
            rateLimit: auth.failure.rateLimit,
          },
        };
      }
      lastRateLimit.current = auth.rateLimit;
      return { key: auth.key, rateLimit: auth.rateLimit };
    },
    port,
    audit:
      audit ??
      (async (entry) => {
        auditLog.push({ tool: entry.tool, ok: entry.ok, errorCode: entry.errorCode });
      }),
  });

  return { depsFor, auditLog, lastRateLimit, fullKey, readOnlyKey, tinyKey, ids: port.ids };
}

const rpc = (method: string, params?: unknown) => ({
  jsonrpc: "2.0" as const,
  id: 1,
  method,
  ...(params !== undefined ? { params } : {}),
});

type RpcOk = { jsonrpc: "2.0"; id: number; result: unknown };
type RpcErr = {
  jsonrpc: "2.0";
  id: number | null;
  error: { code: number; message: string; data?: unknown };
};

function isOk(body: unknown): body is RpcOk {
  return (body as RpcOk).result !== undefined;
}

// ---------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------

describe("MCP E2E harness (real envelope + real auth, sandbox port)", () => {
  it("tools/list returns the 8 pinned tools with JSON schemas", async () => {
    const env = await makeEnv();
    const { status, body } = await handleJsonRpc(env.depsFor(env.fullKey), rpc("tools/list"));
    expect(status).toBe(200);
    expect(body.jsonrpc).toBe("2.0");
    expect(isOk(body)).toBe(true);
    if (isOk(body)) {
      const tools = (body.result as { tools: { name: string; inputSchema: unknown }[] }).tools;
      expect(tools).toHaveLength(8);
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual(MCP_TOOLS.map((t) => t.name).sort());
      for (const t of tools) expect(t.inputSchema).toMatchObject({ type: "object" });
    }
  });

  it("all 8 tools succeed through tools/call (real envelope, sandbox port)", async () => {
    const env = await makeEnv();
    const deps = env.depsFor(env.fullKey);
    const args: Record<string, Record<string, unknown>> = {
      "vidora.search_channels": { query: "e2e", limit: 5 },
      "vidora.get_channel": { channel_id: env.ids.chId },
      "vidora.list_projects": { limit: 5 },
      "vidora.get_project": { project_id: env.ids.projId },
      "vidora.draft_script": {
        project_id: env.ids.projId,
        sections: [{ heading: "Intro", body: "Hello from the sandbox." }],
      },
      "vidora.request_publish": {
        project_id: env.ids.projId,
        privacy: "private",
        tags: ["e2e"],
      },
      "vidora.get_analytics": { channel_id: env.ids.chId },
      "vidora.list_learnings": { limit: 5 },
    };
    for (const def of MCP_TOOLS) {
      const { status, body } = await handleJsonRpc(
        deps,
        rpc("tools/call", { name: def.name, arguments: args[def.name] }),
      );
      expect(status, def.name).toBe(200);
      expect(isOk(body), def.name).toBe(true);
      if (isOk(body)) {
        const result = body.result as {
          ok: boolean;
          data?: unknown;
          provenance?: { provenance: string };
        };
        expect(result.ok, def.name).toBe(true);
        expect(result.provenance?.provenance, def.name).toMatch(
          /^(real|estimate|ai_analysis|fixture)$/,
        );
      }
    }
    // Every one of the 8 calls was audit-logged with ok=true.
    expect(env.auditLog.filter((e) => e.ok)).toHaveLength(8);
  });

  it("draft_script generate path works against the sandbox generator", async () => {
    const env = await makeEnv();
    const { status, body } = await handleJsonRpc(
      env.depsFor(env.fullKey),
      rpc("tools/call", {
        name: "vidora.draft_script",
        arguments: {
          project_id: env.ids.projId,
          generate: { topic: "sandbox topic", section_count: 2 },
        },
      }),
    );
    expect(status).toBe(200);
    expect(isOk(body)).toBe(true);
    if (isOk(body)) {
      const result = body.result as {
        ok: boolean;
        data: { status: string; estimated_credits: number; actual_credits: number };
        provenance: { provenance: string };
      };
      expect(result.ok).toBe(true);
      expect(result.data.status).toBe("draft");
      expect(result.data.estimated_credits).toBe(1);
      expect(result.provenance.provenance).toBe("ai_analysis");
    }
  });

  it("unknown tool → 404 JSON-RPC error (still authenticated first)", async () => {
    const env = await makeEnv();
    const { status, body } = await handleJsonRpc(
      env.depsFor(env.fullKey),
      rpc("tools/call", { name: "vidora.nope", arguments: {} }),
    );
    expect(status).toBe(404);
    expect((body as RpcErr).error.code).toBe(-32601);
    expect((body as RpcErr).error.message).toMatch(/vidora\.nope/);
  });

  it("unknown tool with an INVALID key → 401 (no free enumeration)", async () => {
    const env = await makeEnv();
    const { status } = await handleJsonRpc(
      env.depsFor("vdsk_" + "0".repeat(32)),
      rpc("tools/call", { name: "vidora.nope", arguments: {} }),
    );
    expect(status).toBe(401);
  });

  it("insufficient scope → 403 at the HTTP layer", async () => {
    const env = await makeEnv();
    // readOnlyKey has read:projects + read:analytics but not write:projects.
    const { status, body } = await handleJsonRpc(
      env.depsFor(env.readOnlyKey),
      rpc("tools/call", {
        name: "vidora.draft_script",
        arguments: {
          project_id: env.ids.projId,
          sections: [{ heading: "H", body: "B" }],
        },
      }),
    );
    expect(status).toBe(403);
    expect(((body as RpcErr).error.data as { error?: string }).error).toMatch(/write:projects/);
  });

  it("invalid arguments → 400 with invalid_arguments", async () => {
    const env = await makeEnv();
    const { status, body } = await handleJsonRpc(
      env.depsFor(env.fullKey),
      rpc("tools/call", { name: "vidora.draft_script", arguments: {} }),
    );
    expect(status).toBe(400);
    expect(isOk(body)).toBe(true);
    if (isOk(body)) {
      const result = body.result as { ok: boolean; error: { code: string } };
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("invalid_arguments");
    }
    // The failure was still audit-logged, with the error code.
    const failed = env.auditLog.filter((e) => !e.ok);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.errorCode).toBe("invalid_arguments");
  });

  it("429 rate limit: second call in the window is rejected with retry_after_ms", async () => {
    const env = await makeEnv();
    const deps = env.depsFor(env.tinyKey); // 1 req/min
    const first = await handleJsonRpc(deps, rpc("tools/list"));
    expect(first.status).toBe(200);
    expect(env.lastRateLimit.current?.limit).toBe(1);
    expect(env.lastRateLimit.current?.remaining).toBe(0);

    const second = await handleJsonRpc(deps, rpc("tools/list"));
    expect(second.status).toBe(429);
    const data = (second.body as RpcErr).error.data as { retry_after_ms?: number };
    expect(typeof data.retry_after_ms).toBe("number");
    expect(data.retry_after_ms).toBeGreaterThan(0);
    // D178: the 429 carries rate-limit state for X-RateLimit-* headers.
    expect(env.lastRateLimit.current?.limit).toBe(1);
    expect(env.lastRateLimit.current?.remaining).toBe(0);
    expect(env.lastRateLimit.current?.reset).toBeGreaterThan(Date.now() / 1000);
  });

  it("audit hook is invoked for every call, success and failure", async () => {
    const env = await makeEnv();
    const seen: AuditEntry[] = [];
    const deps = env.depsFor(env.fullKey, async (entry) => {
      seen.push({ tool: entry.tool, ok: entry.ok, errorCode: entry.errorCode });
    });
    await handleJsonRpc(deps, rpc("tools/call", { name: "vidora.list_projects", arguments: {} }));
    await handleJsonRpc(
      deps,
      rpc("tools/call", { name: "vidora.draft_script", arguments: { bogus: true } }),
    );
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ tool: "vidora.list_projects", ok: true });
    expect(seen[1]).toMatchObject({
      tool: "vidora.draft_script",
      ok: false,
      errorCode: "invalid_arguments",
    });
  });

  it("malformed envelopes are JSON-RPC errors", async () => {
    const env = await makeEnv();
    const deps = env.depsFor(env.fullKey);
    const bad = await handleJsonRpc(deps, { method: "tools/list" } as never);
    expect(bad.status).toBe(400);
    expect((bad.body as RpcErr).error.code).toBe(-32600);
    const unknown = await handleJsonRpc(deps, rpc("not/a/method"));
    expect(unknown.status).toBe(404);
    expect((unknown.body as RpcErr).error.code).toBe(-32601);
  });
});
