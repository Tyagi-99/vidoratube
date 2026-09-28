/**
 * Phase 4 Stream E (F41) — MCP server (JSON-RPC over HTTP).
 *
 * Exposes the 8 pinned tools (docs/PHASE4_CONTRACTS.md):
 *   vidora.search_channels, vidora.get_channel, vidora.list_projects,
 *   vidora.get_project, vidora.draft_script, vidora.request_publish,
 *   vidora.get_analytics, vidora.list_learnings
 *
 * Security shape (D154/D156/D157/D160):
 * - Every call authenticates via API key (`authenticateApiKey`); each tool
 *   declares required scopes and the dispatcher re-checks them (defense in
 *   depth — the route checks first).
 * - `draft_script` and `request_publish` create DRAFT rows ONLY. The tool
 *   schemas have NO status field; the port hardcodes 'draft'; the handler
 *   asserts the returned status. There is no code path from these tools to
 *   any other status — publishing still requires the human approval gate.
 * - `draft_script` has two modes: verbatim `sections` (stored as-is, no
 *   spend) or `generate` (real LLM generation through
 *   `generateScriptDraft`, which runs the Phase 1 preflight credit gate and
 *   debits 1 credit — the credit gate is real, not theater).
 * - Every tools/call response carries the pinned `provenance` block
 *   (real | estimate | ai_analysis | fixture).
 * - Every tool call is audit-logged via the injected `audit` callback
 *   (the route wires it to `auditApiCall`; fire-and-forget).
 * - Transport is JSON-RPC 2.0 over HTTP POST at /api/mcp (D160: no
 *   SSE/stdio — matches the serverless deploy).
 *
 * Testability: all DB access goes through `McpDataPort`; tests inject a
 * fake. The route file is a thin adapter.
 *
 * CREDIT-GATING AUDIT — Phase 5 Stream B (D180), 2026-09-28.
 * Every MCP tool path was traced for spend (credits / paid provider calls):
 *
 * - vidora.search_channels / vidora.get_channel / vidora.list_projects /
 *   vidora.get_project / vidora.get_analytics / vidora.list_learnings —
 *   read-only port methods (DB SELECTs through the Supabase port). No LLM
 *   calls, no renders, no uploads: SPEND NOTHING.
 * - vidora.draft_script, verbatim `sections` mode — stores caller-supplied
 *   sections as-is via port.createDraftScript. No generation: SPENDS NOTHING.
 * - vidora.draft_script, `generate` mode — THE ONLY SPENDING PATH. Calls
 *   port.generateScriptDraft → generateScriptDraft
 *   (src/lib/creation/scripts/scripts.functions.ts), which runs the Phase 1
 *   preflight credit gate (ESTIMATE → balance → budget) BEFORE any LLM call,
 *   refuses on INSUFFICIENT_CREDITS / BUDGET_EXCEEDED / unconfigured gateway,
 *   and debits exactly 1 credit BEFORE persisting the draft (debit-first:
 *   if the debit fails, no draft is saved). Verified in source 2026-09-28.
 * - vidora.request_publish — port.createDraftPublishJob inserts a draft
 *   publish_job row only. Publishing, scheduling, and uploading still go
 *   through the human approval gate; the tool CANNOT approve, publish,
 *   schedule, or spend: SPENDS NOTHING.
 *
 * Outcome: 1 of 8 tool paths spends, behind the real preflight+debit gate.
 * Nothing ungated was found; no additional gates were needed. If a future
 * tool gains a spending path, it must call preflightCreditsCheck +
 * debit-first before the spend, and this comment must be updated.
 */

import { z } from "zod";
import {
  provenanceBlock,
  type ApiKeyScope,
  type ProvenanceBlock,
  type RateLimitState,
} from "../api-keys/keys";
import type { VerifiedApiKey } from "../api-keys/keys.server";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class McpError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number = 400,
  ) {
    super(message);
    this.name = "McpError";
  }
}

// ---------------------------------------------------------------------------
// Data port (fake in tests; Supabase in production)
// ---------------------------------------------------------------------------

