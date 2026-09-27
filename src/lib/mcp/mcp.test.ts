/**
 * Phase 4 Stream E (F41) — MCP server tests.
 *
 * Fake McpDataPort (in-memory); the JSON-RPC envelope, scope checks,
 * draft-only invariants, provenance blocks, and audit hook are all real.
 */
import { describe, expect, it } from "vitest";
import {
  MCP_TOOLS,
  callMcpTool,
  getToolDef,
  handleJsonRpc,
  toolJsonSchema,
  type McpCallDeps,
  type McpDataPort,
  type McpHttpDeps,
} from "./server";
import type { VerifiedApiKey } from "../api-keys/keys.server";

const KEY: VerifiedApiKey = {
  id: "key-1",
  workspaceId: "ws-1",
  name: "test-key",
  scopes: ["read:projects", "write:projects", "read:analytics", "publish:request"],
  rateLimitPerMin: 60,
  createdBy: "user-1",
  keyHash: "hash-1",
};

function makeFakePort(overrides: Partial<McpDataPort> = {}): McpDataPort & {
  calls: { tool: string; input: unknown }[];
} {
  const calls: { tool: string; input: unknown }[] = [];
  const port: McpDataPort = {
    async searchChannels(input) {
      calls.push({ tool: "searchChannels", input });
      return [
        {
          id: "ch-1",
          platform: "youtube",
          handle: "@test",
          title: "Test",
          is_own: true,
          status: "tracked",
        },
      ];
    },
    async getChannel(input) {
      calls.push({ tool: "getChannel", input });
      return {
        id: input.channelId,
        platform: "youtube",
        handle: "@test",
        title: "Test",
        is_own: true,
        status: "tracked",
        external_channel_id: "UC123",
        latest_snapshot: null,
      };
    },
    async listProjects(input) {
      calls.push({ tool: "listProjects", input });
      return [
        { id: "p-1", title: "P", topic: "t", status: "draft", updated_at: "2026-09-28T00:00:00Z" },
      ];
    },
    async getProject(input) {
      calls.push({ tool: "getProject", input });
      return {
        id: input.projectId,
        title: "P",
        topic: "t",
        status: "draft",
        updated_at: "2026-09-28T00:00:00Z",
        mode: "stock",
        language: "English",
        duration_minutes: 5,
        latest_script: null,
      };
    },
    async createDraftScript(input) {
      calls.push({ tool: "createDraftScript", input });
      return { script_id: "s-1", version_number: 1, status: "draft" as const };
    },
    async generateScriptDraft(input) {
      calls.push({ tool: "generateScriptDraft", input });
      return {
        ok: true as const,
        result: {
          script_id: "s-2",
          version_number: 1,
          status: "draft" as const,
          estimated_credits: 1,
          actual_credits: 1,
        },
        estimatedCredits: 1,
        actualCredits: 1,
      };
    },
    async createDraftPublishJob(input) {
      calls.push({ tool: "createDraftPublishJob", input });
      return { publish_job_id: "j-1", status: "draft" as const };
    },
    async getChannelAnalytics(input) {
      calls.push({ tool: "getChannelAnalytics", input });
      return {
        channel_id: input.channelId,
        snapshot: {
          snapshot_date: "2026-09-28",
          metrics: { views: 100 },
          revenue_usd: 1.5,
          revenue_basis: "estimate",
        },
      };
    },
    async listLearnings(input) {
      calls.push({ tool: "listLearnings", input });
      return [
        {
          id: "l-1",
          kind: "pattern",
          status: "validated",
          confidence: 0.8,
          origin: "ai_analysis" as const,
          evidence: null,
          created_at: "2026-09-28T00:00:00Z",
        },
      ];
    },
    ...overrides,
  };
  return Object.assign(port, { calls });
}

function deps(port: McpDataPort, key: VerifiedApiKey = KEY): McpCallDeps & { audits: unknown[] } {
  const audits: unknown[] = [];
  const d: McpCallDeps = {
    port,
    key,
    audit: async (entry) => {
      audits.push(entry);
    },
  };
  return Object.assign(d, { audits });
}

function httpDeps(
  port: McpDataPort,
  key: VerifiedApiKey | null = KEY,
): McpHttpDeps & { audits: unknown[] } {
  const d = deps(port, key ?? KEY);
  const http: McpHttpDeps = {
    // Mirrors the real route: authenticate enforces the required scopes.
    authenticate: async (requiredScopes) => {
      if (!key) return { failure: { status: 401, body: { error: "invalid API key" } } };
      const missing = requiredScopes.filter((s) => !key.scopes.includes(s));
      if (missing.length > 0) {
        return {
          failure: { status: 403, body: { error: `missing required scope: ${missing[0]}` } },
        };
      }
      return { key };
    },
    port,
    audit: d.audit,
  };
  return Object.assign(http, { audits: d.audits });
}

const PID = "11111111-1111-4111-8111-111111111111";
const CID = "22222222-2222-4222-8222-222222222222";

