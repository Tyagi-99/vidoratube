import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "../server-auth";
import { auditSafely } from "../audit-log.server";
import {
  brandKitSchema,
  buildBulkScheduledRow,
  bulkScheduleSchema,
  canDecideWorkspaceApproval,
  canEditWorkspace,
  canManageMembers,
  canRequestApproval,
  isSafeLogoPath,
  isWorkspaceRole,
  normalizeHexColor,
  resolveExportMeta,
  validateBulkSchedule,
  type ApprovalStatus,
  type BrandOverlay,
  type WorkspacePlanTier,
  type WorkspaceRole,
} from "./agency";

/**
 * Sprint 7-8 (workstream E: agency tier) — workspace server functions.
 *
 * Security shape: every function authenticates via requireAppUser, resolves
 * the caller's workspace role through the service-role client, and enforces
 * the role rules from agency.ts (pure, unit-tested). Reads/writes go through
 * supabaseAdmin so workspace-scoped rows (which belong to another user_id)
 * are reachable; the membership check is the authorization boundary, and the
 * RLS policies in the migration enforce the same boundary for direct
 * client-token access.
 */

type AdminClient = import("@supabase/supabase-js").SupabaseClient<
  import("@/integrations/supabase/types").Database
>;

async function admin(): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as AdminClient;
}

/** The caller's role in a workspace, or null for non-members. */
export async function getWorkspaceRole(
  adminClient: AdminClient,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> {
  const { data } = await adminClient
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  const role = (data as { role?: unknown } | null)?.role;
  return isWorkspaceRole(role) ? role : null;
}

async function requireWorkspaceRole(
  adminClient: AdminClient,
  workspaceId: string,
  userId: string,
  allowed: (role: WorkspaceRole | null) => boolean,
  action: string,
): Promise<WorkspaceRole> {
  const role = await getWorkspaceRole(adminClient, workspaceId, userId);
  if (role === null) {
    throw new Error("Workspace not found");
  }
  if (!allowed(role)) {
    throw new Error(`Your role (${role}) cannot ${action}.`);
  }
  return role;
}

async function rateLimit(
  userId: string,
  key: string,
  max: number,
  windowSeconds: number,
  message: string,
) {
  const adminClient = await admin();
  const { enforcePostgresRateLimit } = await import("../rate-limit");
  await enforcePostgresRateLimit(adminClient, `${key}:${userId}`, { max, windowSeconds }, message);
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

/** Create a workspace; the caller becomes its owner. */
export const createWorkspace = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => createWorkspaceSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const adminClient = await admin();
    await rateLimit(
      userId,
      "agency:workspace:create",
      10,
      3600,
      "You're creating workspaces too fast.",
    );

    const { data: workspace, error: wsError } = await adminClient
      .from("workspaces")
      .insert({ name: data.name, owner_id: userId, plan_tier: "free" })
      .select()
      .single();
    if (wsError || !workspace) throw new Error(wsError?.message ?? "Could not create workspace");

    const ws = workspace as { id: string };
    const { error: memberError } = await adminClient.from("workspace_members").insert({
      workspace_id: ws.id,
      user_id: userId,
      role: "owner",
    });
    if (memberError) throw new Error(memberError.message);

    // The workspace creator becomes its owner (default role bootstrap).
    await auditSafely({
      workspaceId: ws.id,
      actorUserId: userId,
      action: "workspace.created",
      entityType: "workspace",
      entityId: ws.id,
      metadata: { name: data.name },
    });

    // Every workspace starts with a default brand kit so exports always
    // have brand meta to thread into render jobs.
    await adminClient.from("brand_kits").insert({ workspace_id: ws.id });

    return { workspace };
  });

/** Workspaces the caller belongs to, with their role in each. */
export const listWorkspaces = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .handler(async ({ context }) => {
    const { userId } = context;
    const adminClient = await admin();
    const { data: memberships, error } = await adminClient
      .from("workspace_members")
      .select("role, workspace_id, workspaces(id, name, plan_tier, created_at)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return {
      workspaces: (memberships ?? []).map((m) => ({
        id: m.workspaces?.id ?? m.workspace_id,
        name: m.workspaces?.name ?? "Workspace",
        plan_tier: m.workspaces?.plan_tier ?? "free",
        created_at: m.workspaces?.created_at ?? null,
        role: m.role as WorkspaceRole,
      })),
    };
  });

const workspaceIdSchema = z.object({ workspaceId: z.string().uuid() });

