/**
 * Phase 4 Stream E (F40) — workspace invite server functions.
 *
 * Token-based invites for teammates who don't have an account yet:
 *   1. An owner/editor creates an invite (email + role).
 *   2. The raw token is shown ONCE to the inviter and emailed best-effort
 *      via Resend (needs RESEND_API_KEY + verified EMAIL_FROM).
 *   3. The recipient signs up / signs in, opens the link, and clicks Accept.
 *   4. Acceptance requires the signed-in account's email to match the
 *      invited email, the token to be unexpired/unrevoked, and writes
 *      workspace_members + accepted_at in one server-side action.
 *
 * Role rules: creating/revoking invites = owners/editors (canEditWorkspace);
 * listing = members; accepting = any signed-in user holding the token.
 * The existing workspace_members.role CHECK constraint is untouched.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "../server-auth";
import { auditApiCall } from "../api-keys/keys.server";
import { canEditWorkspace, canReadWorkspace, type WorkspaceRole } from "../agency/agency";
import { getWorkspaceRole } from "../agency/agency.functions";
import { str, strOrNull, untypedAdminDb, type UntypedDb } from "../supabase/untyped";
import {
  defaultInviteExpiry,
  generateInviteToken,
  hashInviteToken,
  isValidInviteTokenFormat,
  normalizeEmail,
} from "./invites";

type AdminClient = import("@supabase/supabase-js").SupabaseClient<
  import("@/integrations/supabase/types").Database
>;

async function admin(): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as AdminClient;
}

/** Untyped service-role client for tables missing from the generated types. */
async function udb(): Promise<UntypedDb> {
  return untypedAdminDb();
}