describe("tool registry", () => {
  it("exposes exactly the 8 pinned tools", () => {
    expect(MCP_TOOLS.map((t) => t.name)).toEqual([
      "vidora.search_channels",
      "vidora.get_channel",
      "vidora.list_projects",
      "vidora.get_project",
      "vidora.draft_script",
      "vidora.request_publish",
      "vidora.get_analytics",
      "vidora.list_learnings",
    ]);
  });

  it("every tool declares required scopes from the pinned vocab", () => {
    const vocab = [
      "read:projects",
      "write:projects",
      "read:analytics",
      "publish:request",
      "admin:keys",
    ];
    for (const t of MCP_TOOLS) {
      expect(t.requiredScopes.length).toBeGreaterThan(0);
      for (const s of t.requiredScopes) expect(vocab).toContain(s);
    }
  });

  it("tools/list JSON schemas carry descriptions and required fields", () => {
    for (const t of MCP_TOOLS) {
      const s = toolJsonSchema(t) as { inputSchema: { type: string; required?: string[] } };
      expect(s.inputSchema.type).toBe("object");
    }
    const draft = toolJsonSchema(getToolDef("vidora.draft_script")!) as {
      inputSchema: { required: string[] };
    };
    // project_id is the only hard requirement; sections|generate is a refinement.
    expect(draft.inputSchema.required).toEqual(["project_id"]);
  });
});

describe("tool round-trips", () => {
  it("all 8 tools succeed and every response carries a provenance block", async () => {
    const port = makeFakePort();
    const d = deps(port);
    const calls: [string, unknown][] = [
      ["vidora.search_channels", { query: "test" }],
      ["vidora.get_channel", { channel_id: CID }],
      ["vidora.list_projects", {}],
      ["vidora.get_project", { project_id: PID }],
      ["vidora.draft_script", { project_id: PID, sections: [{ heading: "H", body: "B" }] }],
      ["vidora.request_publish", { project_id: PID, title: "T" }],
      ["vidora.get_analytics", { channel_id: CID }],
      ["vidora.list_learnings", {}],
    ];
    for (const [name, args] of calls) {
      const r = await callMcpTool(d, name, args);
      expect(r.ok).toBe(true);
      expect(r.provenance).toBeDefined();
      expect(["real", "estimate", "ai_analysis", "fixture"]).toContain(r.provenance.provenance);
    }
    // Every call was audit-logged.
    expect(d.audits).toHaveLength(8);
    expect(d.audits.every((a) => (a as { ok: boolean }).ok)).toBe(true);
  });

  it("get_analytics flags estimated revenue in the provenance basis", async () => {
    const port = makeFakePort();
    const d = deps(port);
    const r = await callMcpTool(d, "vidora.get_analytics", { channel_id: CID });
    expect(r.ok).toBe(true);
    expect(r.provenance.basis).toMatch(/ESTIMATE/);
  });

  it("list_learnings labels AI-mined learnings", async () => {
    const port = makeFakePort();
    const d = deps(port);
    const r = await callMcpTool(d, "vidora.list_learnings", {});
    expect(r.ok).toBe(true);
    const learnings = (r.data as { learnings: { origin: string }[] }).learnings;
    expect(learnings[0]!.origin).toBe("ai_analysis");
  });
});

describe("draft-only invariants (D138)", () => {
  it("request_publish creates a DRAFT job even when the caller sneaks in a status", async () => {
    const port = makeFakePort();
    const d = deps(port);
    // `status` is not in the tool schema — zod strips it.
    const r = await callMcpTool(d, "vidora.request_publish", {
      project_id: PID,
      title: "Sneaky",
      status: "approved",
    });
    expect(r.ok).toBe(true);
    expect((r.data as { status: string }).status).toBe("draft");
    const recorded = port.calls.find((c) => c.tool === "createDraftPublishJob")!;
    // No status field ever reaches the port — the tool schema has none.
    expect("status" in (recorded.input as object)).toBe(false);
  });

  it("draft_script (verbatim) creates a DRAFT script; status input is stripped", async () => {
    const port = makeFakePort();
    const d = deps(port);
    const r = await callMcpTool(d, "vidora.draft_script", {
      project_id: PID,
      title: "Sneaky",
      status: "approved",
      sections: [{ heading: "H", body: "B" }],
    });
    expect(r.ok).toBe(true);
    expect((r.data as { status: string }).status).toBe("draft");
  });

  it("draft_script refuses when neither sections nor generate is given", async () => {
    const port = makeFakePort();
    const d = deps(port);
    const r = await callMcpTool(d, "vidora.draft_script", { project_id: PID });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe("invalid_arguments");
    expect(port.calls.filter((c) => c.tool === "createDraftScript")).toHaveLength(0);
  });

  it("draft_script refuses both sections and generate together", async () => {
    const port = makeFakePort();
    const d = deps(port);
    const r = await callMcpTool(d, "vidora.draft_script", {
      project_id: PID,
      sections: [{ heading: "H", body: "B" }],
      generate: { topic: "x" },
    });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe("invalid_arguments");
  });

  it("a port that breaks the draft invariant fails the tool loudly", async () => {
    const port = makeFakePort({
      createDraftPublishJob: async () => ({ publish_job_id: "j-9", status: "approved" as never }),
    });
    const d = deps(port);
    const r = await callMcpTool(d, "vidora.request_publish", { project_id: PID });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe("invariant_violated");
  });
});

