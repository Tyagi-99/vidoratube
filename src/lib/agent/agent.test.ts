/**
 * Phase 5 Stream A (F10) — Vidora Agent unit tests.
 *
 * No network calls: the LLM client, the MCP port, the credit preflight/debit,
 * and the store are all injected fakes. Covers the contract acceptance:
 *   - tool-calling loop against fake port + fake LLM
 *   - draft-only invariant (agent cannot produce approved/published rows)
 *   - preflight denial (no LLM call, honest envelope)
 *   - 6-iteration cap
 *   - unconfigured state (no fake reply)
 */
import { describe, expect, it } from "vitest";
import {
  AGENT_MAX_ITERATIONS,
  sendAgentMessage,
  type AgentConversation,
  type AgentDeps,
  type AgentMessage,
  type AgentStore,
  type AgentToolAuditEntry,
  type AgentToolCallRecord,
  type LlmChat,
  type LlmMessageIn,
  type LlmReply,
} from "./agent.server";
import type { McpDataPort } from "../mcp/server";
import type { PreflightResult } from "../credits/preflight.server";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

let idSeq = 0;
const nid = (p: string) => `${p}-${++idSeq}`;

class FakeStore implements AgentStore {
  conversations = new Map<string, AgentConversation>();
  messages = new Map<string, AgentMessage[]>(); // conversationId -> messages

