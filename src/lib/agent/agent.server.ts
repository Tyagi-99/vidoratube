/**
 * Phase 5 Stream A (F10) — Vidora Agent: server-only agent loop.
 *
 * `sendAgentMessage(userId, workspaceId, conversationId, text)` runs one
 * assistant turn:
 *   1. Loads the last N=20 persisted messages as history.
 *   2. Runs the credit preflight gate (jobType "llm_chat", provider
 *      "lovable-ai") before EVERY LLM call. Denied -> honest
 *      INSUFFICIENT_CREDITS / BUDGET_EXCEEDED envelope, no LLM call.
 *   3. Calls the Lovable AI gateway with a system prompt built from the 8
 *      pinned MCP tool definitions (reused from `../mcp/server`, never
 *      copied).
 *   4. Tool-calling loop, max 6 iterations. Each tool call executes through
 *      the Supabase MCP port directly (`McpDataPort` methods — no duplicated
 *      tool logic) and is audit-logged with action "agent.tool_call".
 *
 * DRAFT-ONLY INVARIANT: the agent may create draft scripts
 * (`vidora.draft_script`) and draft publish jobs (`vidora.request_publish`)
 * only. Both tools hardcode status 'draft' in the port; this module asserts
 * the returned status and refuses to continue on any other value. There is
 * no code path here that approves, publishes, schedules, or spends beyond
 * the existing gates. "AI prepares, human approves."
 *
 * Every assistant message is persisted with provenance "ai_analysis";
 * tool-result summaries derived from real rows carry provenance "real".
 * When LOVABLE_API_KEY is missing the module returns an honest
 * `unconfigured` envelope — never a fake reply.
 *
 * Testability: the LLM chat client, the credit preflight/debit, the store,
 * the port, the configured check, and the audit sink are all injected via
 * `AgentDeps`. Unit tests inject fakes; no network calls in tests.
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  getToolDef,
  toolJsonSchema,
  MCP_TOOLS,
  type McpDataPort,
} from "../mcp/server";
import type { PreflightInput, PreflightResult } from "../credits/preflight.server";
import type { UntypedDb } from "../supabase/untyped";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max tool-calling iterations per sendAgentMessage turn (contract §2). */
export const AGENT_MAX_ITERATIONS = 6;
/** Conversation history window loaded for each turn (contract §2). */
export const AGENT_HISTORY_LIMIT = 20;

/** The 8 pinned tool names — the agent knows exactly these, nothing more. */
export const AGENT_TOOL_NAMES = MCP_TOOLS.map((t) => t.name);

const AGENT_MODEL = "google/gemini-3.5-flash";
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
/** Rough output budget (tokens) used for the pre-turn cost ESTIMATE. */
const ESTIMATED_OUTPUT_TOKENS = 800;
/** Max chars of a tool result forwarded into the LLM context. */
const MAX_TOOL_RESULT_CHARS = 6000;

// ---------------------------------------------------------------------------
// Message / conversation shapes (mirror supabase/migrations/20260928050000)
// ---------------------------------------------------------------------------

export type AgentRole = "user" | "assistant" | "tool";
export type AgentProvenance = "real" | "estimate" | "ai_analysis" | "fixture";

export interface AgentConversation {
  id: string;
  user_id: string;
  workspace_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
}

/** JSON-safe value for persisted tool-call arguments (server-fn serializable). */
export type AgentJson =
  | string
  | number
  | boolean
  | null
  | AgentJson[]
  | { [key: string]: AgentJson };

export interface AgentToolCallRecord {
  id: string;
  name: string;
  arguments: Record<string, AgentJson>;
  ok: boolean;
  error_code?: string | undefined;
  /** Truncated JSON summary of the tool result, for history replay. */
  result_summary: string;
}