export interface McpChannelSummary {
  id: string;
  platform: string;
  handle: string | null;
  title: string | null;
  is_own: boolean;
  status: string | null;
}

export interface McpChannelDetail extends McpChannelSummary {
  external_channel_id: string;
  latest_snapshot: {
    snapshot_date: string;
    metrics: Record<string, unknown>;
    revenue_usd: number | null;
    revenue_basis: string;
  } | null;
}

export interface McpProjectSummary {
  id: string;
  title: string;
  topic: string;
  status: string;
  updated_at: string;
}

export interface McpProjectDetail extends McpProjectSummary {
  mode: string;
  language: string;
  duration_minutes: number;
  latest_script: {
    id: string;
    title: string;
    status: string;
    version_number: number | null;
    word_count: number;
  } | null;
}

export interface McpDraftScriptResult {
  script_id: string;
  version_number: number;
  /** Echo of the asserted status — always 'draft'. */
  status: "draft";
}

export interface McpGenerateResult extends McpDraftScriptResult {
  estimated_credits: number | null;
  actual_credits: number | null;
}

export interface McpPublishRequestResult {
  publish_job_id: string;
  /** Echo of the asserted status — always 'draft'. */
  status: "draft";
}

export interface McpAnalytics {
  channel_id: string;
  snapshot: {
    snapshot_date: string;
    metrics: Record<string, unknown>;
    revenue_usd: number | null;
    revenue_basis: string;
  } | null;
}

export interface McpLearning {
  id: string;
  kind: string;
  status: string;
  confidence: number | null;
  /** Pinned: AI-mined learnings are labeled "AI analysis". */
  origin: "ai_analysis" | "manual";
  evidence: Record<string, unknown> | null;
  created_at: string;
}

export interface McpDataPort {
  searchChannels(input: {
    userId: string;
    workspaceId: string;
    query: string;
    limit: number;
  }): Promise<McpChannelSummary[]>;

  getChannel(input: {
    userId: string;
    workspaceId: string;
    channelId: string;
  }): Promise<McpChannelDetail | null>;

  listProjects(input: { userId: string; limit: number }): Promise<McpProjectSummary[]>;

  getProject(input: { userId: string; projectId: string }): Promise<McpProjectDetail | null>;

  /** Verbatim draft: stores caller-supplied sections, status forced 'draft'. */
  createDraftScript(input: {
    userId: string;
    projectId: string;
    title: string;
    sections: { heading: string; body: string }[];
  }): Promise<McpDraftScriptResult>;

  /**
   * AI draft: real LLM generation via generateScriptDraft — runs the Phase 1
   * preflight credit gate and debits 1 credit. Never throws for billing
   * states; they arrive in the envelope.
   */
  generateScriptDraft(input: {
    userId: string;
    projectId: string;
    topic: string;
    sectionCount: number;
  }): Promise<
    | {
        ok: true;
        result: McpGenerateResult;
        estimatedCredits: number | null;
        actualCredits: number | null;
      }
    | { ok: false; code: string; message: string }
  >;

  /** Draft publish job: status forced 'draft'. Can never publish. */
  createDraftPublishJob(input: {
    userId: string;
    workspaceId: string;
    projectId: string;
    title: string | null;
    description: string | null;
    tags: string[];
    privacy: "private" | "unlisted" | "public";
    scheduledFor: string | null;
  }): Promise<McpPublishRequestResult>;

  getChannelAnalytics(input: {
    userId: string;
    workspaceId: string;
    channelId: string;
  }): Promise<McpAnalytics | null>;

