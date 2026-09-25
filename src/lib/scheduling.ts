/**
 * Scheduling calendar helpers (Sprints 7-8, workstream B).
 * Pure functions — no I/O, fully unit-tested.
 *
 * CRITICAL RULE: scheduling never auto-publishes. A publish job reaches
 * `scheduled` only through the human approval gate (approvePublishJob), and
 * it leaves `scheduled` only when a human invokes executePublishJob (or
 * cancels it). There is no background worker, cron, or queue consumer that
 * auto-executes due scheduled jobs — see publish.functions.ts.
 */

export const PUBLISH_PLATFORMS = ["youtube"] as const;
export type PublishPlatform = (typeof PUBLISH_PLATFORMS)[number];

/** Statuses shown on the scheduling calendar. Drafts are not scheduled yet. */
export const CALENDAR_STATUSES = [
  "scheduled",
  "approved",
  "published",
  "canceled",
] as const;
export type CalendarStatus = (typeof CALENDAR_STATUSES)[number];

export interface ScheduledPublishLike {
  status: string;
  scheduled_for: string | null;
}

/**
 * True when a scheduled job's time has arrived. "approved" jobs with no
 * scheduled_for are treated as due immediately (publish now).
 */
export function isScheduledDue(
  job: ScheduledPublishLike,
  now: Date = new Date(),
): boolean {
  if (job.status === "approved") return true;
  if (job.status !== "scheduled") return false;
  if (!job.scheduled_for) return false;
  return new Date(job.scheduled_for).getTime() <= now.getTime();
}

/**
 * A scheduled/approved job may only be executed by an explicit human action
 * (executePublishJob), and only once its scheduled time has arrived. This is
 * the pure predicate behind that server-side rule.
 */
export function canHumanExecuteNow(
  job: ScheduledPublishLike,
  now: Date = new Date(),
): boolean {
  return (
    (job.status === "approved" || job.status === "scheduled") &&
    isScheduledDue(job, now)
  );
}

/**
 * Milliseconds until a scheduled job is due. Negative when overdue.
 * Returns null when the job has no scheduled time.
 */
export function msUntilDue(
  job: ScheduledPublishLike,
  now: Date = new Date(),
): number | null {
  if (job.status === "approved") return 0;
  if (!job.scheduled_for) return null;
  return new Date(job.scheduled_for).getTime() - now.getTime();
}