/** One workspace with the caller's role; members only. */
export const getWorkspace = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => workspaceIdSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const adminClient = await admin();
    const role = await requireWorkspaceRole(
      adminClient,
      data.workspaceId,
      userId,
      (r) => r !== null,
      "view this workspace",
    );
    const { data: workspace, error } = await adminClient
      .from("workspaces")
      .select("id, name, owner_id, plan_tier, created_at")
      .eq("id", data.workspaceId)
      .single();
    if (error || !workspace) throw new Error("Workspace not found");
    const { count } = await adminClient
      .from("workspace_members")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", data.workspaceId);
    return { workspace, role, memberCount: count ?? 0 };
  });

const updateWorkspaceSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
});

/** Rename a workspace — owners only. */
export const updateWorkspace = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => updateWorkspaceSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const adminClient = await admin();
    await requireWorkspaceRole(
      adminClient,
      data.workspaceId,
      userId,
      (r) => r === "owner",
      "rename this workspace",
    );
    const { data: workspace, error } = await adminClient
      .from("workspaces")
      .update({ name: data.name })
      .eq("id", data.workspaceId)
      .select()
      .single();
    if (error || !workspace) throw new Error(error?.message ?? "Could not rename workspace");
    return { workspace };
  });

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

const addMemberSchema = z.object({
  workspaceId: z.string().uuid(),
  email: z.string().trim().email().max(200),
  role: z.enum(["owner", "editor", "viewer"]).default("viewer"),
});

/**
 * Add a member by email — owners only. The client (viewer) is invited this
 * way; they approve content but can never edit workspace data.
 */
export const addMember = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => addMemberSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const adminClient = await admin();
    await requireWorkspaceRole(
      adminClient,
      data.workspaceId,
      userId,
      canManageMembers,
      "manage members",
    );
    await rateLimit(userId, "agency:member:add", 30, 3600, "You're adding members too fast.");

    // Resolve the invitee's user id from their email (small user base;
    // paginated scan, no raw credential handling).
    let inviteeId: string | null = null;
    let page = 1;
    for (;;) {
      const { data: pageData, error } = await adminClient.auth.admin.listUsers({
        page,
        perPage: 100,
      });
      if (error) throw new Error(error.message);
      const found = pageData.users.find((u) => u.email?.toLowerCase() === data.email.toLowerCase());
      if (found) {
        inviteeId = found.id;
        break;
      }
      if (pageData.users.length < 100 || page >= 10) break;
      page += 1;
    }
    if (!inviteeId)
      throw new Error("No Vidora account found for that email. Ask them to sign up first.");

    const { data: member, error } = await adminClient
      .from("workspace_members")
      .upsert(
        { workspace_id: data.workspaceId, user_id: inviteeId, role: data.role },
        { onConflict: "workspace_id,user_id" },
      )
      .select()
      .single();
    if (error || !member) throw new Error(error?.message ?? "Could not add member");

    await auditSafely({
      workspaceId: data.workspaceId,
      actorUserId: userId,
      action: "member.invited",
      entityType: "workspace_member",
      entityId: (member as { id: string }).id,
      metadata: { invitedUserId: inviteeId, email: data.email, role: data.role },
    });
    return { member };
  });

const memberTargetSchema = z.object({
  workspaceId: z.string().uuid(),
  memberUserId: z.string().uuid(),
});

const updateMemberRoleSchema = memberTargetSchema.extend({
  role: z.enum(["owner", "editor", "viewer"]),
});

/** Change a member's role — owners only; the last owner cannot be demoted. */
export const updateMemberRole = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => updateMemberRoleSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const adminClient = await admin();
    await requireWorkspaceRole(
      adminClient,
      data.workspaceId,
      userId,
      canManageMembers,
      "manage members",
    );

    const { data: current } = await adminClient
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", data.workspaceId)
      .eq("user_id", data.memberUserId)
      .maybeSingle();
    if (!current) throw new Error("Member not found");
    const previousRole = (current as { role: string }).role;

    if (data.role !== "owner") {
      const { count } = await adminClient
        .from("workspace_members")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", data.workspaceId)
        .eq("role", "owner")
        .neq("user_id", data.memberUserId);
      if ((count ?? 0) === 0) {
        throw new Error("A workspace must keep at least one owner.");
      }
    }
    const { data: member, error } = await adminClient
      .from("workspace_members")
      .update({ role: data.role })
      .eq("workspace_id", data.workspaceId)
      .eq("user_id", data.memberUserId)
      .select()
      .single();
    if (error || !member) throw new Error(error?.message ?? "Member not found");

    await auditSafely({
      workspaceId: data.workspaceId,
      actorUserId: userId,
      action: "member.role_changed",
      entityType: "workspace_member",
      entityId: (member as { id: string }).id,
      metadata: { memberUserId: data.memberUserId, from: previousRole, to: data.role },
    });
    return { member };
  });

