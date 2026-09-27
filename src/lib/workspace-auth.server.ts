import { createMiddleware } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireAppUser } from "./server-auth";

/**
 * Phase 1 (Foundation) — workspace role model + permission matrix.
 *
 * Server-only module (`.server.ts`): never import from client components.
 *
 * The workspace role vocabulary for the Vidora OS program:
 *   owner > admin > strategist > creator > viewer > client
 *
 * Mapping from the legacy DB roles (the `workspace_members.role` CHECK
 * constraint currently allows only owner | editor | viewer — schema is
 * owned by the database worker, so this module stays forward-compatible):
 *   owner  -> owner   (unchanged)
 *   editor -> creator (could manage workspace data: channels, brand kit, schedules)
 *   viewer -> client  (read + sign-off; the migration notes "clients sit in
 *                      the workspace as `viewer`", and legacy viewers could
 *                      already record approval decisions)
 *
 * New rows written with the new vocabulary (admin, strategist, viewer,
 * client) require the widened CHECK constraint from the database worker;
 * `getWorkspaceRole` accepts them as-is once they exist.
 */

export type WorkspaceRole = "owner" | "admin" | "strategist" | "creator" | "viewer" | "client";

const WORKSPACE_ROLES: readonly WorkspaceRole[] = [
  "owner",
  "admin",
  "strategist",
  "creator",
  "viewer",
  "client",
];

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === "string" && (WORKSPACE_ROLES as readonly string[]).includes(value);
}

/** Legacy DB roles -> new vocabulary (see module doc). */
const LEGACY_ROLE_MAP: Record<string, WorkspaceRole> = {
  owner: "owner",
  editor: "creator",
  viewer: "client",
};

/** Privilege rank, highest first. Used for "at least" comparisons. */
export const WORKSPACE_ROLE_RANK: Record<WorkspaceRole, number> = {
  owner: 6,
  admin: 5,
  strategist: 4,
  creator: 3,
  viewer: 2,
  client: 1,
};

// ---------------------------------------------------------------------------
// Permission matrix
// ---------------------------------------------------------------------------

export type WorkspaceAction =
  | "member.invite"
  | "member.remove"
  | "member.changeRole"
  | "member.read"
  | "workspace.read"
  | "workspace.update"
  | "workspace.delete"
  | "workspace.data"
  | "approval.request"
  | "approval.decide";

const ALL_ROLES: readonly WorkspaceRole[] = [...WORKSPACE_ROLES];

/**
 * Action -> roles allowed to perform it.
 *
 * - member.invite / member.remove: owner + admin.
 * - member.changeRole: owner + admin, with the nuance that an admin may not
 *   touch owners (grant or revoke) — enforced by canChangeMemberRole().
 * - workspace.data: channels, brand kit, schedules — owner/admin/strategist/creator.
 * - client role: read + sign-off only (member.read, workspace.read,
 *   approval.decide) — no data writes, no member management.
 * - viewer: strictly read-only (member.read, workspace.read) — no sign-off.
 * - approval.decide: the client sign-off — every role EXCEPT viewer (legacy
 *   viewer rows map to `client`, which keeps their sign-off power).
 *
 * NOTE: `publish.approve` is intentionally ABSENT from this matrix. The
 * publish approval stays on the server-enforced `approvals` gate (D61/D62,
 * written only inside approvePublishJob); no workspace role grants it.
 */
export const WORKSPACE_PERMISSIONS: Record<WorkspaceAction, readonly WorkspaceRole[]> = {
  "member.invite": ["owner", "admin"],
  "member.remove": ["owner", "admin"],
  "member.changeRole": ["owner", "admin"],
  "member.read": ALL_ROLES,
  "workspace.read": ALL_ROLES,
  "workspace.update": ["owner", "admin"],
  "workspace.delete": ["owner"],
  "workspace.data": ["owner", "admin", "strategist", "creator"],
  "approval.request": ["owner", "admin", "strategist", "creator"],
  "approval.decide": ["owner", "admin", "strategist", "creator", "client"],
};

/** True when `role` may perform `action`. Fail-closed on null/unknown roles. */
export function roleCan(role: WorkspaceRole | null | undefined, action: WorkspaceAction): boolean {
  return role != null && isWorkspaceRole(role) && WORKSPACE_PERMISSIONS[action].includes(role);
}

