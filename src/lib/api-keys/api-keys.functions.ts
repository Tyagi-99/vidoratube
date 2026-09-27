/**
 * Phase 4 Stream E (F41) — API key management server functions (session auth).
 *
 * The settings UI calls these; every function authenticates via
 * requireAppUser and enforces the workspace role rules from agency.ts
 * (members may LIST keys; only owners/editors may create/revoke/rotate —
 * mirroring the api_keys RLS policies). All mutations are audit-logged.
 *
 * The raw key is returned ONLY by create/rotate, in that response only.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "../server-auth";
import { auditApiCall, createApiKey, listApiKeys, revokeApiKey, rotateApiKey } from "./keys.server";
import { canEditWorkspace, canReadWorkspace } from "../agency/agency";
import { getWorkspaceRole } from "../agency/agency.functions";

type AdminClient = import("@supabase/supabase-js").SupabaseClient<
  import("@/integrations/supabase/types").Database
>;

async function admin(): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as AdminClient;
}

async function requireRole(
  workspaceId: string,
  userId: string,
  allowed: (role: import("../agency/agency").WorkspaceRole | null) => boolean,
  action: string,
) {
  const role = await getWorkspaceRole(await admin(), workspaceId, userId);
  if (role === null) throw new Error("Workspace not found");
  if (!allowed(role)) throw new Error(`Your role (${role}) cannot ${action}.`);
}

async function rateLimit(
  userId: string,
  key: string,
  max: number,
  windowSeconds: number,
  message: string,
) {
  const { enforcePostgresRateLimit } = await import("../rate-limit");
  await enforcePostgresRateLimit(
    await admin(),
    `${key}:${userId}`,
    { max, windowSeconds },
    message,
  );
}

async function auditUiKeyAction(
  workspaceId: string,
  actorUserId: string,
  action: "api.keys.created" | "api.keys.revoked" | "api.keys.rotated",
  keyId: string,
  metadata?: Record<string, unknown>,
) {
  await auditApiCall(
    {
      workspaceId,
      actorUserId,
      action,
      entityType: "api_key",
      entityId: keyId,
      metadata: { via: "settings-ui", ...(metadata ?? {}) },
    },
    undefined,
  );
}

const workspaceSchema = z.object({ workspaceId: z.string().uuid() });

/** List key metadata (members may read; never hashes or raw keys). */
export const listApiKeysFn = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => workspaceSchema.parse(i))
  .handler(async ({ data, context }) => {
    await requireRole(data.workspaceId, context.userId, canReadWorkspace, "view API keys");
    return { keys: await listApiKeys(data.workspaceId) };
  });

const createKeySchema = workspaceSchema.extend({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.string()).min(1),
  rateLimitPerMin: z.number().int().positive().max(1000).optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
});

/** Create a key — the RAW key is returned ONCE in this response. */
export const createApiKeyFn = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => createKeySchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await requireRole(data.workspaceId, userId, canEditWorkspace, "manage API keys");
    await rateLimit(userId, "api-keys:create", 20, 3600, "You're creating API keys too fast.");
    const created = await createApiKey({
      workspaceId: data.workspaceId,
      name: data.name,
      scopes: data.scopes,
      rateLimitPerMin: data.rateLimitPerMin,
      expiresAt: data.expiresAt ?? null,
      createdBy: userId,
    });
    await auditUiKeyAction(data.workspaceId, userId, "api.keys.created", created.meta.id, {
      name: created.meta.name,
      scopes: created.meta.scopes,
    });
    return { key: created.meta, rawKey: created.rawKey };
  });

const keyTargetSchema = workspaceSchema.extend({ keyId: z.string().uuid() });

/** Revoke a key. */
export const revokeApiKeyFn = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => keyTargetSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await requireRole(data.workspaceId, userId, canEditWorkspace, "manage API keys");
    await rateLimit(userId, "api-keys:revoke", 60, 3600, "You're revoking API keys too fast.");
    await revokeApiKey(data.keyId, data.workspaceId);
    await auditUiKeyAction(data.workspaceId, userId, "api.keys.revoked", data.keyId);
    return { ok: true };
  });

/** Rotate a key — new RAW key returned ONCE in this response. */
export const rotateApiKeyFn = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => keyTargetSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await requireRole(data.workspaceId, userId, canEditWorkspace, "manage API keys");
    await rateLimit(userId, "api-keys:rotate", 60, 3600, "You're rotating API keys too fast.");
    const rotated = await rotateApiKey(data.keyId, data.workspaceId, userId);
    await auditUiKeyAction(data.workspaceId, userId, "api.keys.rotated", rotated.meta.id, {
      oldKeyId: data.keyId,
      name: rotated.meta.name,
    });
    return { key: rotated.meta, rawKey: rotated.rawKey };
  });