export interface AgentMessage {
  id: string;
  conversation_id: string;
  role: AgentRole;
  content: string;
  tool_calls: AgentToolCallRecord[];
  provenance: AgentProvenance;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Store (Supabase in production, in-memory fake in tests)
// ---------------------------------------------------------------------------

export interface AgentStore {
  getConversation(
    userId: string,
    conversationId: string,
  ): Promise<AgentConversation | null>;
  createConversation(
    userId: string,
    workspaceId: string,
    title: string,
  ): Promise<AgentConversation>;
  listConversations(
    userId: string,
    workspaceId: string,
    limit: number,
  ): Promise<AgentConversation[]>;
  listMessages(conversationId: string, limit: number): Promise<AgentMessage[]>;
  insertMessage(input: {
    conversationId: string;
    role: AgentRole;
    content: string;
    toolCalls?: AgentToolCallRecord[] | undefined;
    provenance: AgentProvenance;
  }): Promise<AgentMessage>;
}

type Row = Record<string, unknown>;

function toConversation(r: Row): AgentConversation {
  return {
    id: String(r["id"]),
    user_id: String(r["user_id"]),
    workspace_id: typeof r["workspace_id"] === "string" ? r["workspace_id"] : null,
    title: typeof r["title"] === "string" ? r["title"] : "New conversation",
    created_at: String(r["created_at"] ?? ""),
    updated_at: String(r["updated_at"] ?? ""),
  };
}

function toMessage(r: Row): AgentMessage {
  const role = r["role"];
  const provenance = r["provenance"];
  return {
    id: String(r["id"]),
    conversation_id: String(r["conversation_id"]),
    role: role === "user" || role === "assistant" || role === "tool" ? role : "assistant",
    content: typeof r["content"] === "string" ? r["content"] : "",
    tool_calls: Array.isArray(r["tool_calls"])
      ? (r["tool_calls"] as AgentToolCallRecord[])
      : [],
    provenance:
      provenance === "real" ||
      provenance === "estimate" ||
      provenance === "ai_analysis" ||
      provenance === "fixture"
        ? provenance
        : "ai_analysis",
    created_at: String(r["created_at"] ?? ""),
  };
}

export function makeSupabaseAgentStore(admin: SupabaseClient<Database>): AgentStore {
  // The agent tables are new in 20260928050000_p5_agent.sql and not in the
  // generated Database types, so this goes through the structural
  // UntypedDb surface (same approach as ../mcp/port.supabase.ts).
  const db: UntypedDb = admin as unknown as UntypedDb;
  return {
    async getConversation(userId, conversationId) {
      const { data, error } = await db
        .from("agent_conversations")
        .select("*")
        .eq("id", conversationId)
        .eq("user_id", userId)
        .limit(1);
      if (error) throw new Error(`Agent store error: ${error.message}`);
      const row = (data ?? [])[0];
      return row ? toConversation(row) : null;
    },
    async createConversation(userId, workspaceId, title) {
      const { data, error } = await db
        .from("agent_conversations")
        .insert({ user_id: userId, workspace_id: workspaceId, title })
        .select("*")
        .single();
      if (error) throw new Error(`Agent store error: ${error.message}`);
      return toConversation(data);
    },
    async listConversations(userId, workspaceId, limit) {
      const { data, error } = await db
        .from("agent_conversations")
        .select("*")
        .eq("user_id", userId)
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(`Agent store error: ${error.message}`);
      return (data ?? []).map(toConversation);
    },
    async listMessages(conversationId, limit) {
      const { data, error } = await db
        .from("agent_messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error) throw new Error(`Agent store error: ${error.message}`);
      return (data ?? []).map(toMessage);
    },
    async insertMessage(input) {
      const { data, error } = await db
        .from("agent_messages")
        .insert({
          conversation_id: input.conversationId,
          role: input.role,
          content: input.content,
          tool_calls: input.toolCalls ?? [],
          provenance: input.provenance,
        })
        .select("*")
        .single();
      if (error) throw new Error(`Agent store error: ${error.message}`);
      return toMessage(data);
    },
  };
}

// ---------------------------------------------------------------------------
// LLM chat client (Lovable AI gateway; fake in tests)
// ---------------------------------------------------------------------------

export interface LlmAssistantToolCall {
  id: string;
  name: string;
  /** JSON-encoded arguments. */
  arguments: string;
}

export interface LlmMessageIn {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: LlmAssistantToolCall[] | undefined;
  toolCallId?: string | undefined;
}

export interface LlmFunctionTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type LlmReply =
  | { kind: "text"; content: string }
  | { kind: "tool_calls"; content: string | null; toolCalls: LlmAssistantToolCall[] };

export interface LlmChat {
  chat(messages: LlmMessageIn[], tools: LlmFunctionTool[]): Promise<LlmReply>;
}

/**
 * Production gateway client. Reads LOVABLE_API_KEY at call time; throws a
 * typed error when it is missing so callers can render the honest
 * `unconfigured` state. Never used in tests (inject a fake LlmChat).
 */
export function makeGatewayLlmChat(): LlmChat {
  return {
    async chat(messages, tools) {
      const apiKey = process.env["LOVABLE_API_KEY"];
      if (!apiKey) {
        const e = new Error("LOVABLE_API_KEY is not configured") as Error & { code: string };
        e.code = "unconfigured";
        throw e;
      }
      const wireMessages = messages.map((m) => {
        if (m.role === "assistant" && m.toolCalls?.length) {
          return {
            role: "assistant",
            content: m.content,
            tool_calls: m.toolCalls.map((t) => ({
              id: t.id,
              type: "function",
              function: { name: t.name, arguments: t.arguments },
            })),
          };
        }
        if (m.role === "tool") {
          return { role: "tool", tool_call_id: m.toolCallId ?? "", content: m.content };
        }
        return { role: m.role, content: m.content };
      });
      let res: Response;
      try {
        res = await fetch(GATEWAY_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: AGENT_MODEL,
            messages: wireMessages,
            tools: tools.map((t) => ({
              type: "function",
              function: { name: t.name, description: t.description, parameters: t.inputSchema },
            })),
            tool_choice: "auto",
            temperature: 0.4,
          }),
        });
      } catch (e) {
        const err = new Error(
          e instanceof Error ? e.message : "AI request failed",
        ) as Error & { code: string };
        err.code = "network_error";
        throw err;
      }
      if (!res.ok) {
        const err = new Error(`AI request failed (${res.status})`) as Error & { code: string };
        err.code = "provider_error";
        throw err;
      }
      const json = (await res.json()) as {
        choices?: {
          message?: {
            content?: string | null;
            tool_calls?: { id: string; function?: { name?: string; arguments?: string } }[];
          };
        }[];
      };
      const msg = json.choices?.[0]?.message;
      const toolCalls = (msg?.tool_calls ?? [])
        .filter((t) => typeof t.function?.name === "string")
        .map((t) => ({
          id: t.id,
          name: t.function!.name as string,
          arguments: t.function?.arguments ?? "{}",
        }));
      if (toolCalls.length > 0) {
        return { kind: "tool_calls", content: msg?.content ?? null, toolCalls };
      }
      return { kind: "text", content: msg?.content ?? "" };
    },
  };
}

