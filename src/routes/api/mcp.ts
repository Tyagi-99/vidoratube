import { createFileRoute } from "@tanstack/react-router";
import { MCP_TOOLS, handleJsonRpc, toolJsonSchema, type McpHttpDeps } from "@/lib/mcp/server";
import { makeSupabaseMcpPort } from "@/lib/mcp/port.supabase";
import { auditApiCall, authenticateApiKey, type VerifiedApiKey } from "@/lib/api-keys/keys.server";

/**
 * Phase 4 Stream E (F41) — MCP JSON-RPC endpoint.
 *
 * POST /api/mcp — JSON-RPC 2.0: `tools/list`, `tools/call`.
 * Auth: `Authorization: Bearer vdsk_...` (per-tool scopes, 60/min default).
 * GET  /api/mcp — authenticated discovery manifest (same auth, no scopes).
 *
 * Every authenticated call writes an audit_logs row (D157): one row per
 * tool call (`api.mcp.tool_call`), one row per tools/list request, and one
 * row per GET discovery manifest request.
 */
export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateApiKey(request, []);
        if (!auth.ok) {
          return Response.json({ error: auth.failure.error }, { status: auth.failure.status });
        }
        await auditApiCall({
          workspaceId: auth.key.workspaceId,
          actorUserId: auth.key.createdBy,
          action: "api.mcp.discovery",
          entityType: "mcp_tool",
          entityId: null,
          metadata: { api_key_id: auth.key.id, api_key_name: auth.key.name },
        });
        return Response.json({
          name: "vidora-mcp",
          transport: "json-rpc-2.0",
          endpoint: "/api/mcp",
          tools: MCP_TOOLS.map(toolJsonSchema),
        });
      },

      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json(
            {
              jsonrpc: "2.0",
              id: null,
              error: { code: -32700, message: "Parse error: invalid JSON" },
            },
            { status: 400 },
          );
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const port = makeSupabaseMcpPort(supabaseAdmin);

        const authedKey: { current: VerifiedApiKey | null } = { current: null };
        const deps: McpHttpDeps = {
          authenticate: async (requiredScopes) => {
            const auth = await authenticateApiKey(request, requiredScopes);
            if (!auth.ok) {
              const failureBody: Record<string, unknown> = { error: auth.failure.error };
              if (auth.failure.retryAfterMs !== undefined) {
                failureBody["retry_after_ms"] = auth.failure.retryAfterMs;
              }
              return { failure: { status: auth.failure.status, body: failureBody } };
            }
            authedKey.current = auth.key;
            return { key: auth.key };
          },
          port,
          audit: async (entry) => {
            const key = authedKey.current;
            if (!key) return;
            await auditApiCall({
              workspaceId: key.workspaceId,
              actorUserId: key.createdBy,
              action: "api.mcp.tool_call",
              entityType: "mcp_tool",
              entityId: null,
              metadata: {
                tool: entry.tool,
                ok: entry.ok,
                ...(entry.errorCode ? { error_code: entry.errorCode } : {}),
                api_key_id: key.id,
                api_key_name: key.name,
              },
            });
          },
        };

        const res = await handleJsonRpc(deps, body);

        // tools/list is an authenticated API call too — audit it (tool calls
        // are already audited per-call inside the dispatcher).
        const method = (body as { method?: unknown } | null)?.method;
        if (method === "tools/list" && authedKey.current && res.status < 400) {
          const key = authedKey.current;
          await auditApiCall({
            workspaceId: key.workspaceId,
            actorUserId: key.createdBy,
            action: "api.mcp.tools_list",
            entityType: "mcp_tool",
            entityId: null,
            metadata: { api_key_id: key.id, api_key_name: key.name },
          });
        }

        const headers: Record<string, string> = {};
        const failureBody = (res.body as { error?: { data?: { retry_after_ms?: number } } }).error
          ?.data;
        if (typeof failureBody?.retry_after_ms === "number") {
          headers["Retry-After"] = String(Math.ceil(failureBody.retry_after_ms / 1000));
        }
        return Response.json(res.body, { status: res.status, headers });
      },
    },
  },
});