  listLearnings(input: {
    userId: string;
    status: string | null;
    limit: number;
  }): Promise<McpLearning[]>;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const uuid = z.string().uuid();
const limit = (dflt: number) => z.number().int().min(1).max(50).default(dflt);

const sectionSchema = z.object({
  heading: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(20000),
});

const draftScriptArgs = z
  .object({
    project_id: uuid.describe("Project to attach the draft script to"),
    title: z.string().trim().min(1).max(120).optional().describe("Script title"),
    sections: z
      .array(sectionSchema)
      .min(1)
      .max(20)
      .optional()
      .describe("Verbatim sections to store — no AI generation, no credit spend"),
    generate: z
      .object({
        topic: z.string().trim().min(1).max(500),
        section_count: z.number().int().min(1).max(20).default(6),
      })
      .optional()
      .describe("AI-generate the draft (credit-gated: preflight + 1 credit debit)"),
  })
  .refine((v) => (v.sections ? 1 : 0) + (v.generate ? 1 : 0) === 1, {
    message: "provide exactly one of `sections` (verbatim) or `generate` (AI)",
  });

const requestPublishArgs = z.object({
  project_id: uuid.describe("Project to create the draft publish job for"),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  privacy: z.enum(["private", "unlisted", "public"]).default("private"),
  scheduled_for: z.string().datetime({ offset: true }).optional(),
});

export interface McpToolDef {
  name: string;
  description: string;
  requiredScopes: ApiKeyScope[];
  argsSchema: z.ZodTypeAny;
}

export const MCP_TOOLS: McpToolDef[] = [
  {
    name: "vidora.search_channels",
    description:
      "Search the workspace's tracked channels (own + competitor) by handle, title, or platform.",
    requiredScopes: ["read:analytics"],
    argsSchema: z.object({
      query: z.string().trim().min(1).max(200),
      limit: limit(10),
    }),
  },
  {
    name: "vidora.get_channel",
    description: "Get one channel with its latest analytics snapshot.",
    requiredScopes: ["read:analytics"],
    argsSchema: z.object({ channel_id: uuid }),
  },
  {
    name: "vidora.list_projects",
    description: "List the key owner's video projects, newest first.",
    requiredScopes: ["read:projects"],
    argsSchema: z.object({ limit: limit(20) }),
  },
  {
    name: "vidora.get_project",
    description: "Get one project with its latest script summary.",
    requiredScopes: ["read:projects"],
    argsSchema: z.object({ project_id: uuid }),
  },
  {
    name: "vidora.draft_script",
    description:
      "Create a DRAFT script on a project. Verbatim `sections` are stored as-is (free); " +
      "`generate` runs AI generation behind the credit gate. The script is ALWAYS created " +
      "as a draft — this tool can never approve, lock, or publish anything.",
    requiredScopes: ["write:projects"],
    argsSchema: draftScriptArgs,
  },
  {
    name: "vidora.request_publish",
    description:
      "Create a DRAFT publish job for a project. The job is ALWAYS created as a draft — " +
      "publishing requires a human approval through the publish pipeline. This tool can " +
      "never publish, schedule, or upload.",
    requiredScopes: ["publish:request"],
    argsSchema: requestPublishArgs,
  },
  {
    name: "vidora.get_analytics",
    description:
      "Get the latest analytics snapshot for a channel. revenue_usd is an ESTIMATE unless " +
      "revenue_basis is 'measured' — never present it as measured without that basis.",
    requiredScopes: ["read:analytics"],
    argsSchema: z.object({ channel_id: uuid }),
  },
  {
    name: "vidora.list_learnings",
    description:
      "List learning insights (evidence-gated). AI-mined learnings carry origin 'ai_analysis'. " +
      "Only validated learnings should feed brief advice.",
    requiredScopes: ["read:analytics"],
    argsSchema: z.object({
      status: z.enum(["proposed", "validated", "refuted", "archived"]).optional(),
      limit: limit(20),
    }),
  },
];

export function getToolDef(name: string): McpToolDef | null {
  return MCP_TOOLS.find((t) => t.name === name) ?? null;
}

// ---------------------------------------------------------------------------
// zod -> JSON Schema (for tools/list; supports the subset used above)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function zodToJsonSchema(schema: any): Record<string, unknown> {
  const def = schema?._def;
  const typeName: string | undefined = def?.typeName;
  const desc = def?.description as string | undefined;
  const withDesc = (s: Record<string, unknown>) => (desc ? { ...s, description: desc } : s);

