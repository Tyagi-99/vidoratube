/**
 * Sprint 7–8 (workstream A): publishing guardrails shared by every adapter.
 *
 * Three gates, applied in order before any upload executes:
 *
 * 1. TEST-ACCOUNT GATE — adapters only ever publish to founder-designated test
 *    channels/accounts. The designation is config (env vars), never user input.
 *    When the config is missing, publishing is DISABLED with a clear
 *    user-facing message — never silently, never falling back to a real
 *    channel. When the connected account doesn't match the designated test
 *    account, the upload is refused.
 * 2. APPROVAL GATE — the adapter re-checks the human-approval record on the
 *    publish job (status approved/scheduled + approved_by/approved_at set by
 *    approvePublishJob in publish.functions.ts) immediately before executing.
 *
 * INTEGRATION POINT (sibling workstream): a server-enforced approvals table is
 * being built separately. When it lands, it becomes the source of truth for
 * gate 2 — point `assertPublishJobApproved` at it (or have it write the
 * approved_by/approved_at fields this checks). Do NOT build a second approvals
 * table here; this module deliberately reads the existing publish_jobs row.
 */

/** Publishing is config-disabled: no test channel/account designated. */
export class PublishingDisabledError extends Error {
  readonly code = "PUBLISHING_DISABLED";
  constructor(message: string) {
    super(message);
    this.name = "PublishingDisabledError";
  }
}

/** The connected account is not the founder-designated test account. */
export class TestAccountMismatchError extends Error {
  readonly code = "TEST_ACCOUNT_MISMATCH";
  constructor(message: string) {
    super(message);
    this.name = "TestAccountMismatchError";
  }
}

/** The publish job lacks a human approval record. */
export class PublishNotApprovedError extends Error {
  readonly code = "PUBLISH_NOT_APPROVED";
  constructor(
    message = "This video hasn't been approved for publishing yet. Approve it in the publish panel first.",
  ) {
    super(message);
    this.name = "PublishNotApprovedError";
  }
}

/* --------------------------- YouTube test channel -------------------------- */

/**
 * The founder-designated YouTube test channel. Set YOUTUBE_TEST_CHANNEL_ID in
 * the server environment to the channel id (UC…) that test uploads may target.
 * Null/empty/whitespace-only means publishing is DISABLED.
 */
export function youtubeTestChannelId(): string | null {
  const raw = process.env["YOUTUBE_TEST_CHANNEL_ID"];
  const id = raw?.trim();
  return id ? id : null;
}

/**
 * Returns the designated test channel id, or throws PublishingDisabledError
 * with a user-facing message when none is configured. Fail closed: no config
 * means no uploads, never a silent fallback.
 */
export function assertYouTubePublishingEnabled(): string {
  const id = youtubeTestChannelId();
  if (!id) {
    throw new PublishingDisabledError(
      "YouTube publishing is disabled: no test channel is configured. " +
        "The founder must set YOUTUBE_TEST_CHANNEL_ID before any upload can run.",
    );
  }
  return id;
}

/**
 * Refuses the upload unless the OAuth-connected channel IS the designated
 * test channel. A null/unknown connected channel fails closed (reconnect).
 */
export function assertYouTubeChannelAllowed(connectedChannelId: string | null | undefined): void {
  const testChannelId = assertYouTubePublishingEnabled();
  if (!connectedChannelId) {
    throw new TestAccountMismatchError(
      "Your YouTube channel couldn't be confirmed. Reconnect your channel and try again.",
    );
  }
  if (connectedChannelId !== testChannelId) {
    throw new TestAccountMismatchError(
      "Publishing is limited to the founder's designated test channel. " +
        "This connected channel is not the test channel, so the upload was refused.",
    );
  }
}

/* ---------------------------- Meta test accounts --------------------------- */

export type MetaTestConfig = {
  /** Founder-designated Facebook Page id for test publishes (null = FB disabled). */
  pageId: string | null;
  /** Founder-designated Instagram Business/Creator user id for test publishes (null = IG disabled). */
  igUserId: string | null;
};

/**
 * Founder-designated Meta test accounts, from META_TEST_PAGE_ID and
 * META_TEST_IG_USER_ID. Each platform is gated independently: Facebook
 * publishing needs the Page id, Instagram publishing needs the IG user id.
 */
export function metaTestConfig(): MetaTestConfig {
  const pageId = process.env["META_TEST_PAGE_ID"]?.trim() || null;
  const igUserId = process.env["META_TEST_IG_USER_ID"]?.trim() || null;
  return { pageId, igUserId };
}

/**
 * Returns the designated test id for the platform, or throws
 * PublishingDisabledError when it isn't configured.
 */
export function assertMetaPublishingEnabled(kind: "facebook" | "instagram"): string {
  const config = metaTestConfig();
  const id = kind === "facebook" ? config.pageId : config.igUserId;
  if (!id) {
    const envVar = kind === "facebook" ? "META_TEST_PAGE_ID" : "META_TEST_IG_USER_ID";
    const label = kind === "facebook" ? "Facebook" : "Instagram";
    throw new PublishingDisabledError(
      `${label} publishing is disabled: no test account is configured. ` +
        `The founder must set ${envVar} before any upload can run.`,
    );
  }
  return id;
}

/**
 * Refuses the publish unless the target account IS the designated test
 * account for that platform.
 */
export function assertMetaTestAccountAllowed(
  kind: "facebook" | "instagram",
  targetAccountId: string | null | undefined,
): void {
  const testId = assertMetaPublishingEnabled(kind);
  if (!targetAccountId || targetAccountId !== testId) {
    throw new TestAccountMismatchError(
      "Publishing is limited to the founder's designated test account. " +
        "The requested target is not the test account, so the publish was refused.",
    );
  }
}

/* ------------------------------ approval gate ------------------------------ */

/** The minimum approval record an adapter accepts before executing. */
export type ApprovablePublishJob = {
  status: string | null;
  approved_by: string | null;
  approved_at: string | null;
} | null | undefined;

/**
 * Re-checks the human-approval mechanism from publish.functions.ts immediately
 * before an adapter executes: the job must be in approved/scheduled status AND
 * carry the approved_by/approved_at record written by approvePublishJob.
 *
 * SIBLING INTEGRATION POINT: the server-enforced approvals table being built
 * by the sibling workstream becomes the source of truth here. Wire it by
 * having that table write (or mirror) approved_by/approved_at on publish_jobs,
 * or replace this check with a lookup against that table. Do not build a
 * second approvals table in this workstream.
 */
export function assertPublishJobApproved(job: ApprovablePublishJob): void {
  if (!job) throw new PublishNotApprovedError("Publish job not found.");
  const approvedStatus = job.status === "approved" || job.status === "scheduled";
  const hasApprovalRecord = Boolean(job.approved_by && job.approved_at);
  if (!approvedStatus || !hasApprovalRecord) {
    throw new PublishNotApprovedError();
  }
}