async function requireRole(
  workspaceId: string,
  userId: string,
  allowed: (role: WorkspaceRole | null) => boolean,
  action: string,
): Promise<WorkspaceRole> {
  const role = await getWorkspaceRole(await admin(), workspaceId, userId);
  if (role === null) throw new Error("Workspace not found");
  if (!allowed(role)) throw new Error(`Your role (${role}) cannot ${action}.`);
  return role;
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

async function auditInviteAction(
  workspaceId: string,
  actorUserId: string,
  action: string,
  inviteId: string | null,
  metadata?: Record<string, unknown>,
) {
  await auditApiCall(
    {
      workspaceId,
      actorUserId,
      action,
      entityType: "workspace_invite",
      entityId: inviteId,
      metadata: { via: "settings-ui", ...(metadata ?? {}) },
    },
    undefined,
  );
}

export interface InviteMeta {
  id: string;
  email: string;
  role: WorkspaceRole;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/** Best-effort invite email via the project's Resend REST pattern. */
async function sendInviteEmail(input: {
  to: string;
  workspaceName: string;
  role: WorkspaceRole;
  acceptUrl: string;
  inviterName: string | null;
}): Promise<{ emailed: boolean; emailError: string | null }> {
  const key = process.env["RESEND_API_KEY"];
  if (!key) return { emailed: false, emailError: "RESEND_API_KEY is not configured" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env["EMAIL_FROM"] ?? "Vidora <updates@vidora.ai>",
        to: [input.to],
        subject: `You're invited to join ${input.workspaceName} on Vidora`,
        text:
          `${input.inviterName ?? "A teammate"} invited you to join the workspace ` +
          `"${input.workspaceName}" on Vidora as ${input.role}.\n\n` +
          `Accept the invite (sign in or create an account first):\n${input.acceptUrl}\n\n` +
          `This link expires in 7 days.\n\n— Vidora`,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Resend API error (${res.status}): ${body.slice(0, 300)}`);
    }
    return { emailed: true, emailError: null };
  } catch (e) {
    return { emailed: false, emailError: e instanceof Error ? e.message : "send failed" };
  }
}

const createInviteSchema = z.object({
  workspaceId: z.string().uuid(),
  email: z.string().trim().email().max(200),
  role: z.enum(["owner", "editor", "viewer"]),
});

/** Create an invite — owners/editors only. Raw token returned ONCE. */
export const createInviteFn = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => createInviteSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const adminClient = await admin();
    const db = await udb();
    await requireRole(data.workspaceId, userId, canEditWorkspace, "invite members");
    await rateLimit(userId, "invites:create", 30, 3600, "You're sending invites too fast.");

    const email = normalizeEmail(data.email);

    // Already a member? Don't invite — point at MemberManager instead.
    const { data: profile } = await adminClient
      .from("profiles")
      .select("id")
      .ilike("email", email)
      .maybeSingle();
    if (profile) {
      const { data: existing } = await adminClient
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", data.workspaceId)
        .eq("user_id", profile.id)
        .maybeSingle();
      if (existing) throw new Error(`${email} is already a member of this workspace.`);
    }

    // One live invite per (workspace, email).
    const { data: pending } = await db
      .from("workspace_invites")
      .select("id, email, role, expires_at, created_at")
      .eq("workspace_id", data.workspaceId)
      .eq("email", email)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (pending) {
      throw new Error(
        `There's already a pending invite for ${email} (expires ${new Date(str(pending, "expires_at")).toLocaleDateString()}). Revoke it first to re-invite.`,
      );
    }

    const { data: workspace } = await adminClient
      .from("workspaces")
      .select("name")
      .eq("id", data.workspaceId)
      .single();

    const rawToken = generateInviteToken();
    const { data: invite, error } = await db
      .from("workspace_invites")
      .insert({
        workspace_id: data.workspaceId,
        email,
        role: data.role,
        token_hash: hashInviteToken(rawToken),
        invited_by: userId,
        expires_at: defaultInviteExpiry().toISOString(),
      })
      .select("id, email, role, expires_at, created_at")
      .single();
    if (error || !invite) throw new Error(error?.message ?? "Could not create the invite.");

    const acceptUrl = `${process.env["APP_URL"] ?? "https://vidoratube.lovable.app"}/invite/accept?token=${rawToken}`;
    const { emailed, emailError } = await sendInviteEmail({
      to: email,
      workspaceName: workspace?.name ?? "a workspace",
      role: data.role,
      acceptUrl,
      inviterName: null,
    });

    const inviteId = str(invite, "id");
    await auditInviteAction(data.workspaceId, userId, "workspace.invited", inviteId, {
      email,
      role: data.role,
      emailed,
      ...(emailError ? { email_error: emailError } : {}),
    });

    return {
      invite: {
        id: inviteId,
        email: str(invite, "email"),
        role: str(invite, "role") as WorkspaceRole,
        expires_at: str(invite, "expires_at"),
        accepted_at: null,
        revoked_at: null,
        created_at: str(invite, "created_at"),
      } satisfies InviteMeta,
      rawToken,
      emailed,
      emailError,
    };
  });

const workspaceSchema = z.object({ workspaceId: z.string().uuid() });

/** List invites for the workspace — members read (includes revoked/accepted for history). */
export const listInvitesFn = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => workspaceSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ invites: InviteMeta[] }> => {
    const { userId } = context;
    await requireRole(data.workspaceId, userId, canReadWorkspace, "view invites");
    const db = await udb();
    const { data: rows, error } = await db
      .from("workspace_invites")
      .select("id, email, role, expires_at, accepted_at, revoked_at, created_at")
      .eq("workspace_id", data.workspaceId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return {
      invites: (rows ?? []).map((r) => ({
        id: str(r, "id"),
        email: str(r, "email"),
        role: str(r, "role") as WorkspaceRole,
        expires_at: str(r, "expires_at"),
        accepted_at: strOrNull(r, "accepted_at"),
        revoked_at: strOrNull(r, "revoked_at"),
        created_at: str(r, "created_at"),
      })),
    };
  });

const revokeSchema = workspaceSchema.extend({ inviteId: z.string().uuid() });

/** Revoke an invite — owners/editors only. */
export const revokeInviteFn = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => revokeSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await requireRole(data.workspaceId, userId, canEditWorkspace, "revoke invites");
    const db = await udb();
    const { data: row, error } = await db
      .from("workspace_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.inviteId)
      .eq("workspace_id", data.workspaceId)
      .is("revoked_at", null)
      .is("accepted_at", null)
      .select("id, email")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Invite not found, already accepted, or already revoked.");
    await auditInviteAction(data.workspaceId, userId, "workspace.invite_revoked", str(row, "id"), {
      email: str(row, "email"),
    });
    return { ok: true };
  });