  switch (typeName) {
    case "ZodObject": {
      const shape = def.shape() as Record<string, z.ZodTypeAny>;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [k, v] of Object.entries(shape)) {
        properties[k] = zodToJsonSchema(v);
        if (!isOptional(v)) required.push(k);
      }
      return withDesc({
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
        additionalProperties: false,
      });
    }
    case "ZodString": {
      const s: Record<string, unknown> = { type: "string" };
      for (const check of def.checks as { kind: string; value?: unknown }[]) {
        if (check.kind === "min") s["minLength"] = check.value;
        if (check.kind === "max") s["maxLength"] = check.value;
        if (check.kind === "uuid") s["format"] = "uuid";
        if (check.kind === "datetime") s["format"] = "date-time";
      }
      return withDesc(s);
    }
    case "ZodNumber": {
      const s: Record<string, unknown> = {
        type: def.checks?.some((c: { kind: string }) => c.kind === "int") ? "integer" : "number",
      };
      for (const check of def.checks as { kind: string; value?: unknown }[]) {
        if (check.kind === "min") s["minimum"] = check.value;
        if (check.kind === "max") s["maximum"] = check.value;
      }
      return withDesc(s);
    }
    case "ZodBoolean":
      return withDesc({ type: "boolean" });
    case "ZodEnum":
      return withDesc({ type: "string", enum: def.values });
    case "ZodArray":
      return withDesc({ type: "array", items: zodToJsonSchema(def.type) });
    case "ZodOptional":
      return zodToJsonSchema(def.innerType);
    case "ZodDefault":
      return zodToJsonSchema(def.innerType);
    case "ZodEffects":
      return zodToJsonSchema(def.schema);
    default:
      return withDesc({});
  }
}

function isOptional(schema: z.ZodTypeAny): boolean {
  const typeName = (schema as unknown as { _def: { typeName: string } })._def.typeName;
  return typeName === "ZodOptional" || typeName === "ZodDefault";
}

export function toolJsonSchema(def: McpToolDef): Record<string, unknown> {
  return {
    name: def.name,
    description: def.description,
    inputSchema: zodToJsonSchema(def.argsSchema),
  };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export interface McpToolResult {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string } | undefined;
  provenance: ProvenanceBlock;
}

export interface McpCallDeps {
  port: McpDataPort;
  key: VerifiedApiKey;
  /** Audit hook — the route wires this to auditApiCall. Must never throw. */
  audit: (entry: { tool: string; ok: boolean; errorCode?: string | undefined }) => Promise<void>;
}

function userIdFor(key: VerifiedApiKey): string {
  if (!key.createdBy) {
    throw new McpError(
      "key_has_no_owner",
      "This API key has no owning user; create a new key from the settings UI.",
      403,
    );
  }
  return key.createdBy;
}

function assertDraftStatus(status: unknown, what: string): asserts status is "draft" {
  if (status !== "draft") {
    // This is a bug, not a user error — the port must force 'draft'.
    throw new McpError("invariant_violated", `${what} was not created as a draft`, 500);
  }
}