/** Remove a member — owners only; the last owner cannot be removed. */
export const removeMember = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => memberTargetSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const adminClient = await admin();
    await requireWorkspaceRole(
      adminClient,
      data.workspaceId,
      userId,
      canManageMembers,
      "manage members",
    );

    const { data: target } = await adminClient
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", data.workspaceId)
      .eq("user_id", data.memberUserId)
      .maybeSingle();
    if (!target) throw new Error("Member not found");
    if ((target as { role: string }).role === "owner") {
      const { count } = await adminClient
        .from("workspace_members")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", data.workspaceId)
        .eq("role", "owner");
      if ((count ?? 1) <= 1) throw new Error("A workspace must keep at least one owner.");
    }
    const { error } = await adminClient
      .from("workspace_members")
      .delete()
      .eq("workspace_id", data.workspaceId)
      .eq("user_id", data.memberUserId);
    if (error) throw new Error(error.message);

    await auditSafely({
      workspaceId: data.workspaceId,
      actorUserId: userId,
      action: "member.removed",
      entityType: "workspace_member",
      entityId: null,
      metadata: { removedUserId: data.memberUserId, role: (target as { role: string }).role },
    });
    return { removed: true };
  });

// ---------------------------------------------------------------------------
// Client channels
// ---------------------------------------------------------------------------

const createChannelSchema = z.object({
  workspaceId: z.string().uuid(),
  platform: z.enum(["youtube", "facebook", "instagram", "x", "tiktok", "linkedin"]),
  handle: z.string().trim().min(1).max(120),
  isTestChannel: z.boolean().default(false),
});

/** Link a publishing destination to a workspace — owners/editors. */
export const createClientChannel = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => createChannelSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const adminClient = await admin();
    await requireWorkspaceRole(
      adminClient,
      data.workspaceId,
      userId,
      canEditWorkspace,
      "manage channels",
    );
    const { data: channel, error } = await adminClient
      .from("client_channels")
      .insert({
        workspace_id: data.workspaceId,
        platform: data.platform,
        handle: data.handle,
        is_test_channel: data.isTestChannel,
      })
      .select()
      .single();
    if (error || !channel) throw new Error(error?.message ?? "Could not add channel");
    return { channel };
  });

/** List a workspace's channels — any member. */
export const listClientChannels = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => workspaceIdSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const adminClient = await admin();
    await requireWorkspaceRole(
      adminClient,
      data.workspaceId,
      userId,
      (r) => r !== null,
      "view channels",
    );
    const { data: channels, error } = await adminClient
      .from("client_channels")
      .select("id, platform, handle, is_test_channel, created_at")
      .eq("workspace_id", data.workspaceId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { channels: channels ?? [] };
  });

const deleteChannelSchema = z.object({
  workspaceId: z.string().uuid(),
  channelId: z.string().uuid(),
});

/** Unlink a channel — owners/editors. */
export const deleteClientChannel = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => deleteChannelSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const adminClient = await admin();
    await requireWorkspaceRole(
      adminClient,
      data.workspaceId,
      userId,
      canEditWorkspace,
      "manage channels",
    );
    const { error } = await adminClient
      .from("client_channels")
      .delete()
      .eq("id", data.channelId)
      .eq("workspace_id", data.workspaceId);
    if (error) throw new Error(error.message);
    return { deleted: true };
  });

// ---------------------------------------------------------------------------
// Brand kits
// ---------------------------------------------------------------------------

/**
 * Read the workspace brand kit — any member. Includes a short-lived signed
 * logo URL when a logo is set.
 */
export const getBrandKit = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => workspaceIdSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const adminClient = await admin();
    await requireWorkspaceRole(
      adminClient,
      data.workspaceId,
      userId,
      (r) => r !== null,
      "view the brand kit",
    );
    const { data: kit, error } = await adminClient
      .from("brand_kits")
      .select(
        "id, workspace_id, logo_path, primary_color, secondary_color, font_family, updated_at",
      )
      .eq("workspace_id", data.workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    let logoUrl: string | null = null;
    const logoPath = (kit as { logo_path?: string | null } | null)?.logo_path ?? null;
    if (logoPath) {
      const { data: signed } = await adminClient.storage
        .from("brand-logos")
        .createSignedUrl(logoPath, 3600);
      logoUrl = signed?.signedUrl ?? null;
    }
    return { brandKit: kit, logoUrl };
  });

