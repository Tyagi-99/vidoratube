import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "@/lib/server-auth";
import type { RegistryClient } from "./channels.server";

/**
 * Phase 4, Stream A (F27) — server functions for the channel registry.
 * All mutations are audit-logged inside channels.server.ts (best-effort, so a
 * missing audit_logs table can never break connect/disconnect).
 */

/** The caller's own registry rows. */
export const listChannelConnections = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .handler(async ({ context }) => {
    // Renamed on import: the server function itself is also called
    // listChannelConnections, and the shadow confused type inference.
    const { listChannelConnections: listRegistryRows } = await import("./channels.server");
    const rows = await listRegistryRows(context.supabase, context.userId);
    const { youtubeTestChannelId } = await import("@/lib/publishing-gates.server");
    const { metaTestConfig } = await import("@/lib/publishing-gates.server");
    return {
      connections: rows,
      // Which rows are the founder-designated test accounts (publishable).
      testDesignations: {
        youtubeChannelId: youtubeTestChannelId(),
        meta: metaTestConfig(),
      },
    };
  });

/**
 * Today's YouTube Data API quota usage, broken into the three D65 buckets
 * (videos.insert calls, search.list calls, shared units). Read-only.
 */
export const getPublishQuotaSummary = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .handler(async ({ context }) => {
    const { computeYouTubeQuotaSummary } = await import("./channels.server");
    return computeYouTubeQuotaSummary(context.supabase, context.userId);
  });

const healthCheckSchema = z.object({ connection_id: z.string().uuid() });

/**
 * Runs a live health check on one registry row (token validity at the
 * platform + fresh quota visibility) and persists the outcome. Transient
 * platform errors mark the row 'degraded'; a dead grant marks it 'expired'.
 */
export const runChannelHealthCheck = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((input: unknown) => healthCheckSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { checkChannelHealth } = await import("./channels.server");
    // Ownership is enforced inside checkChannelHealth (id + user_id match).
    return checkChannelHealth(supabaseAdmin, context.userId, data.connection_id);
  });

const removeSchema = z.object({ connection_id: z.string().uuid() });

/**
 * Removes a registry row. This only affects the registry — the OAuth token
 * itself is revoked/deleted by the platform-specific disconnect flows
 * (disconnectYouTube / disconnectMeta). The row is deleted (not just
 * revoked) so a re-connect registers cleanly.
 */
export const removeChannelConnection = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((input: unknown) => removeSchema.parse(input))
  .handler(async ({ data, context }) => {
    // channel_connections is intentionally not in the generated Database
    // type (same reason as audit_logs) — use the structural client.
    const db = context.supabase as unknown as RegistryClient;
    const { error } = await db
      .from("channel_connections")
      .delete()
      .eq("id", data.connection_id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    const { auditPublishEvent } = await import("./audit");
    await auditPublishEvent({
      workspaceId: null,
      actorUserId: context.userId,
      action: "channel.disconnected",
      entityType: "channel_connection",
      entityId: data.connection_id,
      metadata: { removed_from_registry: true },
    });
    return { ok: true };
  });
