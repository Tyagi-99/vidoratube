/**
 * Phase 4 Stream E (F41) — shared helper for the /api/keys REST endpoints.
 *
 * SERVER-ONLY. All key-management-over-API calls require the `admin:keys`
 * scope and are audit-logged.
 */
import { auditApiCall, authenticateApiKey, type VerifiedApiKey } from "./keys.server";

export async function requireAdminKey(
  request: Request,
): Promise<{ key: VerifiedApiKey } | { response: Response }> {
  const auth = await authenticateApiKey(request, ["admin:keys"]);
  if (!auth.ok) {
    const headers: Record<string, string> = {};
    if (auth.failure.retryAfterMs !== undefined) {
      headers["Retry-After"] = String(Math.ceil(auth.failure.retryAfterMs / 1000));
    }
    return {
      response: Response.json(
        { error: auth.failure.error },
        { status: auth.failure.status, headers },
      ),
    };
  }
  return { key: auth.key };
}

export async function auditKeyAction(
  key: VerifiedApiKey,
  action: "api.keys.created" | "api.keys.revoked" | "api.keys.rotated" | "api.keys.listed",
  keyId: string | null,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await auditApiCall({
    workspaceId: key.workspaceId,
    actorUserId: key.createdBy,
    action,
    entityType: "api_key",
    entityId: keyId,
    metadata: {
      via: "rest",
      acting_key_id: key.id,
      acting_key_name: key.name,
      ...(metadata ?? {}),
    },
  });
}