async function runTool(
  deps: McpCallDeps,
  def: McpToolDef,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const { port, key } = deps;
  const userId = userIdFor(key);
  const workspaceId = key.workspaceId;

  switch (def.name) {
    case "vidora.search_channels": {
      const a = args as { query: string; limit: number };
      const channels = await port.searchChannels({
        userId,
        workspaceId,
        query: a.query,
        limit: a.limit,
      });
      return { ok: true, data: { channels }, provenance: provenanceBlock("real") };
    }
    case "vidora.get_channel": {
      const a = args as { channel_id: string };
      const channel = await port.getChannel({ userId, workspaceId, channelId: a.channel_id });
      if (!channel) throw new McpError("channel_not_found", "Channel not found", 404);
      return { ok: true, data: { channel }, provenance: provenanceBlock("real") };
    }
    case "vidora.list_projects": {
      const a = args as { limit: number };
      const projects = await port.listProjects({ userId, limit: a.limit });
      return { ok: true, data: { projects }, provenance: provenanceBlock("real") };
    }
    case "vidora.get_project": {
      const a = args as { project_id: string };
      const project = await port.getProject({ userId, projectId: a.project_id });
      if (!project) throw new McpError("project_not_found", "Project not found", 404);
      return { ok: true, data: { project }, provenance: provenanceBlock("real") };
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
          data: {
            script_id: result.script_id,
            version_number: result.version_number,
            status: "draft",
          },
          provenance: provenanceBlock(
            "real",
            "caller-supplied sections stored verbatim; no AI generation, no credit spend",
          ),
        };
      }
      // generate path — the ONLY tool path that spends credits, behind the
      // real preflight gate inside generateScriptDraft.
      const gen = await port.generateScriptDraft({
        userId,
        projectId: a.project_id,
        topic: a.generate!.topic,
        sectionCount: a.generate!.section_count,
      });
      if (!gen.ok) {
        throw new McpError(gen.code, gen.message, gen.code === "INSUFFICIENT_CREDITS" ? 402 : 502);
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
        provenance: provenanceBlock(
          "ai_analysis",
          "LLM-generated draft via the AI gateway; credit-gated (preflight estimate + debit)",
        ),
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
      return {
        ok: true,
        data: { publish_job_id: result.publish_job_id, status: "draft" },
        provenance: provenanceBlock(
          "real",
          "draft publish job created; publishing requires human approval through the publish pipeline — this tool can never publish",
        ),
      };
    }
    case "vidora.get_analytics": {
      const a = args as { channel_id: string };
      const analytics = await port.getChannelAnalytics({
        userId,
        workspaceId,
        channelId: a.channel_id,
      });
      if (!analytics) throw new McpError("channel_not_found", "Channel not found", 404);
      const basis = analytics.snapshot?.revenue_basis;
      return {
        ok: true,
        data: analytics,
        provenance:
          basis === "measured"
            ? provenanceBlock("real")
            : provenanceBlock(
                "real",
                analytics.snapshot
                  ? "revenue_usd is an ESTIMATE (revenue_basis=estimate) — never present it as measured"
                  : "no analytics snapshots recorded for this channel yet",
              ),
      };
    }
    case "vidora.list_learnings": {
      const a = args as {
        status?: "proposed" | "validated" | "refuted" | "archived";
        limit: number;
      };
      const learnings = await port.listLearnings({
        userId,
        status: a.status ?? null,
        limit: a.limit,
      });
      return {
        ok: true,
        data: { learnings },
        provenance: provenanceBlock(
          "real",
          "AI-mined learnings carry origin 'ai_analysis'; only validated learnings should feed brief advice",
        ),
      };
    }
    default:
      throw new McpError("unknown_tool", `Unknown tool: ${def.name}`, 400);
  }
}

/**
 * Dispatch one tools/call. Validates the tool, parses args, re-checks
 * scopes (the route checks first), runs the handler, and audit-logs the
 * call in a finally — the audit hook must never throw.
 */