  async getConversation(userId: string, conversationId: string) {
    const c = this.conversations.get(conversationId);
    return c && c.user_id === userId ? c : null;
  }
  async createConversation(userId: string, workspaceId: string, title: string) {
    const c: AgentConversation = {
      id: nid("conv"),
      user_id: userId,
      workspace_id: workspaceId,
      title,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.conversations.set(c.id, c);
    this.messages.set(c.id, []);
    return c;
  }
  async listConversations(userId: string, workspaceId: string, limit: number) {
    return [...this.conversations.values()]
      .filter((c) => c.user_id === userId && c.workspace_id === workspaceId)
      .slice(0, limit);
  }
  async listMessages(conversationId: string, limit: number) {
    return (this.messages.get(conversationId) ?? []).slice(-limit);
  }
  async insertMessage(input: {
    conversationId: string;
    role: AgentMessage["role"];
    content: string;
    toolCalls?: AgentToolCallRecord[] | undefined;
    provenance: AgentMessage["provenance"];
  }) {
    const m: AgentMessage = {
      id: nid("msg"),
      conversation_id: input.conversationId,
      role: input.role,
      content: input.content,
      tool_calls: input.toolCalls ?? [],
      provenance: input.provenance,
      created_at: new Date().toISOString(),
    };
    const arr = this.messages.get(input.conversationId) ?? [];
    arr.push(m);
    this.messages.set(input.conversationId, arr);
    return m;
  }
}

function makeFakePort(overrides: Partial<McpDataPort> = {}): McpDataPort & { calls: string[] } {
  const calls: string[] = [];
  const base: McpDataPort = {
    searchChannels: async () => [],
    getChannel: async () => null,
    listProjects: async () => [
      { id: "proj-1", title: "Project One", topic: "space", status: "draft", updated_at: "2026-09-28" },
      { id: "proj-2", title: "Project Two", topic: "oceans", status: "draft", updated_at: "2026-09-27" },
    ],
    getProject: async () => null,
    createDraftScript: async () => ({ script_id: "script-1", version_number: 1, status: "draft" as const }),
    generateScriptDraft: async () => ({
      ok: true as const,
      result: { script_id: "script-1", version_number: 1, status: "draft" as const, estimated_credits: 1, actual_credits: 1 },
      estimatedCredits: 1,
      actualCredits: 1,
    }),
    createDraftPublishJob: async () => ({ publish_job_id: "job-1", status: "draft" as const }),
    getChannelAnalytics: async () => null,
    listLearnings: async () => [],
  };
  const wrapped = {} as McpDataPort & { calls: string[] };
  for (const k of Object.keys(base) as (keyof McpDataPort)[]) {
    (wrapped as unknown as Record<string, unknown>)[k] = async (...args: unknown[]) => {
      calls.push(k);
      const fn = (overrides[k] ?? base[k]) as (...a: unknown[]) => Promise<unknown>;
      return fn(...args);
    };
  }
  wrapped.calls = calls;
  return wrapped;
}

class FakeLlm implements LlmChat {
  /** Scripted replies, consumed in order. */
  replies: LlmReply[];
  /** Every chat() invocation's input. */
  calls: { messages: LlmMessageIn[]; toolNames: string[] }[] = [];
  constructor(replies: LlmReply[]) {
    this.replies = [...replies];
  }
  async chat(messages: LlmMessageIn[], tools: { name: string }[]): Promise<LlmReply> {
    this.calls.push({ messages, toolNames: tools.map((t) => t.name) });
    const next = this.replies.shift();
    return next ?? { kind: "text", content: "Done. (default fake reply)" };
  }
}

const okPreflight: PreflightResult = {
  ok: true,
  estimate: {
    isEstimate: true,
    type: "estimate",
    credits: 2,
    breakdown: { lines: ["llm_chat (ESTIMATE)"] },
  },
  balance: 100,
  warnings: [],
};

function makeDeps(over: {
  store?: AgentStore;
  port?: McpDataPort;
  llm?: LlmChat;
  isConfigured?: () => boolean;
  preflight?: AgentDeps["preflight"];
  debitTurn?: AgentDeps["debitTurn"];
} = {}): AgentDeps & {
  store: FakeStore;
  port: McpDataPort & { calls: string[] };
  llm: FakeLlm;
  audits: AgentToolAuditEntry[];
  debits: { userId: string; ref: string; reason: string }[];
  preflightCalls: number;
} {
  const store = (over.store as FakeStore | undefined) ?? new FakeStore();
  const port = (over.port as (McpDataPort & { calls: string[] }) | undefined) ?? makeFakePort();
  const llm = (over.llm as FakeLlm | undefined) ?? new FakeLlm([]);
  const audits: AgentToolAuditEntry[] = [];
  const debits: { userId: string; ref: string; reason: string }[] = [];
  let preflightCalls = 0;
  const deps: AgentDeps = {
    admin: {} as never,
    store,
    port,
    llm,
    isConfigured: over.isConfigured ?? (() => true),
    preflight: over.preflight ?? (async () => { preflightCalls += 1; return okPreflight; }),
    debitTurn: over.debitTurn ?? (async (userId, ref, reason) => { debits.push({ userId, ref, reason }); }),
    audit: async (e) => { audits.push(e); },
  };
  return { ...deps, store, port, llm, audits, debits, get preflightCalls() { return preflightCalls; } };
}

const toolCall = (id: string, name: string, args: Record<string, unknown>): LlmReply => ({
  kind: "tool_calls",
  content: null,
  toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sendAgentMessage — tool-calling loop", () => {
  it("runs one tool call through the fake port, audits it, persists provenance correctly", async () => {
    const deps = makeDeps({
      llm: new FakeLlm([
        toolCall("tc-1", "vidora.list_projects", { limit: 5 }),
        { kind: "text", content: "You have 2 projects. Next step: draft a script (ESTIMATE: 1 credit)." },
      ]),
    });
    const res = await sendAgentMessage(deps, {
      userId: "u-1",
      workspaceId: "w-1",
      conversationId: null,
      text: "What projects do I have?",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    expect(res.iterations).toBe(2);
    expect(deps.port.calls).toEqual(["listProjects"]);

    // Audit: action agent.tool_call with tool name, ok, conversation_id.
    expect(deps.audits).toHaveLength(1);
    expect(deps.audits[0]).toMatchObject({ tool: "vidora.list_projects", ok: true, conversationId: res.conversationId });

    // Persistence: user message is real; tool summary is real; assistant is ai_analysis.
    const msgs = await deps.store.listMessages(res.conversationId, 50);
    expect(msgs.map((m) => [m.role, m.provenance])).toEqual([
      ["user", "real"],
      ["tool", "real"],
      ["assistant", "ai_analysis"],
    ]);
    const toolMsg = msgs[1]!;
    expect(toolMsg.tool_calls[0]).toMatchObject({ name: "vidora.list_projects", ok: true });
    expect(toolMsg.content).toContain("proj-1");

    // The LLM saw the system prompt with all 8 pinned tools and the history.
    const firstCall = deps.llm.calls[0]!;
    expect(firstCall.toolNames).toHaveLength(8);
    expect(firstCall.toolNames).toContain("vidora.draft_script");
    expect(firstCall.toolNames).toContain("vidora.request_publish");
    const system = firstCall.messages.find((m) => m.role === "system")!;
    expect(system.content).toContain("AI prepares, human approves");
    expect(system.content).toContain("DRAFTS ONLY");

    // Debit-first: one debit per LLM call, before the assistant message lands.
    expect(deps.debits).toHaveLength(2);
  });

  it("surfaces invalid tool arguments as a failed tool result, not a crash", async () => {
    const deps = makeDeps({
      llm: new FakeLlm([
        toolCall("tc-1", "vidora.get_channel", { channel_id: "not-a-uuid" }),
        { kind: "text", content: "That channel id was invalid — send me a real one. (AI analysis)" },
      ]),
    });
    const res = await sendAgentMessage(deps, {
      userId: "u-1", workspaceId: "w-1", conversationId: null, text: "Get channel xyz",
    });
    expect(res.ok).toBe(true);
    expect(deps.audits[0]).toMatchObject({ tool: "vidora.get_channel", ok: false, errorCode: "invalid_arguments" });
    const msgs = await deps.store.listMessages(res.ok ? res.conversationId : "", 50);
    expect(msgs[1]!.tool_calls[0]!.ok).toBe(false);
  });

  it("rejects unknown tool names from the model", async () => {
    const deps = makeDeps({
      llm: new FakeLlm([
        toolCall("tc-1", "vidora.publish_now", {}),
        { kind: "text", content: "I can't publish — I only create drafts. (AI analysis)" },
      ]),
    });
    const res = await sendAgentMessage(deps, { userId: "u-1", workspaceId: "w-1", conversationId: null, text: "publish it" });
    expect(res.ok).toBe(true);
    expect(deps.audits[0]).toMatchObject({ tool: "vidora.publish_now", ok: false, errorCode: "unknown_tool" });
  });
});

describe("draft-only invariant", () => {
  it("refuses when the port returns a non-draft publish job status", async () => {
    const evilPort = makeFakePort({
      // A buggy/malicious port that does not force 'draft'.
      createDraftPublishJob: async () => ({ publish_job_id: "job-9", status: "published" as "draft" }),
    });
    const deps = makeDeps({
      port: evilPort,
      llm: new FakeLlm([
        toolCall("tc-1", "vidora.request_publish", { project_id: "11111111-1111-4111-8111-111111111111" }),
      ]),
    });
    const res = await sendAgentMessage(deps, {
      userId: "u-1", workspaceId: "w-1", conversationId: null, text: "request publish",
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected failure");
    expect(res.code).toBe("invariant_violated");
    // No assistant message claiming success was persisted.
    const msgs = await deps.store.listMessages(res.conversationId!, 50);
    expect(msgs.every((m) => m.role !== "assistant")).toBe(true);
    expect(deps.audits[0]).toMatchObject({ ok: false, errorCode: "invariant_violated" });
  });

  it("refuses when the port returns a non-draft script status", async () => {
    const evilPort = makeFakePort({
      createDraftScript: async () => ({ script_id: "s-9", version_number: 1, status: "approved" as "draft" }),
    });
    const deps = makeDeps({
      port: evilPort,
      llm: new FakeLlm([
        toolCall("tc-1", "vidora.draft_script", {
          project_id: "11111111-1111-4111-8111-111111111111",
          sections: [{ heading: "H", body: "B" }],
        }),
      ]),
    });
    const res = await sendAgentMessage(deps, {
      userId: "u-1", workspaceId: "w-1", conversationId: null, text: "draft a script",
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected failure");
    expect(res.code).toBe("invariant_violated");
  });

  it("the 8 pinned tools are exactly the contract list — no approve/publish/schedule/spend path", async () => {
    const deps = makeDeps();
    const res = await sendAgentMessage(deps, {
      userId: "u-1", workspaceId: "w-1", conversationId: null, text: "hi",
    });
    expect(res.ok).toBe(true);
    expect(deps.llm.calls[0]!.toolNames).toEqual([
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
});

describe("credit preflight", () => {
  it("denied preflight -> honest envelope, no LLM call, user message kept", async () => {
    const denied: PreflightResult = {
      ok: false,
      code: "INSUFFICIENT_CREDITS",
      message: "Insufficient credits: this job needs ~2 credits (ESTIMATE) but the balance is 0.",
      estimate: { isEstimate: true, type: "estimate", credits: 2, breakdown: { lines: [] } } as never,
    };
    const llm = new FakeLlm([{ kind: "text", content: "should never be used" }]);
    const deps = makeDeps({ llm, preflight: async () => denied });
    const res = await sendAgentMessage(deps, {
      userId: "u-1", workspaceId: "w-1", conversationId: null, text: "hello",
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected failure");
    expect(res.code).toBe("INSUFFICIENT_CREDITS");
    expect(llm.calls).toHaveLength(0);
    expect(deps.debits).toHaveLength(0);
    // The user message is still persisted so the thread shows what was asked.
    const msgs = await deps.store.listMessages(res.conversationId!, 50);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ role: "user", provenance: "real" });
  });

  it("budget-exceeded denial also blocks the LLM call", async () => {
    const denied: PreflightResult = {
      ok: false,
      code: "BUDGET_EXCEEDED",
      message: "Workspace budget exceeded.",
      estimate: { isEstimate: true, type: "estimate", credits: 2, breakdown: { lines: [] } } as never,
    };
    const llm = new FakeLlm([]);
    const deps = makeDeps({ llm, preflight: async () => denied });
    const res = await sendAgentMessage(deps, {
      userId: "u-1", workspaceId: "w-1", conversationId: null, text: "hello",
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected failure");
    expect(res.code).toBe("BUDGET_EXCEEDED");
    expect(llm.calls).toHaveLength(0);
  });
});

describe("iteration cap", () => {
  it("stops after 6 LLM calls and ends the turn honestly", async () => {
    const replies: LlmReply[] = Array.from({ length: 10 }, (_, i) =>
      toolCall(`tc-${i}`, "vidora.list_projects", { limit: 1 }),
    );
    const deps = makeDeps({ llm: new FakeLlm(replies) });
    const res = await sendAgentMessage(deps, {
      userId: "u-1", workspaceId: "w-1", conversationId: null, text: "loop forever",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    expect(res.iterations).toBe(AGENT_MAX_ITERATIONS);
    expect(deps.llm.calls).toHaveLength(AGENT_MAX_ITERATIONS);
    expect(deps.port.calls).toHaveLength(AGENT_MAX_ITERATIONS);
    expect(res.message.content).toContain("tool-call steps");
    expect(res.message.provenance).toBe("ai_analysis");
  });
});

describe("unconfigured state", () => {
  it("returns unconfigured with no LLM call and no fake assistant reply", async () => {
    const llm = new FakeLlm([{ kind: "text", content: "fake reply must never appear" }]);
    const deps = makeDeps({ llm, isConfigured: () => false });
    const res = await sendAgentMessage(deps, {
      userId: "u-1", workspaceId: "w-1", conversationId: null, text: "hello",
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected failure");
    expect(res.code).toBe("unconfigured");
    expect(llm.calls).toHaveLength(0);
    const msgs = await deps.store.listMessages(res.conversationId!, 50);
    expect(msgs.map((m) => m.role)).toEqual(["user"]); // no assistant message
  });
});

describe("history", () => {
  it("loads at most the last 20 messages into the LLM context", async () => {
    const store = new FakeStore();
    const conv = await store.createConversation("u-1", "w-1", "long thread");
    for (let i = 0; i < 25; i++) {
      await store.insertMessage({
        conversationId: conv.id,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `message ${i}`,
        provenance: i % 2 === 0 ? "real" : "ai_analysis",
      });
    }
    const llm = new FakeLlm([{ kind: "text", content: "reply" }]);
    const deps = makeDeps({ store, llm });
    const res = await sendAgentMessage(deps, {
      userId: "u-1", workspaceId: "w-1", conversationId: conv.id, text: "continue",
    });
    expect(res.ok).toBe(true);
    const sent = llm.calls[0]!.messages;
    // 1 system + at most 20 history messages.
    expect(sent.length).toBeLessThanOrEqual(21);
    expect(sent[0]!.role).toBe("system");
  });

  it("empty text is rejected without touching the LLM", async () => {
    const llm = new FakeLlm([]);
    const deps = makeDeps({ llm });
    const res = await sendAgentMessage(deps, {
      userId: "u-1", workspaceId: "w-1", conversationId: null, text: "   ",
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected failure");
    expect(res.code).toBe("empty_message");
    expect(llm.calls).toHaveLength(0);
  });
});
