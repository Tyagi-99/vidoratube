import { z } from "zod";

/**
 * Sprint 7-8 (workstream E: agency tier) — pure agency domain logic.
 *
 * Everything in this module is side-effect free so it can be unit-tested
 * without a database. Server functions in agency.functions.ts do the I/O
 * and must enforce the same rules against the database.
 */

export type WorkspaceRole = "owner" | "editor" | "viewer";
export type WorkspacePlanTier = "free" | "creator" | "studio";
export type ApprovalStatus = "pending" | "approved" | "rejected";

const ROLE_RANK: Record<WorkspaceRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return value === "owner" || value === "editor" || value === "viewer";
}

/** Any workspace member (including the viewer/client) can read. */
export function canReadWorkspace(role: WorkspaceRole | null | undefined): boolean {
  return isWorkspaceRole(role);
}

/**
 * Owners and editors can mutate workspace data (channels, brand kit,
 * schedules). Viewers (the client side) cannot edit — they only approve.
 */
export function canEditWorkspace(role: WorkspaceRole | null | undefined): boolean {
  return isWorkspaceRole(role) && ROLE_RANK[role] >= ROLE_RANK.editor;
}

/** Only owners manage the member roster and the workspace itself. */
export function canManageMembers(role: WorkspaceRole | null | undefined): boolean {
  return role === "owner";
}

/** Only owners/editors request an approval (viewers are the approvers). */
export function canRequestApproval(role: WorkspaceRole | null | undefined): boolean {
  return isWorkspaceRole(role) && ROLE_RANK[role] >= ROLE_RANK.editor;
}

/**
 * Any member — including the viewer/client — can record an approval
 * decision. This is the client-side approval the agency workflow is built on.
 */
export function canDecideApproval(role: WorkspaceRole | null | undefined): boolean {
  return isWorkspaceRole(role);
}

// ---------------------------------------------------------------------------
// White-label / watermark gating
// ---------------------------------------------------------------------------

/**
 * Paid tiers export WITHOUT the Vidora watermark; the free tier keeps it.
 * Single source of truth for the gating decision — the worker reads the
 * resolved `watermark` flag from the render job meta, and this function is
 * what the enqueue path uses to resolve it from the workspace plan tier.
 */
export function watermarkEnabledForTier(tier: WorkspacePlanTier): boolean {
  return tier === "free";
}

// ---------------------------------------------------------------------------
// Brand kit
// ---------------------------------------------------------------------------

/** Normalize a CSS hex color to uppercase #RRGGBB; null when invalid. */
export function normalizeHexColor(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = input.trim();
  const m = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(s);
  if (!m) return null;
  const hex = m[1]!;
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  return `#${full.toUpperCase()}`;
}

export const FONT_CHOICES = ["Inter", "Syne", "JetBrains Mono", "Newsreader", "Georgia", "Helvetica"] as const;

export const brandKitSchema = z.object({
  logoPath: z.string().max(500).nullable().default(null),
  primaryColor: z
    .string()
    .refine((v) => normalizeHexColor(v) !== null, "primaryColor must be a hex color like #F59E0B"),
  secondaryColor: z
    .string()
    .refine((v) => normalizeHexColor(v) !== null, "secondaryColor must be a hex color like #111827"),
  fontFamily: z.string().trim().min(1).max(60),
});

export type BrandKitInput = z.infer<typeof brandKitSchema>;

/**
 * A logo path is safe when it stays inside the workspace's own folder and
 * contains no traversal. Render workers download the logo via the
 * service-role client, so the path is also the authorization boundary.
 */
export function isSafeLogoPath(logoPath: string | null | undefined, workspaceId: string): boolean {
  if (logoPath == null || logoPath === "") return true;
  if (logoPath.includes("..") || logoPath.includes("\\")) return false;
  if (logoPath.startsWith("/") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(logoPath)) return false;
  return logoPath.startsWith(`${workspaceId}/`);
}

// ---------------------------------------------------------------------------
// Render-job export meta (brand kit + watermark applied to exports)
// ---------------------------------------------------------------------------

export interface BrandOverlay {
  primaryColor: string;
  secondaryColor: string;
  logoPath: string | null;
  fontFamily: string;
}

export interface ResolvedExportMeta {
  /** True on the free tier: the worker burns the Vidora watermark. */
  watermark: boolean;
  /** Brand overlay passed into the render job meta; null without a kit. */
  brandOverlay: BrandOverlay | null;
}

/**
 * Resolve what the render worker should do for a workspace's export:
 * free tier keeps the Vidora watermark; paid tiers drop it; a saved brand
 * kit is always threaded into the job meta so the pipeline can style the
 * export with the client's colors/logo.
 */