export async function callMcpTool(
  deps: McpCallDeps,
  toolName: string,
  rawArgs: unknown,
): Promise<McpToolResult> {
  const started = Date.now();
  let ok = false;
  let errorCode: string | undefined;
  try {
    const def = getToolDef(toolName);
    if (!def) {
      throw new McpError("unknown_tool", `Unknown tool: ${String(toolName)}`, 404);
    }
    for (const scope of def.requiredScopes) {
      if (!deps.key.scopes.includes(scope)) {
        throw new McpError("insufficient_scope", `This key lacks the '${scope}' scope`, 403);
      }
    }
    const parsed = def.argsSchema.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new McpError(
        "invalid_arguments",
        `Invalid arguments: ${first ? `${first.path.join(".")}: ${first.message}` : "validation failed"}`,
        400,
      );
    }
    const result = await runTool(deps, def, parsed.data as Record<string, unknown>);
    ok = true;
    return result;
  } catch (e) {
    const err = e instanceof McpError ? e : new McpError("internal_error", "Tool call failed", 500);
    if (!(e instanceof McpError)) {
      console.error("[mcp] tool error", toolName, e instanceof Error ? e.message : String(e));
    }
    errorCode = err.code;
    return {
      ok: false,
      error: { code: err.code, message: err.message },
      provenance: provenanceBlock("real", "tool call failed; no data produced"),
    };
  } finally {
    const entry: { tool: string; ok: boolean; errorCode?: string | undefined } = {
      tool: toolName,
      ok,
    };
    if (errorCode !== undefined) entry.errorCode = errorCode;
    try {
      await deps.audit(entry);
    } catch {
      // Audit must never break the tool call.
    }
    void started;
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 envelope
// ---------------------------------------------------------------------------

export interface McpHttpDeps {
  /**
   * Authenticate for the given scopes. Returns the verified key, or null
   * when auth failed (the failure response is already built).
   *
   * D178: the failure may carry `rateLimit` state so the route can emit
   * X-RateLimit-* headers even on 429/403 responses.
   */
  authenticate: (requiredScopes: ApiKeyScope[]) => Promise<
    | { key: VerifiedApiKey; rateLimit?: RateLimitState | undefined }
    | {
        failure: {
          status: number;
          body: unknown;
          rateLimit?: RateLimitState | undefined;
        };
      }
  >;
  port: McpDataPort;
  audit: McpCallDeps["audit"];
}

interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: string | number | null;
  result: unknown;
}
interface JsonRpcError {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcError {
  const e: JsonRpcError = { jsonrpc: "2.0", id, error: { code, message } };
  if (data !== undefined) e.error.data = data;
  return e;
}

/**
 * Handle one JSON-RPC 2.0 request body. Returns the HTTP status + body.
 * Auth failures and rate limits surface as JSON-RPC errors with the
 * matching HTTP status (401/403/429).
 */
export async function handleJsonRpc(
  deps: McpHttpDeps,
  body: unknown,
): Promise<{ status: number; body: JsonRpcSuccess | JsonRpcError }> {
  const req = body as {
    jsonrpc?: unknown;
    id?: unknown;
    method?: unknown;
    params?: unknown;
  } | null;
  const id = typeof req?.id === "string" || typeof req?.id === "number" ? req.id : null;

  if (!req || req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    return { status: 400, body: rpcError(id, -32600, "Invalid Request: expected JSON-RPC 2.0") };
  }
  if (Array.isArray(body)) {
    return {
      status: 400,
      body: rpcError(id, -32600, "Invalid Request: batch requests are not supported"),
    };
  }

  if (req.method === "tools/list") {
    const auth = await deps.authenticate([]);
    if ("failure" in auth)
      return {
        status: auth.failure.status,
        body: rpcError(id, -32001, "Unauthorized", auth.failure.body),
      };
    return {
      status: 200,
      body: { jsonrpc: "2.0", id, result: { tools: MCP_TOOLS.map(toolJsonSchema) } },
    };
  }

  if (req.method === "tools/call") {
    const params = (req.params ?? {}) as { name?: unknown; arguments?: unknown };
    const toolName = typeof params.name === "string" ? params.name : "";
    const def = getToolDef(toolName);
    if (!def) {
      // Authenticate anyway so tool enumeration isn't free.
      const auth = await deps.authenticate([]);
      if ("failure" in auth)
        return {
          status: auth.failure.status,
          body: rpcError(id, -32001, "Unauthorized", auth.failure.body),
        };
      return { status: 404, body: rpcError(id, -32601, `Method not found: ${toolName}`) };
    }
    const auth = await deps.authenticate(def.requiredScopes);
    if ("failure" in auth) {
      return {
        status: auth.failure.status,
        body: rpcError(id, -32001, "Unauthorized", auth.failure.body),
      };
    }
    const result = await callMcpTool(
      { port: deps.port, key: auth.key, audit: deps.audit },
      toolName,
      params.arguments,
    );
    const httpStatus = result.ok ? 200 : result.error?.code === "invalid_arguments" ? 400 : 200;
    return { status: httpStatus, body: { jsonrpc: "2.0", id, result } };
  }

  return { status: 404, body: rpcError(id, -32601, `Method not found: ${req.method}`) };
}