// ---------------------------------------------------------------------------
// Agent dependencies (everything effectful is injected)
// ---------------------------------------------------------------------------

export interface AgentToolAuditEntry {
  tool: string;
  ok: boolean;
  errorCode?: string | undefined;
  conversationId: string;
}

export interface AgentDeps {
  admin: SupabaseClient<Database>;
  store: AgentStore;
  port: McpDataPort;
  llm: LlmChat;
  /** False when LOVABLE_API_KEY is missing (honest unconfigured state). */
  isConfigured: () => boolean;
  preflight: (input: PreflightInput) => Promise<PreflightResult>;
  /** Debit for one LLM turn; idempotent per ref. */
  debitTurn: (userId: string, ref: string, reason: string) => Promise<void>;
  /** Audit sink — must never throw. */
  audit: (entry: AgentToolAuditEntry) => Promise<void>;
}

/** Production wiring: real preflight + real 1-credit debit per LLM turn. */
export function makeProductionCreditHooks(admin: SupabaseClient<Database>): {
  preflight: AgentDeps["preflight"];
  debitTurn: AgentDeps["debitTurn"];
} {
  return {
    preflight: (input) =>
      import("../credits/preflight.server").then((m) => m.preflightCreditsCheck(admin, input)),
    debitTurn: async (userId, ref, reason) => {
      const { debitOneCreditForProject, OUT_OF_CREDITS_MESSAGE } = await import("../credits");
      try {
        await debitOneCreditForProject(admin, userId, ref, reason);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Credit debit failed";
        const err = new Error(msg) as Error & { code: string };
        err.code = msg === OUT_OF_CREDITS_MESSAGE ? "INSUFFICIENT_CREDITS" : "DEBIT_FAILED";
        throw err;
      }
    },
  };
}