export function resolveExportMeta(args: {
  planTier: WorkspacePlanTier;
  brandKit: {
    primary_color: string;
    secondary_color: string;
    logo_path: string | null;
    font_family: string;
  } | null;
}): ResolvedExportMeta {
  const watermark = watermarkEnabledForTier(args.planTier);
  const brandOverlay: BrandOverlay | null = args.brandKit
    ? {
        primaryColor: normalizeHexColor(args.brandKit.primary_color) ?? "#F59E0B",
        secondaryColor: normalizeHexColor(args.brandKit.secondary_color) ?? "#111827",
        logoPath: args.brandKit.logo_path,
        fontFamily: args.brandKit.font_family,
      }
    : null;
  return { watermark, brandOverlay };
}

// ---------------------------------------------------------------------------
// Bulk scheduling
// ---------------------------------------------------------------------------

export const PLATFORM_VALUES = ["youtube", "facebook", "instagram", "x", "tiktok", "linkedin"] as const;

export const bulkScheduleItemSchema = z.object({
  projectId: z.string().uuid(),
  videoJobId: z.string().uuid(),
  clientChannelId: z.string().uuid(),
  /** ISO datetime; must be in the future so nothing schedules in the past. */
  scheduledFor: z.string().datetime(),
  title: z.string().trim().min(1).max(100).optional(),
});

export type BulkScheduleItem = z.infer<typeof bulkScheduleItemSchema>;

export const bulkScheduleSchema = z.object({
  workspaceId: z.string().uuid(),
  items: z.array(bulkScheduleItemSchema).min(1).max(50),
});

export type BulkScheduleInput = z.infer<typeof bulkScheduleSchema>;

/**
 * Cross-item validation the zod schema can't express: no two items may book
 * the same channel at the same minute (double-publish collision), the same
 * video may not be scheduled twice in one batch, and every scheduled time
 * must be in the future.
 */
export function validateBulkSchedule(
  input: BulkScheduleInput,
  now: Date = new Date(),
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const seenChannelSlot = new Set<string>();
  const seenVideo = new Set<string>();
  for (let i = 0; i < input.items.length; i++) {
    const item = input.items[i]!;
    const when = new Date(item.scheduledFor);
    if (Number.isNaN(when.getTime())) {
      errors.push(`item ${i}: scheduledFor is not a valid datetime`);
      continue;
    }
    if (when.getTime() <= now.getTime()) {
      errors.push(`item ${i}: scheduledFor must be in the future`);
    }
    const slot = `${item.clientChannelId}@${when.toISOString().slice(0, 16)}`;
    if (seenChannelSlot.has(slot)) {
      errors.push(`item ${i}: channel is already booked at ${when.toISOString()}`);
    }
    seenChannelSlot.add(slot);
    if (seenVideo.has(item.videoJobId)) {
      errors.push(`item ${i}: video is already scheduled in this batch`);
    }
    seenVideo.add(item.videoJobId);
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * Build one publish_jobs insert row for a bulk-schedule item.
 *
 * Bulk-scheduled rows are ALWAYS created as drafts: they are gated by the
 * workspace approval workflow and can never auto-publish. The approval
 * happens through workspace_approvals (client decides) before the existing
 * publish pipeline's human approval gate.
 */
export function buildBulkScheduledRow(args: {
  userId: string;
  workspaceId: string;
  item: BulkScheduleItem;
}): {
  user_id: string;
  project_id: string;
  video_job_id: string;
  workspace_id: string;
  client_channel_id: string;
  status: "draft";
  scheduled_for: string;
  title: string | null;
} {
  return {
    user_id: args.userId,
    project_id: args.item.projectId,
    video_job_id: args.item.videoJobId,
    workspace_id: args.workspaceId,
    client_channel_id: args.item.clientChannelId,
    status: "draft",
    scheduled_for: args.item.scheduledFor,
    title: args.item.title ?? null,
  };
}

// ---------------------------------------------------------------------------
// Approval workflow transitions
// ---------------------------------------------------------------------------

/**
 * Whether an approval may move from one status to another, and whether the
 * actor's role is allowed to perform it. Only pending approvals can be
 * decided; decided approvals are terminal (a new request is needed to
 * re-approve after changes).
 */
export function canDecideWorkspaceApproval(args: {
  currentStatus: ApprovalStatus;
  nextStatus: ApprovalStatus;
  actorRole: WorkspaceRole | null | undefined;
}): boolean {
  if (args.currentStatus !== "pending") return false;
  if (args.nextStatus !== "approved" && args.nextStatus !== "rejected") return false;
  return canDecideApproval(args.actorRole);
}
