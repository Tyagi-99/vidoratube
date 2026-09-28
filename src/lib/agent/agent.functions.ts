/**
 * Phase 5 Stream A (F10) — Vidora Agent server functions.
 *
 * Thin adapters over `sendAgentMessage` in `./agent.server` (dynamic import
 * keeps node:crypto and the gateway client out of the client bundle).
 * Session-authenticated via `requireAppUser`; every handler re-checks
 * workspace membership and conversation ownership.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "@/lib/server-auth";
import { getWorkspaceRole } from "@/lib/agency/agency.functions";
import type { AgentDeps, AgentTurnResult } from "./agent.server";

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function requireMemberWorkspace(admin: Awaited<ReturnType<typeof getAdmin>>, workspaceId: string, userId: string): Promise<void> {
  const role = await getWorkspaceRole(admin, workspaceId, userId);
  if (!role) throw new Error("You are not a member of this workspace.");
}

async function makeDeps(
  userId: string,
  workspaceId: string,
): Promise<AgentDeps> {
  const admin = await getAdmin();
  const agent = await import("./agent.server");
  const { makeSupabaseMcpPort } = await import("@/lib/mcp/port.supabase");
  const { preflight, debitTurn } = agent.makeProductionCreditHooks(admin);
  return {
    admin,
    store: agent.makeSupabaseAgentStore(admin),
    // The agent calls the 8 pinned tools through the Supabase MCP port
    // directly — the same functions the /api/mcp route uses, no copied logic.
    port: makeSupabaseMcpPort(admin),
    llm: agent.makeGatewayLlmChat(),
    isConfigured: () => process.env["LOVABLE_API_KEY"] !== undefined && process.env["LOVABLE_API_KEY"] !== "",
    preflight,
    debitTurn,
    audit: agent.makeProductionAudit(admin, userId, workspaceId),
  };
}

/** Whether the agent backend is configured (LOVABLE_API_KEY present). No secret leaks. */
export const getAgentStatus = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .handler(async (): Promise<{ configured: boolean }> => {
    return {
      configured:
        process.env["LOVABLE_API_KEY"] !== undefined && process.env["LOVABLE_API_KEY"] !== "",
    };
  });

export const listAgentConversations = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z.object({ workspaceId: z.string().uuid(), limit: z.number().int().min(1).max(50).default(30) }).parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const admin = await getAdmin();
    await requireMemberWorkspace(admin, data.workspaceId, context.userId);
    const agent = await import("./agent.server");
    const store = agent.makeSupabaseAgentStore(admin);
    return store.listConversations(context.userId, data.workspaceId, data.limit);
  });

export const getAgentThread = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ conversationId: z.string().uuid() }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const admin = await getAdmin();
    const agent = await import("./agent.server");
    const store = agent.makeSupabaseAgentStore(admin);
    const conversation = await store.getConversation(context.userId, data.conversationId);
    if (!conversation) throw new Error("Conversation not found.");
    // Owner check above is the gate; workspace_id is context for tool calls.
    if (conversation.workspace_id) {
      await requireMemberWorkspace(admin, conversation.workspace_id, context.userId);
    }
    const messages = await store.listMessages(data.conversationId, 200);
    return { conversation, messages };
  });

export const sendAgentMessageFn = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        conversationId: z.string().uuid().nullable(),
        text: z.string().trim().min(1).max(8000),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<AgentTurnResult> => {
    const admin = await getAdmin();
    await requireMemberWorkspace(admin, data.workspaceId, context.userId);
    const agent = await import("./agent.server");
    const deps = await makeDeps(context.userId, data.workspaceId);
    return agent.sendAgentMessage(deps, {
      userId: context.userId,
      workspaceId: data.workspaceId,
      conversationId: data.conversationId,
      text: data.text,
    });
  });
