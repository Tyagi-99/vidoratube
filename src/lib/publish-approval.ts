/**
 * Sprint 7-8, workstream C — server-enforced human approval.
 *
 * Every platform publish must be traceable to a human approval record in the
 * `approvals` table. Approval rows are written ONLY by the server (service
 * role) inside approvePublishJob — there are no client INSERT/UPDATE/DELETE
 * RLS policies, so a client can never forge one.
 *
 * executePublishJob (the only path that uploads to a platform) calls
 * requirePublishApproval BEFORE touching the uploader. Missing approval =
 * hard rejection.
 */

/** Scopes an approval record can cover. Matches the approvals.scope CHECK. */
export const APPROVAL_SCOPES = [
  "youtube-public",
  "youtube-unlisted",
  "youtube-private",
  "instagram",
  "tiktok",
  "x",
  "facebook",
  "linkedin",
] as const;
export type ApprovalScope = (typeof APPROVAL_SCOPES)[number];

/** Maps a YouTube privacy setting to its approval scope. */
export function approvalScopeForPrivacy(privacy: string): ApprovalScope {
  switch (privacy) {
    case "public":
      return "youtube-public";
    case "unlisted":
      return "youtube-unlisted";
    case "private":
      return "youtube-private";
    default:
      throw new Error(`Unknown publish privacy: ${privacy}`);
  }
}

export interface ApprovalLookup {
  userId: string;
  publishJobId: string;
  scope: ApprovalScope;
}

/** True when a matching approval row exists. `admin` = service-role client. */
export async function hasPublishApproval(
  admin: any,
  { userId, publishJobId, scope }: ApprovalLookup,
): Promise<boolean> {
  const { data, error } = await admin
    .from("approvals")
    .select("id")
    .eq("user_id", userId)
    .eq("publish_job_id", publishJobId)
    .eq("scope", scope)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not verify publish approval: ${error.message}`);
  return data !== null;
}

/**
 * Hard requirement for every server publish path. Throws when no matching
 * human approval record exists — call this BEFORE any platform upload.
 */
export async function requirePublishApproval(
  admin: any,
  lookup: ApprovalLookup,
): Promise<void> {
  const ok = await hasPublishApproval(admin, lookup);
  if (!ok) {
    throw new Error(
      "This publish has no human approval on record. Approve it from the " +
        "publish pipeline first — publishing without approval is not allowed.",
    );
  }
}

export interface WarningRecord {
  userId: string;
  projectId: string;
  publishJobId: string;
  kind: string;
  message: string;
}

/** Records a publish warning for the audit trail (server-only writes). */
export async function recordPublishWarning(
  admin: any,
  warning: WarningRecord,
): Promise<void> {
  const { error } = await admin.from("publish_warnings").insert({
    user_id: warning.userId,
    project_id: warning.projectId,
    publish_job_id: warning.publishJobId,
    kind: warning.kind,
    message: warning.message,
  });
  if (error) throw new Error(`Could not record publish warning: ${error.message}`);
}

export interface ApprovalRecord {
  userId: string;
  projectId: string;
  videoId: string | null;
  publishJobId: string;
  approverId: string;
  scope: ApprovalScope;
  notes: string | null;
}

/** Writes the human approval record (server-only; called by approvePublishJob). */
export async function recordApproval(
  admin: any,
  approval: ApprovalRecord,
): Promise<void> {
  const { error } = await admin.from("approvals").insert({
    user_id: approval.userId,
    project_id: approval.projectId,
    video_id: approval.videoId,
    publish_job_id: approval.publishJobId,
    approver_id: approval.approverId,
    scope: approval.scope,
    notes: approval.notes,
  });
  if (error) throw new Error(`Could not record the approval: ${error.message}`);
}