/** Production wiring: audit every agent tool call via audit_logs. */
export function makeProductionAudit(
  admin: SupabaseClient<Database>,
  userId: string,
  workspaceId: string,
): AgentDeps["audit"] {
  return async (entry) => {
    const { auditApiCall } = await import("../api-keys/keys.server");
    const metadata: Record<string, unknown> = {
      tool: entry.tool,
      ok: entry.ok,
      conversation_id: entry.conversationId,
    };
    if (entry.errorCode !== undefined) metadata["error_code"] = entry.errorCode;
    await auditApiCall(
      {
        workspaceId,
        actorUserId: userId,
        action: "agent.tool_call",
        entityType: "agent_conversation",
        entityId: entry.conversationId,
        metadata,
      },
      admin as never,
    );
  };
}

// ---------------------------------------------------------------------------
// System prompt (built from the pinned MCP tool definitions)
// ---------------------------------------------------------------------------

export function buildSystemPrompt(): string {
  const toolDocs = MCP_TOOLS.map((t) => {
    const schema = toolJsonSchema(t);
    return `- ${t.name}: ${t.description}\n  inputSchema: ${JSON.stringify(schema["inputSchema"])}`;
  }).join("\n");
  return [
    "You are the Vidora Agent, an AI assistant inside the VidoraTube app.",
    "CORE PRINCIPLE: AI prepares, human approves.",
    "",
    "WHAT YOU CAN DO — exactly these 8 tools, nothing else:",
    toolDocs,
    "",
    "HARD RULES:",
    "1. You create DRAFTS ONLY. vidora.draft_script always creates a draft script;",
    "   vidora.request_publish always creates a draft publish job. You can NEVER",
    "   approve, publish, schedule, upload, or spend beyond these draft creations.",
    "   Publishing requires a human approval through the publish pipeline.",
    "2. Never invent data. Every factual claim (channels, projects, metrics,",
    "   scripts, learnings) must come from a tool result. If you have no tool",
    "   result for something, say so plainly instead of guessing.",
    "3. When a tool result carries provenance notes (e.g. revenue_usd is an",
    "   ESTIMATE unless revenue_basis is 'measured'), repeat that qualification",
    "   to the user. Never present estimates as measured facts.",
    "4. All credit costs you mention are ESTIMATES, never exact charges.",
    "5. Your final answer MUST end with one concrete next step that creates a",
    "   DRAFT (a draft script via vidora.draft_script, a draft publish job via",
    "   vidora.request_publish, or a new project row) and show its real cost",
    "   as an ESTIMATE in credits. If the user has not picked a target yet,",
    "   end with the single most useful draft you could create once they do.",
    "6. If a tool call fails, say what failed and what the user can do instead.",
    "   Never pretend a failed call succeeded.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Tool execution through the Supabase MCP port
// ---------------------------------------------------------------------------

export class AgentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentError";
  }
}

function assertDraftStatus(status: unknown, what: string): asserts status is "draft" {
  if (status !== "draft") {
    // Bug, not user error: the port must force 'draft' on these tools.
    throw new AgentError(
      "invariant_violated",
      `${what} was not created as a draft — refusing to continue`,
    );
  }
}

interface ExecutedTool {
  ok: boolean;
  data?: unknown;
  code?: string;
  message?: string;
}