/**
 * member.changeRole with the admin nuance: an admin may change roles but
 * may not touch owners — neither promoting someone TO owner nor demoting /
 * re-roling an existing owner. Only an owner can grant or revoke owner.
 */
export function canChangeMemberRole(args: {
  actorRole: WorkspaceRole | null | undefined;
  targetCurrentRole: WorkspaceRole | null | undefined;
  newRole: WorkspaceRole;
}): boolean {
  const { actorRole, targetCurrentRole, newRole } = args;
  if (!roleCan(actorRole, "member.changeRole")) return false;
  if (!isWorkspaceRole(newRole)) return false;
  if (actorRole === "owner") return true;
  // Non-owner actors (admin): the owner role is untouchable in both directions.
  if (targetCurrentRole === "owner" || newRole === "owner") return false;
  return true;
}

// ---------------------------------------------------------------------------
// Role resolution
// ---------------------------------------------------------------------------

/**
 * The caller's role in a workspace, or null for non-members.
 * Reads through the provided (service-role) client; unknown role strings
 * resolve to null (fail closed) rather than to a guessed privilege.
 */
export async function getWorkspaceRole(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const raw = (data as { role?: unknown } | null)?.role;
  if (typeof raw !== "string") return null;
  // Legacy rows win over the new vocabulary for the ambiguous "viewer":
  // the current CHECK constraint only allows owner|editor|viewer, and per
  // the migration every "viewer" row in the schema today IS a client seat
  // (read + sign-off). The existing member functions also still write
  // "viewer" with that meaning. When the database worker widens the CHECK
  // and backfills client seats to "client", drop the "viewer" entry below.
  if (raw in LEGACY_ROLE_MAP) return LEGACY_ROLE_MAP[raw]!;
  return isWorkspaceRole(raw) ? raw : null;
}

/**
 * Core role enforcement used by the middleware below. Exported so it can be
 * unit-tested with a mocked client.
 *
 * - Non-members get "Workspace not found" (never leaks whether the
 *   workspace exists or who belongs to it).
 * - Members without one of `allowedRoles` get a 403-style Forbidden error
 *   naming their role (never a privilege they don't have).
 */
export async function enforceWorkspaceRole(args: {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  userId: string;
  allowedRoles: readonly WorkspaceRole[];
  /** Human-readable action for the Forbidden message, e.g. "manage members". */
  action: string;
}): Promise<WorkspaceRole> {
  const role = await getWorkspaceRole(args.supabase, args.workspaceId, args.userId);
  if (role === null) {
    throw new Error("Workspace not found");
  }
  if (!args.allowedRoles.includes(role)) {
    throw new Error(`Forbidden: your workspace role (${role}) cannot ${args.action}.`);
  }
  return role;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

const workspaceIdSchema = z.string().uuid();

/**
 * Middleware factory for createServerFn, following the requireAppUser
 * pattern: fail closed, anonymous/guest sessions rejected before this runs.
 *
 * createServerFn middleware is bound at definition time while the workspace
 * id is per-request input, so pass `null` to resolve it from the function's
 * input data (`data.workspaceId`, UUID-validated — the chain runs before the
 * inputValidator, so this middleware validates it itself). Pass an explicit
 * id only when the workspace is genuinely fixed.
 *
 * The role is resolved through the service-role client (dynamic import, same
 * as the other server modules) and attached to context as `workspaceRole`
 * for downstream handlers.
 */
export function requireWorkspaceRole(
  workspaceId: string | null | undefined,
  allowedRoles: WorkspaceRole[],
) {
  return createMiddleware({ type: "function" })
    .middleware([requireAppUser])
    .server(async ({ next, context, data }) => {
      const { userId } = context as { userId?: string };
      if (!userId) {
        throw new Error("Unauthorized: anonymous sessions are not permitted");
      }

      const rawId =
        workspaceId ?? (data as { workspaceId?: unknown } | null | undefined)?.workspaceId;
      const parsed = workspaceIdSchema.safeParse(rawId);
      if (!parsed.success) {
        throw new Error("Forbidden: a valid workspace is required");
      }

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const role = await enforceWorkspaceRole({
        supabase: supabaseAdmin as SupabaseClient<Database>,
        workspaceId: parsed.data,
        userId,
        allowedRoles,
        action: "perform this action",
      });
      return next({ context: { workspaceRole: role } });
    });
}
