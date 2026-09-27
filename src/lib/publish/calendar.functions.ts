import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "@/lib/server-auth";

/**
 * Phase 4, Stream A (F28) — content calendar.
 *
 * Week/month/pipeline views read `publish_jobs.scheduled_for`. Rescheduling
 * is a server-only mutation (reschedulePublishJob) that is audit-logged.
 *
 * HARD RULES (D138):
 * - Only `approved` / `scheduled` jobs can be (re)scheduled. Drafts live in
 *   the pipeline's "unscheduled" column and must be approved first — the
 *   calendar never moves a job out of draft.
 * - Rescheduling NEVER publishes: it only moves `scheduled_for` (+ status
 *   approved<->scheduled). Execution still requires the explicit human
 *   "Publish now" press through executePublishJob's gates.
 * - `scheduled_for` must be in the future, or null (unschedule → back to
 *   `approved`).
 */

const calendarQuerySchema = z.object({
  /** ISO start of the visible window. */
  from: z.string().datetime(),
  /** ISO end of the visible window. */
  to: z.string().datetime(),
});

export interface CalendarJob {
  id: string;
  status: string;
  title: string | null;
  privacy: string | null;
  scheduled_for: string | null;
  approved_at: string | null;
  safety_score: number | null;
  youtube_video_id: string | null;
  youtube_url: string | null;
  project_id: string;
  created_at: string;
}

/**
 * Jobs for the calendar: everything scheduled inside the window, plus every
 * draft/approved/scheduled job for the pipeline columns (unscheduled /
 * queued). Published/failed/canceled jobs are history — shown when they
 * were scheduled inside the window.
 */
export const getCalendarJobs = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((input: unknown) => calendarQuerySchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: jobs, error } = await supabase
      .from("publish_jobs")
      .select(
        "id, status, title, privacy, scheduled_for, approved_at, safety_score, youtube_video_id, youtube_url, project_id, created_at",
      )
      .eq("user_id", userId)
      .or(
        `and(status.in.(draft,approved,scheduled)),and(scheduled_for.gte.${data.from},scheduled_for.lte.${data.to})`,
      )
      .order("scheduled_for", { ascending: true, nullsFirst: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return { jobs: (jobs ?? []) as CalendarJob[] };
  });

const rescheduleSchema = z.object({
  publish_job_id: z.string().uuid(),
  /**
   * New scheduled time (ISO). Null unschedules the job back to `approved`.
   */
  scheduled_for: z.string().datetime().nullable(),
});

export type RescheduleInput = z.infer<typeof rescheduleSchema>;

/**
 * Core of reschedulePublishJob, exported for tests. `supabase` is the
 * caller's RLS-scoped client.
 */
export async function runReschedulePublishJob({
  supabase,
  userId,
  input,
}: {
  supabase: any;
  userId: string;
  input: RescheduleInput;
}): Promise<{ publishJob: any }> {
  const { data: job } = await supabase
    .from("publish_jobs")
    .select("id, status, scheduled_for, project_id")
    .eq("id", input.publish_job_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!job) throw new Error("Publish job not found");
  if (!["approved", "scheduled"].includes(job.status)) {
    throw new Error(
      `Only approved or scheduled jobs can be rescheduled (current: ${job.status}). Approve the draft first.`,
    );
  }

  let scheduledFor: string | null = null;
  if (input.scheduled_for) {
    const when = new Date(input.scheduled_for);
    if (!Number.isFinite(when.getTime())) throw new Error("Invalid scheduled time.");
    if (when.getTime() <= Date.now()) {
      throw new Error("Scheduled time must be in the future.");
    }
    scheduledFor = when.toISOString();
  }

  const nextStatus = scheduledFor ? "scheduled" : "approved";
  const { data: updated, error } = await supabase
    .from("publish_jobs")
    .update({ scheduled_for: scheduledFor, status: nextStatus })
    .eq("id", job.id)
    .eq("user_id", userId)
    .in("status", ["approved", "scheduled"])
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!updated) throw new Error("The job changed while rescheduling — please try again.");

  // Audit-logged: who moved what, from when to when. Best-effort so a
  // missing audit_logs table can never break the mutation itself.
  const { auditPublishEvent } = await import("./audit");
  await auditPublishEvent({
    workspaceId: null,
    actorUserId: userId,
    action: "publish.rescheduled",
    entityType: "publish_job",
    entityId: job.id,
    metadata: {
      from: job.scheduled_for,
      to: scheduledFor,
      previous_status: job.status,
      new_status: nextStatus,
    },
  });

  return { publishJob: updated };
}

/**
 * Moves a job's scheduled time (drag-drop on the calendar). Audit-logged.
 * Never publishes — scheduling is not execution.
 */
export const reschedulePublishJob = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((input: unknown) => rescheduleSchema.parse(input))
  .handler(async ({ data, context }) => {
    return runReschedulePublishJob({ supabase: context.supabase, userId: context.userId, input: data });
  });