const updateBrandKitSchema = z.object({
  workspaceId: z.string().uuid(),
  brandKit: brandKitSchema,
});

/** Edit the brand kit — owners/editors only (viewers cannot). */
export const updateBrandKit = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => updateBrandKitSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const adminClient = await admin();
    await requireWorkspaceRole(
      adminClient,
      data.workspaceId,
      userId,
      canEditWorkspace,
      "edit the brand kit",
    );

    const kit = data.brandKit;
    if (!isSafeLogoPath(kit.logoPath, data.workspaceId)) {
      throw new Error("Invalid logo path.");
    }
    const primaryColor = normalizeHexColor(kit.primaryColor);
    const secondaryColor = normalizeHexColor(kit.secondaryColor);
    if (!primaryColor || !secondaryColor) {
      throw new Error("Brand colors must be hex values like #F59E0B.");
    }
    const { data: updated, error } = await adminClient
      .from("brand_kits")
      .update({
        logo_path: kit.logoPath,
        primary_color: primaryColor,
        secondary_color: secondaryColor,
        font_family: kit.fontFamily.trim(),
      })
      .eq("workspace_id", data.workspaceId)
      .select()
      .single();
    if (error || !updated) throw new Error(error?.message ?? "Could not save brand kit");
    return { brandKit: updated };
  });

const uploadLogoSchema = z.object({
  workspaceId: z.string().uuid(),
  /** Base64-encoded image bytes (PNG/JPEG/WebP, ≤ 2 MB). */
  fileBase64: z.string().min(1).max(4_000_000),
  contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
});

/**
 * Upload the brand logo — owners/editors only. Stored privately in the
 * brand-logos bucket at `<workspaceId>/logo.<ext>`; the worker downloads it
 * via the service-role client at render time.
 */
export const uploadBrandLogo = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => uploadLogoSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const adminClient = await admin();
    await requireWorkspaceRole(
      adminClient,
      data.workspaceId,
      userId,
      canEditWorkspace,
      "edit the brand kit",
    );
    await rateLimit(userId, "agency:logo:upload", 20, 3600, "You're uploading logos too fast.");

    const bytes = Buffer.from(data.fileBase64, "base64");
    if (bytes.length === 0 || bytes.length > 2 * 1024 * 1024) {
      throw new Error("Logo must be a non-empty image under 2 MB.");
    }
    const ext =
      data.contentType === "image/png" ? "png" : data.contentType === "image/webp" ? "webp" : "jpg";
    const path = `${data.workspaceId}/logo.${ext}`;
    const { error: uploadError } = await adminClient.storage
      .from("brand-logos")
      .upload(path, bytes, { contentType: data.contentType, upsert: true });
    if (uploadError) throw new Error(uploadError.message);

    const { error: kitError } = await adminClient
      .from("brand_kits")
      .update({ logo_path: path })
      .eq("workspace_id", data.workspaceId);
    if (kitError) throw new Error(kitError.message);
    return { logoPath: path };
  });

// ---------------------------------------------------------------------------
// Bulk scheduling (always drafts — gated by approvals, never auto-publish)
// ---------------------------------------------------------------------------

/**
 * Schedule multiple videos across client channels in one action.
 * Every item becomes a DRAFT publish job + a pending workspace approval;
 * nothing publishes until the client approves and the publish pipeline's
 * own human gate runs.
 */