const tokenSchema = z.object({ token: z.string().min(1).max(80) });

interface LiveInvite {
  id: string;
  workspace_id: string;
  email: string;
  role: WorkspaceRole;
  workspaceName: string;
}

async function findLiveInvite(db: UntypedDb, rawToken: string): Promise<LiveInvite> {
  if (!isValidInviteTokenFormat(rawToken)) throw new Error("This invite link is invalid.");
  const { data: invite, error } = await db
    .from("workspace_invites")
    .select("id, workspace_id, email, role, expires_at, accepted_at, revoked_at")
    .eq("token_hash", hashInviteToken(rawToken))
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!invite) throw new Error("This invite link is invalid.");
  if (strOrNull(invite, "revoked_at")) throw new Error("This invite was revoked.");
  if (strOrNull(invite, "accepted_at")) throw new Error("This invite was already accepted.");
  if (new Date(str(invite, "expires_at")).getTime() < Date.now()) {
    throw new Error("This invite has expired. Ask for a new one.");
  }
  const workspaceId = str(invite, "workspace_id");
  // Workspace name for the preview (typed table).
  let workspaceName = "a workspace";
  try {
    const adminClient = await admin();
    const { data: ws } = await adminClient
      .from("workspaces")
      .select("name")
      .eq("id", workspaceId)
      .maybeSingle();
    if (ws?.name) workspaceName = ws.name;
  } catch {
    // Preview name is cosmetic; the invite itself is authoritative.
  }
  return {
    id: str(invite, "id"),
    workspace_id: workspaceId,
    email: str(invite, "email"),
    role: str(invite, "role") as WorkspaceRole,
    workspaceName,
  };
}

/** Preview for the accept page: workspace name, role, invited email. Token is the capability. */
export const getInvitePreviewFn = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => tokenSchema.parse(i))
  .handler(async ({ data }) => {
    const invite = await findLiveInvite(await udb(), data.token);
    return {
      workspaceName: invite.workspaceName,
      role: invite.role,
      email: invite.email,
    };
  });

/**
 * Accept an invite — explicit signed-in action. The account's email must
 * match the invited email; membership + accepted_at are written together.
 */
export const acceptInviteFn = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => tokenSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const adminClient = await admin();
    const db = await udb();
    await rateLimit(userId, "invites:accept", 20, 3600, "You're accepting invites too fast.");

    const invite = await findLiveInvite(db, data.token);

    const { data: authUser, error: authError } = await db.auth.admin.getUserById(userId);
    if (authError || !authUser?.user?.email)
      throw new Error("Could not verify your account email.");
    if (normalizeEmail(authUser.user.email) !== normalizeEmail(invite.email)) {
      throw new Error(
        `This invite is for ${invite.email}, but you're signed in as ${authUser.user.email}. ` +
          `Sign in with the invited email address first.`,
      );
    }

    const { data: existing } = await adminClient
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", invite.workspace_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (existing) {
      // Already a member: consume the invite without duplicating the row.
      await db
        .from("workspace_invites")
        .update({ accepted_at: new Date().toISOString() })
        .eq("id", invite.id);
      return { ok: true, workspaceId: invite.workspace_id, alreadyMember: true };
    }

    const { error: memberError } = await adminClient.from("workspace_members").insert({
      workspace_id: invite.workspace_id,
      user_id: userId,
      role: invite.role,
    });
    if (memberError) throw new Error(memberError.message);

    const { error: acceptError } = await db
      .from("workspace_invites")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", invite.id);
    if (acceptError) {
      // Membership exists; don't strand the user — log and continue.
      console.error("[invites] accepted_at write failed", invite.id, acceptError.message);
    }

    await auditInviteAction(invite.workspace_id, userId, "workspace.invite_accepted", invite.id, {
      email: invite.email,
      role: invite.role,
    });

    return { ok: true, workspaceId: invite.workspace_id, alreadyMember: false };
  });
