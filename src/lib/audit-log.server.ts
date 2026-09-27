/**
 * Phase 1 (Foundation) — workspace audit logging.
 *
 * Server-only module (`.server.ts`): never import from client components.
 * Writes to the `audit_logs` table via the service-role client (dynamic
 * import, same pattern as the other server modules).
 *
 * Pinned contract (owned by the database worker):
 *   audit_logs(id uuid pk default gen_random_uuid(),
 *              workspace_id uuid, actor_user_id uuid, action text,
 *              entity_type text, entity_id text,
 *              metadata jsonb default '{}', created_at timestamptz default now())
 *
 * `audit_logs` is intentionally not referenced through the generated
 * `Database` type (the worker owns the schema/types update), so this module
 * uses a minimal structural client type for the insert.
 */

export const AUDIT_ACTIONS = [
  "member.invited",
  "member.role_changed",
  "member.removed",
  "workspace.created",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditLogInput {
  /** Null when the workspace itself doesn't exist (never for these actions today). */
  workspaceId: string | null;
  actorUserId: string;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  metadata?: Record<string, unknown>;
}

/** Minimal insert surface — the real supabase-js client satisfies this. */
interface AuditLogsClient {
  from(table: "audit_logs"): {
    insert(row: {
      workspace_id: string | null;
      actor_user_id: string;
      action: string;
      entity_type: string;
      entity_id: string | null;
      metadata: Record<string, unknown>;
    }): PromiseLike<{ error: { message: string } | null }>;
  };
}

/**
 * Append one audit row. Throws on write failure — callers that must not
 * fail the domain mutation (e.g. member management when the table's
 * migration hasn't landed yet) should catch and log instead.
 */
export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const client = supabaseAdmin as unknown as AuditLogsClient;
  const { error } = await client.from("audit_logs").insert({
    workspace_id: input.workspaceId,
    actor_user_id: input.actorUserId,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId,
    metadata: input.metadata ?? {},
  });
  if (error) {
    throw new Error(`audit log write failed: ${error.message}`);
  }
}

/**
 * Best-effort audit wrapper for domain mutations: the audit row must never
 * break the mutation it records (e.g. if the audit_logs migration hasn't
 * been applied yet). Failures are logged loudly so the gap is visible in
 * server logs rather than silent.
 */
export async function auditSafely(input: AuditLogInput): Promise<void> {
  try {
    await writeAuditLog(input);
  } catch (err) {
    console.warn(
      "[audit] failed to write audit log",
      JSON.stringify({ action: input.action, workspaceId: input.workspaceId }),
      err instanceof Error ? err.message : String(err),
    );
  }
}