export const bulkSchedule = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => bulkScheduleSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const adminClient = await admin();
    await requireWorkspaceRole(
      adminClient,
      data.workspaceId,
      userId,
      canEditWorkspace,
      "schedule videos",
    );
    await rateLimit(userId, "agency:bulk-schedule", 20, 3600, "You're scheduling too fast.");

    const crossCheck = validateBulkSchedule(data);
    if (!crossCheck.ok) {
      throw new Error(crossCheck.errors.join("; "));
    }

    // Every channel must belong to this workspace.
    const channelIds = [...new Set(data.items.map((i) => i.clientChannelId))];
    const { data: channels, error: chError } = await adminClient
      .from("client_channels")
      .select("id")
      .eq("workspace_id", data.workspaceId)
      .in("id", channelIds);
    if (chError) throw new Error(chError.message);
    if ((channels ?? []).length !== channelIds.length) {
      throw new Error("One or more channels don't belong to this workspace.");
    }

    // Every video must be a finished render owned by the caller.
    // (video_jobs has no project column by design — the operator picks the
    // project per item, and project ownership is checked separately below.)
    const videoIds = [...new Set(data.items.map((i) => i.videoJobId))];
    const { data: videos, error: vidError } = await adminClient
      .from("video_jobs")
      .select("id, status, result_url")
      .in("id", videoIds)
      .eq("user_id", userId);
    if (vidError) throw new Error(vidError.message);
    const byId = new Map((videos ?? []).map((v) => [v.id, v]));
    for (const item of data.items) {
      const v = byId.get(item.videoJobId);
      if (!v) throw new Error("Video not found or not yours.");
      if (v.status !== "completed" || !v.result_url) {
        throw new Error("All videos must be finished renders before scheduling.");
      }
    }

    // Every project must belong to the caller.
    const projectIds = [...new Set(data.items.map((i) => i.projectId))];
    const { data: projects, error: projError } = await adminClient
      .from("projects")
      .select("id")
      .in("id", projectIds)
      .eq("user_id", userId);
    if (projError) throw new Error(projError.message);
    if ((projects ?? []).length !== projectIds.length) {
      throw new Error("One or more projects don't belong to you.");
    }

    const rows = data.items.map((item) =>
      buildBulkScheduledRow({ userId, workspaceId: data.workspaceId, item }),
    );
    const { data: created, error: insertError } = await adminClient
      .from("publish_jobs")
      .insert(rows)
      .select("id");
    if (insertError || !created)
      throw new Error(insertError?.message ?? "Could not schedule videos");
    const createdJobs = created as { id: string }[];

    // Gate every scheduled draft behind a client approval. If the approval
    // insert fails, remove the draft jobs again so no ungated draft survives.
    const approvals = createdJobs.map((job) => ({
      workspace_id: data.workspaceId,
      publish_job_id: job.id,
      requested_by: userId,
      status: "pending" as const,
    }));
    const { error: approvalError } = await adminClient
      .from("workspace_approvals")
      .insert(approvals);
    if (approvalError) {
      await adminClient
        .from("publish_jobs")
        .delete()
        .in(
          "id",
          createdJobs.map((j) => j.id),
        );
      throw new Error(approvalError.message);
    }

    return { scheduled: createdJobs.length, publishJobIds: createdJobs.map((j) => j.id) };
  });

// ---------------------------------------------------------------------------
// Approval workflow
// ---------------------------------------------------------------------------

const requestApprovalSchema = z.object({
  workspaceId: z.string().uuid(),
  publishJobId: z.string().uuid(),
});

/**
 * Request client approval for a workspace publish job — owners/editors.
 * The job must be a draft scoped to this workspace.
 */
export const requestApproval = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => requestApprovalSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const adminClient = await admin();
    await requireWorkspaceRole(
      adminClient,
      data.workspaceId,
      userId,
      canRequestApproval,
      "request approvals",
    );

    const { data: job } = await adminClient
      .from("publish_jobs")
      .select("id, status")
      .eq("id", data.publishJobId)
      .eq("workspace_id", data.workspaceId)
      .maybeSingle();
    if (!job) throw new Error("Publish job not found in this workspace.");
    if ((job as { status: string }).status !== "draft") {
      throw new Error("Only draft jobs can be sent for approval.");
    }

    const { data: approval, error } = await adminClient
      .from("workspace_approvals")
      .upsert(
        {
          workspace_id: data.workspaceId,
          publish_job_id: data.publishJobId,
          requested_by: userId,
          status: "pending" as const,
        },
        { onConflict: "publish_job_id" },
      )
      .select()
      .single();
    if (error || !approval) throw new Error(error?.message ?? "Could not request approval");
    return { approval };
  });

const listApprovalsSchema = z.object({
  workspaceId: z.string().uuid(),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
});