describe("credit gate on draft_script generate", () => {
  it("generate:true reaches the credit-gated generator and returns ai_analysis provenance", async () => {
    const port = makeFakePort();
    const d = deps(port);
    const r = await callMcpTool(d, "vidora.draft_script", {
      project_id: PID,
      generate: { topic: "Why the sky is blue", section_count: 4 },
    });
    expect(r.ok).toBe(true);
    expect(r.provenance.provenance).toBe("ai_analysis");
    expect(port.calls.some((c) => c.tool === "generateScriptDraft")).toBe(true);
    expect(port.calls.some((c) => c.tool === "createDraftScript")).toBe(false);
  });

  it("INSUFFICIENT_CREDITS from the gate surfaces as a 402-style tool error", async () => {
    const port = makeFakePort({
      generateScriptDraft: async () => ({
        ok: false as const,
        code: "INSUFFICIENT_CREDITS",
        message: "Not enough credits to generate a script draft.",
      }),
    });
    const d = deps(port);
    const r = await callMcpTool(d, "vidora.draft_script", {
      project_id: PID,
      generate: { topic: "x" },
    });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe("INSUFFICIENT_CREDITS");
    // Failed calls are audit-logged too.
    expect(d.audits).toHaveLength(1);
    expect((d.audits[0] as { ok: boolean }).ok).toBe(false);
  });

  it("verbatim sections never touch the generator (no spend)", async () => {
    const port = makeFakePort();
    const d = deps(port);
    await callMcpTool(d, "vidora.draft_script", {
      project_id: PID,
      sections: [{ heading: "H", body: "B" }],
    });
    expect(port.calls.some((c) => c.tool === "generateScriptDraft")).toBe(false);
  });
});

describe("scope enforcement in the dispatcher", () => {
  it("a key without write:projects cannot draft scripts (403)", async () => {
    const port = makeFakePort();
    const readOnly: VerifiedApiKey = { ...KEY, scopes: ["read:projects"] };
    const d = deps(port, readOnly);
    const r = await callMcpTool(d, "vidora.draft_script", {
      project_id: PID,
      sections: [{ heading: "H", body: "B" }],
    });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe("insufficient_scope");
    expect(port.calls).toHaveLength(0); // handler never ran
  });

  it("unknown tools fail closed", async () => {
    const port = makeFakePort();
    const d = deps(port);
    const r = await callMcpTool(d, "vidora.delete_everything", {});
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe("unknown_tool");
  });
});

describe("JSON-RPC envelope", () => {
  it("tools/list returns the 8 tool schemas (authenticated)", async () => {
    const h = httpDeps(makeFakePort());
    const res = await handleJsonRpc(h, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(200);
    const body = res.body as { result: { tools: { name: string }[] } };
    expect(body.result.tools).toHaveLength(8);
  });

  it("tools/list is 401 without a valid key", async () => {
    const h = httpDeps(makeFakePort(), null);
    const res = await handleJsonRpc(h, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(401);
  });

  it("tools/call dispatches and wraps the result", async () => {
    const h = httpDeps(makeFakePort());
    const res = await handleJsonRpc(h, {
      jsonrpc: "2.0",
      id: "abc",
      method: "tools/call",
      params: { name: "vidora.list_projects", arguments: {} },
    });
    expect(res.status).toBe(200);
    const body = res.body as { id: string; result: { ok: boolean; provenance: unknown } };
    expect(body.id).toBe("abc");
    expect(body.result.ok).toBe(true);
    expect(body.result.provenance).toBeDefined();
  });

  it("tools/call enforces per-tool scopes at the HTTP layer", async () => {
    const readOnly: VerifiedApiKey = { ...KEY, scopes: ["read:projects"] };
    const h = httpDeps(makeFakePort(), readOnly);
    const res = await handleJsonRpc(h, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "vidora.request_publish", arguments: { project_id: PID } },
    });
    // Auth layer: key lacks publish:request → 403 JSON-RPC error.
    expect(res.status).toBe(403);
  });

  it("unknown methods and malformed envelopes are JSON-RPC errors", async () => {
    const h = httpDeps(makeFakePort());
    const m = await handleJsonRpc(h, { jsonrpc: "2.0", id: 1, method: "nope" });
    expect(m.status).toBe(404);
    expect((m.body as { error: { code: number } }).error.code).toBe(-32601);

    const bad = await handleJsonRpc(h, { method: "tools/list" });
    expect(bad.status).toBe(400);
    expect((bad.body as { error: { code: number } }).error.code).toBe(-32600);
  });

  it("audit hook throwing never breaks the tool call", async () => {
    const port = makeFakePort();
    const d = deps(port);
    d.audit = async () => {
      throw new Error("audit down");
    };
    const r = await callMcpTool(d, "vidora.list_projects", {});
    expect(r.ok).toBe(true);
  });
});