async function executeAgentTool(
  port: McpDataPort,
  userId: string,
  workspaceId: string,
  name: string,
  rawArgs: unknown,
): Promise<ExecutedTool> {
  const def = getToolDef(name);
  if (!def || !AGENT_TOOL_NAMES.includes(name)) {
    return { ok: false, code: "unknown_tool", message: `Unknown tool: ${String(name)}` };
  }
  const parsed = def.argsSchema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      code: "invalid_arguments",
      message: `Invalid arguments for ${name}: ${first ? `${first.path.join(".")}: ${first.message}` : "validation failed"}`,
    };
  }
  const args = parsed.data as unknown as Record<string, AgentJson>;
  try {
    switch (name) {
      case "vidora.search_channels": {
        const a = args as { query: string; limit: number };
        const channels = await port.searchChannels({ userId, workspaceId, query: a.query, limit: a.limit });
        return { ok: true, data: { channels } };
      }
      case "vidora.get_channel": {
        const a = args as { channel_id: string };
        const channel = await port.getChannel({ userId, workspaceId, channelId: a.channel_id });
        if (!channel) return { ok: false, code: "channel_not_found", message: "Channel not found" };
        return { ok: true, data: { channel } };
      }
      case "vidora.list_projects": {
        const a = args as { limit: number };
        const projects = await port.listProjects({ userId, limit: a.limit });
        return { ok: true, data: { projects } };
      }
      case "vidora.get_project": {
        const a = args as { project_id: string };
        const project = await port.getProject({ userId, projectId: a.project_id });
        if (!project) return { ok: false, code: "project_not_found", message: "Project not found" };
        return { ok: true, data: { project } };
      }
      case "vidora.draft_script": {
        const a = args as {
          project_id: string;
          title?: string;
          sections?: { heading: string; body: string }[];
          generate?: { topic: string; section_count: number };
        };
        if (a.sections) {
          const result = await port.createDraftScript({
            userId,
            projectId: a.project_id,
            title: a.title?.trim() || "Untitled script",
            sections: a.sections,
          });
          assertDraftStatus(result.status, "script");
          return {
            ok: true,
            data: { script_id: result.script_id, version_number: result.version_number, status: "draft" },
          };
        }
        const gen = await port.generateScriptDraft({
          userId,
          projectId: a.project_id,
          topic: a.generate!.topic,
          sectionCount: a.generate!.section_count,
        });
        if (!gen.ok) {
          return { ok: false, code: gen.code, message: gen.message };
        }
        assertDraftStatus(gen.result.status, "script");
        return {
          ok: true,
          data: {
            script_id: gen.result.script_id,
            version_number: gen.result.version_number,
            status: "draft",
            estimated_credits: gen.estimatedCredits,
            actual_credits: gen.actualCredits,
          },
        };
      }
      case "vidora.request_publish": {
        const a = args as {
          project_id: string;
          title?: string;
          description?: string;
          tags: string[];
          privacy: "private" | "unlisted" | "public";
          scheduled_for?: string;
        };
        const result = await port.createDraftPublishJob({
          userId,
          workspaceId,
          projectId: a.project_id,
          title: a.title?.trim() || null,
          description: a.description?.trim() || null,
          tags: a.tags,
          privacy: a.privacy,
          scheduledFor: a.scheduled_for ?? null,
        });
        assertDraftStatus(result.status, "publish job");
        return { ok: true, data: { publish_job_id: result.publish_job_id, status: "draft" } };
      }
      case "vidora.get_analytics": {
        const a = args as { channel_id: string };
        const analytics = await port.getChannelAnalytics({ userId, workspaceId, channelId: a.channel_id });
        if (!analytics) return { ok: false, code: "channel_not_found", message: "Channel not found" };
        return { ok: true, data: analytics };
      }
      case "vidora.list_learnings": {
        const a = args as { status?: "proposed" | "validated" | "refuted" | "archived"; limit: number };
        const learnings = await port.listLearnings({ userId, status: a.status ?? null, limit: a.limit });
        return { ok: true, data: { learnings } };
      }
      default:
        return { ok: false, code: "unknown_tool", message: `Unknown tool: ${name}` };
    }
  } catch (e) {
    if (e instanceof AgentError) throw e;
    const code = (e as { code?: string } | null)?.code;
    return {
      ok: false,
      code: typeof code === "string" ? code : "tool_error",
      message: e instanceof Error ? e.message : "Tool call failed",
    };
  }
}

// ---------------------------------------------------------------------------
// History -> LLM messages
// ---------------------------------------------------------------------------