/** List approvals for a workspace — any member. */
export const listApprovals = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => listApprovalsSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const adminClient = await admin();
    await requireWorkspaceRole(
      adminClient,
      data.workspaceId,
      userId,
      (r) => r !== null,
      "view approvals",
    );
    let query = adminClient
      .from("workspace_approvals")
      .select("id, publish_job_id, status, requested_by, decided_by, decided_at, note, created_at")
      .eq("workspace_id", data.workspaceId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (data.status) query = query.eq("status", data.status);
    const { data: approvals, error } = await query;
    if (error) throw new Error(error.message);
    const rows = (approvals ?? []) as {
      id: string;
      publish_job_id: string;
      status: string;
      requested_by: string;
      decided_by: string | null;
      decided_at: string | null;
      note: string | null;
      created_at: string;
    }[];
    // Integration with the server-enforced publish gate (D62): surface
    // whether each job already has an `approvals` record (the sibling
    // safety workstream's table, written only by approvePublishJob). A
    // client "approved" here is sign-off; the publish still needs the
    // pipeline's human gate before executePublishJob will run.
    let publishApprovedByJob = new Map<string, boolean>();
    if (rows.length > 0) {
      const { data: serverApprovals } = await adminClient
        .from("approvals")
        .select("publish_job_id")
        .in(
          "publish_job_id",
          rows.map((r) => r.publish_job_id),
        );
      publishApprovedByJob = new Map(
        ((serverApprovals ?? []) as { publish_job_id: string }[]).map((a) => [
          a.publish_job_id,
          true,
        ]),
      );
    }
    return {
      approvals: rows.map((r) => ({
        ...r,
        publishGateApproved: publishApprovedByJob.get(r.publish_job_id) ?? false,
      })),
    };
  });

const decideApprovalSchema = z.object({
  approvalId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(500).optional(),
});

/**
 * The client-side approval: any workspace member (typically the viewer /
 * client) records their decision. The decision is attributed to the caller
 * (decided_by = caller) — nobody can approve as someone else. Decided
 * approvals are terminal.
 *
 * INTEGRATION POINT (D62): this is the agency workflow API — the CLIENT
 * sign-off stage. It is intentionally separate from the sibling safety
 * workstream's server-enforced `approvals` table (written ONLY inside
 * approvePublishJob via recordApproval; see src/lib/publish-approval.ts).
 * After the client approves here, the agency still runs the normal
 * approvePublishJob human gate, which writes the server-enforced approval
 * record that executePublishJob requires. This function never writes to
 * `approvals` — only the publish pipeline's human gate does.
 */
export const decideApproval = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => decideApprovalSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const adminClient = await admin();

    const { data: approval } = await adminClient
      .from("workspace_approvals")
      .select("id, workspace_id, status")
      .eq("id", data.approvalId)
      .maybeSingle();
    if (!approval) throw new Error("Approval not found.");
    const row = approval as { workspace_id: string; status: ApprovalStatus };

    const role = await getWorkspaceRole(adminClient, row.workspace_id, userId);
    if (
      !canDecideWorkspaceApproval({
        currentStatus: row.status,
        nextStatus: data.decision,
        actorRole: role,
      })
    ) {
      throw new Error(
        row.status !== "pending"
          ? "This approval has already been decided."
          : "Workspace not found",
      );
    }

    const { data: decided, error } = await adminClient
      .from("workspace_approvals")
      .update({
        status: data.decision,
        decided_by: userId,
        decided_at: new Date().toISOString(),
        note: data.note ?? null,
      })
      .eq("id", data.approvalId)
      .eq("status", "pending")
      .select()
      .single();
    if (error || !decided) throw new Error(error?.message ?? "Could not record decision");
    return { approval: decided };
  });

// ---------------------------------------------------------------------------
// Export meta resolution (used by the render enqueue path)
// ---------------------------------------------------------------------------

/** Workspace plan tier — used for white-label gating at enqueue time. */
export async function getWorkspacePlanTier(
  adminClient: AdminClient,
  workspaceId: string,
): Promise<WorkspacePlanTier> {
  const { data } = await adminClient
    .from("workspaces")
    .select("plan_tier")
    .eq("id", workspaceId)
    .maybeSingle();
  const tier = (data as { plan_tier?: unknown } | null)?.plan_tier;
  return tier === "creator" || tier === "studio" ? tier : "free";
}

/**
 * Resolve the render export meta for a workspace: watermark flag from the
 * plan tier, brand overlay from the brand kit. Callers must verify workspace
 * membership first (all server-function callers above do).
 */
export async function resolveWorkspaceExportMeta(
  adminClient: AdminClient,
  workspaceId: string,
): Promise<{ watermark: boolean; brandOverlay: BrandOverlay | null }> {
  const planTier = await getWorkspacePlanTier(adminClient, workspaceId);
  const { data: kit } = await adminClient
    .from("brand_kits")
    .select("primary_color, secondary_color, logo_path, font_family")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return resolveExportMeta({
    planTier,
    brandKit:
      (kit as {
        primary_color: string;
        secondary_color: string;
        logo_path: string | null;
        font_family: string;
      } | null) ?? null,
  });
}