function historyToLlmMessages(history: AgentMessage[]): LlmMessageIn[] {
  const out: LlmMessageIn[] = [];
  for (const m of history) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const withCalls = m.tool_calls.filter((t) => t.id && t.name);
      out.push({
        role: "assistant",
        content: m.content,
        toolCalls: withCalls.length
          ? withCalls.map((t) => ({ id: t.id, name: t.name, arguments: JSON.stringify(t.arguments) }))
          : undefined,
      });
    } else {
      for (const t of m.tool_calls) {
        out.push({ role: "tool", content: t.result_summary, toolCallId: t.id });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// sendAgentMessage
// ---------------------------------------------------------------------------

export interface SendAgentMessageInput {
  userId: string;
  workspaceId: string;
  conversationId: string | null;
  text: string;
}

export type AgentTurnResult =
  | {
      ok: true;
      conversationId: string;
      message: AgentMessage;
      /** LLM calls made this turn (each preflighted + debited). */
      iterations: number;
      /** ESTIMATE in credits for the turn's LLM usage (from preflight). */
      estimatedCredits: number | null;
      warnings: string[];
    }
  | {
      ok: false;
      code:
        | "empty_message"
        | "not_found"
        | "unconfigured"
        | "INSUFFICIENT_CREDITS"
        | "BUDGET_EXCEEDED"
        | "UNKNOWN_COST"
        | "DEBIT_FAILED"
        | "network_error"
        | "provider_error"
        | "invariant_violated";
      message: string;
      conversationId: string | null;
    };

function estimateInputTokens(messages: LlmMessageIn[]): number {
  const chars = messages.reduce((n, m) => n + m.content.length + (m.toolCalls?.length ?? 0) * 200, 0);
  return Math.max(1, Math.ceil(chars / 4));
}

function summarizeToolResult(name: string, result: ExecutedTool): string {
  const payload = result.ok
    ? { ok: true as const, data: result.data }
    : { ok: false as const, code: result.code, message: result.message };
  const json = JSON.stringify(payload);
  const truncated = json.length > MAX_TOOL_RESULT_CHARS;
  return (
    `[tool ${name} result${truncated ? " (truncated)" : ""}]\n` +
    (truncated ? json.slice(0, MAX_TOOL_RESULT_CHARS) : json)
  );
}

function newTitle(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 60 ? `${t.slice(0, 57)}…` : t || "New conversation";
}

export async function sendAgentMessage(
  deps: AgentDeps,
  input: SendAgentMessageInput,
): Promise<AgentTurnResult> {
  const { store, port, llm } = deps;
  const text = input.text.trim();
  if (!text) {
    return { ok: false, code: "empty_message", message: "Message is empty.", conversationId: input.conversationId };
  }

  // Load or create the conversation (owner-only: must belong to this user).
  let conversation: AgentConversation | null = null;
  if (input.conversationId) {
    conversation = await store.getConversation(input.userId, input.conversationId);
    if (!conversation) {
      return { ok: false, code: "not_found", message: "Conversation not found.", conversationId: null };
    }
  } else {
    conversation = await store.createConversation(input.userId, input.workspaceId, newTitle(text));
  }
  const conversationId = conversation.id;

  // Persist the user message (provenance "real" — it is the user's own text).
  await store.insertMessage({
    conversationId,
    role: "user",
    content: text,
    provenance: "real",
  });

  // Honest unconfigured state: never a fake reply.
  if (!deps.isConfigured()) {
    return {
      ok: false,
      code: "unconfigured",
      message:
        "The AI agent is not configured (LOVABLE_API_KEY is missing). Ask the workspace owner to connect AI, or continue from the dashboard — no message was generated.",
      conversationId,
    };
  }

  const system = buildSystemPrompt();
  const history = await store.listMessages(conversationId, AGENT_HISTORY_LIMIT);
  const tools: LlmFunctionTool[] = MCP_TOOLS.map((t) => {
    const schema = toolJsonSchema(t);
    return {
      name: t.name,
      description: t.description,
      inputSchema: (schema["inputSchema"] ?? {}) as Record<string, unknown>,
    };
  });

  const llmMessages: LlmMessageIn[] = [
    { role: "system", content: system },
    ...historyToLlmMessages(history),
  ];

  let iterations = 0;
  let estimatedCredits: number | null = null;
  const warnings: string[] = [];

  for (let i = 0; i < AGENT_MAX_ITERATIONS; i++) {
    // Credit preflight per LLM turn (contract §2): denied -> honest envelope,
    // no LLM call. The estimate is labeled ESTIMATE everywhere it surfaces.
    const preflight = await deps.preflight({
      userId: input.userId,
      workspaceId: input.workspaceId,
      jobType: "llm_chat",
      provider: "lovable-ai",
      tokens: { input: estimateInputTokens(llmMessages), output: ESTIMATED_OUTPUT_TOKENS },
    });
    if (!preflight.ok) {
      return {
        ok: false,
        code: preflight.code,
        message: preflight.message,
        conversationId,
      };
    }
    estimatedCredits = preflight.estimate.credits;
    for (const w of preflight.warnings) warnings.push(w);

    let reply: LlmReply;
    try {
      reply = await llm.chat(llmMessages, tools);
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      if (code === "unconfigured") {
        return {
          ok: false,
          code: "unconfigured",
          message: "The AI agent lost its configuration mid-turn (LOVABLE_API_KEY). No reply was generated.",
          conversationId,
        };
      }
      return {
        ok: false,
        code: code === "network_error" ? "network_error" : "provider_error",
        message: e instanceof Error ? e.message : "AI request failed",
        conversationId,
      };
    }
    iterations += 1;

    // Debit-first (mirrors generateScriptDraft): the debit lands before the
    // assistant message is persisted; a failed debit ends the turn honestly.
    try {
      await deps.debitTurn(input.userId, randomUUID(), "agent chat turn");
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      return {
        ok: false,
        code: code === "INSUFFICIENT_CREDITS" ? "INSUFFICIENT_CREDITS" : "DEBIT_FAILED",
        message: e instanceof Error ? e.message : "Credit debit failed",
        conversationId,
      };
    }

    if (reply.kind === "text") {
      const message = await store.insertMessage({
        conversationId,
        role: "assistant",
        content: reply.content || "(The AI returned an empty reply.)",
        provenance: "ai_analysis",
      });
      return { ok: true, conversationId, message, iterations, estimatedCredits, warnings };
    }

    // Tool-calling turn: execute each call through the port, audit it, and
    // persist a tool-role summary (provenance "real" — real rows).
    const assistantToolCalls: AgentToolCallRecord[] = [];
    for (const tc of reply.toolCalls) {
      let parsedArgs: unknown = {};
      try {
        parsedArgs = tc.arguments ? JSON.parse(tc.arguments) : {};
      } catch {
        parsedArgs = {};
      }
      let executed: ExecutedTool;
      try {
        executed = await executeAgentTool(port, input.userId, input.workspaceId, tc.name, parsedArgs);
      } catch (e) {
        // invariant_violated is a bug-level failure: stop the turn loudly.
        if (e instanceof AgentError) {
          try {
            await deps.audit({ tool: tc.name, ok: false, errorCode: e.code, conversationId });
          } catch { /* audit never throws */ }
          return { ok: false, code: "invariant_violated", message: e.message, conversationId };
        }
        executed = { ok: false, code: "tool_error", message: e instanceof Error ? e.message : "Tool call failed" };
      }
      try {
        await deps.audit({
          tool: tc.name,
          ok: executed.ok,
          errorCode: executed.ok ? undefined : executed.code,
          conversationId,
        });
      } catch { /* audit never throws */ }

      const summary = summarizeToolResult(tc.name, executed);
      const record: AgentToolCallRecord = {
        id: tc.id || randomUUID(),
        name: tc.name,
        arguments: (parsedArgs ?? {}) as Record<string, AgentJson>,
        ok: executed.ok,
        ...(executed.ok ? {} : { error_code: executed.code ?? "tool_error" }),
        result_summary: summary,
      };
      assistantToolCalls.push(record);
      await store.insertMessage({
        conversationId,
        role: "tool",
        content: summary,
        toolCalls: [record],
        provenance: "real",
      });
    }

    llmMessages.push({
      role: "assistant",
      content: reply.content ?? "",
      toolCalls: reply.toolCalls.map((t) => ({ id: t.id, name: t.name, arguments: t.arguments })),
    });
    for (const r of assistantToolCalls) {
      llmMessages.push({ role: "tool", content: r.result_summary, toolCallId: r.id });
    }
  }

  // The model kept calling tools for 6 iterations without a final answer.
  // End the turn honestly with what was done — still labeled AI analysis.
  const message = await store.insertMessage({
    conversationId,
    role: "assistant",
    content:
      "I ran out of tool-call steps before finishing. Here's what I did so far — " +
      "ask me to continue and I'll pick up from the results above. (AI analysis; costs shown are ESTIMATEs.)",
    provenance: "ai_analysis",
  });
  return { ok: true, conversationId, message, iterations, estimatedCredits, warnings };
}
