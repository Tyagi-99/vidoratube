/**
 * Phase 4 Stream D — event-driven notification triggers.
 *
 * CONSUME-ONLY contract (D138): these functions READ other streams' tables
 * (generation_jobs, publish_jobs, experiments, workspace_budgets,
 * channel_connections) to decide WHEN to notify. They NEVER write to those
 * tables — the only write is the notification row itself via
 * emitNotification. The triggers test asserts this: the mock admin records
 * every operation and the suite fails if anything but a notifications insert
 * is written.
 *
 * Exactly-once: every emission carries a dedup_key, so re-running a trigger
 * (or two triggers racing) cannot double-notify.
 *
 * Email follows the existing pattern: only when RESEND_API_KEY is set.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { emitNotification, type NotificationType } from "../notifications.server";

type AdminClient = Pick<SupabaseClient, "from" | "auth">;

export interface TriggerSummary {
  emitted: number;
  duplicates: number;
  emailed: number;
}

function emptySummary(): TriggerSummary {
  return { emitted: 0, duplicates: 0, emailed: 0 };
}

function add(a: TriggerSummary, b: TriggerSummary): TriggerSummary {
  return {
    emitted: a.emitted + b.emitted,
    duplicates: a.duplicates + b.duplicates,
    emailed: a.emailed + b.emailed,
  };
}

async function getUserEmail(admin: AdminClient, userId: string): Promise<string | null> {
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    return data?.user?.email ?? null;
  } catch {
    return null;
  }
}

interface EmitInput {
  userId: string;
  userEmail: string | null;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  dedupKey: string;
  emailSubject?: string;
  emailText?: string;
}

async function emit(admin: AdminClient, input: EmitInput): Promise<TriggerSummary> {
  const s = emptySummary();
  const r = await emitNotification(admin, {
    userId: input.userId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    link: input.link ?? null,
    dedupKey: input.dedupKey,
    email:
      input.emailSubject && input.userEmail
        ? {
            to: input.userEmail,
            subject: input.emailSubject,
            text: input.emailText ?? input.body ?? input.title,
          }
        : null,
  });
  if (r.duplicate) s.duplicates++;
  if (r.notified) s.emitted++;
  if (r.emailed) s.emailed++;
  return s;
}

/* ------------------------- render completed/failed ------------------------ */

interface GenerationJobRow {
  id: string;
  user_id: string;
  job_type: string;
  status: string;
  updated_at: string;
}

/** Notify on terminal render jobs from the last 24h. */
export async function notifyRenderEvents(
  admin: AdminClient,
  userId: string,
): Promise<TriggerSummary> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("generation_jobs")
    .select("id,user_id,job_type,status,updated_at")
    .eq("user_id", userId)
    .in("status", ["completed", "failed"])
    .gte("updated_at", since)
    .order("updated_at", { ascending: false })
    .limit(25);
  if (error) throw new Error((error as { message?: string }).message ?? "render scan failed");

  const userEmail = await getUserEmail(admin, userId);
  let summary = emptySummary();
  for (const job of (data as GenerationJobRow[] | null) ?? []) {
    const failed = job.status === "failed";
    summary = add(
      summary,
      await emit(admin, {
        userId,
        userEmail,
        type: failed ? "render.failed" : "render.completed",
        title: failed
          ? `Render failed (${job.job_type})`
          : `Your render finished (${job.job_type})`,
        body: failed
          ? "Something went wrong while rendering. Open the studio to retry."
          : "Open the studio to review and download it.",
        link: "/studio",
        dedupKey: `render:${job.id}`,
        emailSubject: failed ? "Your Vidora render failed" : "Your Vidora video is ready",
      }),
    );
  }
  return summary;
}

/* ------------------------- publish approved/published/failed -------------- */

interface PublishJobRow {
  id: string;
  user_id: string;
  title: string | null;
  status: string;
  updated_at: string;
  approved_at: string | null;
}

const PUBLISH_STATUS_LABEL: Record<string, NotificationType> = {
  approved: "publish.approved",
  published: "publish.published",
  failed: "publish.failed",
};

export async function notifyPublishEvents(
  admin: AdminClient,
  userId: string,
): Promise<TriggerSummary> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("publish_jobs")
    .select("id,user_id,title,status,updated_at,approved_at")
    .eq("user_id", userId)
    .in("status", ["approved", "published", "failed"])
    .gte("updated_at", since)
    .order("updated_at", { ascending: false })
    .limit(25);
  if (error) throw new Error((error as { message?: string }).message ?? "publish scan failed");

  const userEmail = await getUserEmail(admin, userId);
  let summary = emptySummary();
  for (const job of (data as PublishJobRow[] | null) ?? []) {
    const type = PUBLISH_STATUS_LABEL[job.status];
    if (!type) continue;
    const title = job.title ?? "your video";
    summary = add(
      summary,
      await emit(admin, {
        userId,
        userEmail,
        type,
        title:
          job.status === "published"
            ? `Published: ${title}`
            : job.status === "approved"
              ? `Publish approved: ${title}`
              : `Publish failed: ${title}`,
        body:
          job.status === "failed"
            ? "The publish job errored. Open the calendar to inspect and retry."
            : job.status === "approved"
              ? "The publish job passed review and is ready to schedule."
              : "Your video is live.",
        link: "/calendar",
        dedupKey: `publish:${job.id}:${job.status}`,
        emailSubject:
          job.status === "published"
            ? `Your video is live: ${title}`
            : job.status === "failed"
              ? `Publish failed: ${title}`
              : `Publish approved: ${title}`,
      }),
    );
  }
  return summary;
}

/* ------------------------- approval requested ----------------------------- */

/**
 * A publish_job sitting in `draft` was created by requestPublish but has no
 * approval row yet — the approver needs a nudge. Emitted once per job.
 */
export async function notifyApprovalRequested(
  admin: AdminClient,
  userId: string,
): Promise<TriggerSummary> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("publish_jobs")
    .select("id,user_id,title,created_at")
    .eq("user_id", userId)
    .eq("status", "draft")
    .gte("created_at", since)
    .limit(25);
  if (error) throw new Error((error as { message?: string }).message ?? "approval scan failed");

  let summary = emptySummary();
  for (const job of (data as { id: string; title: string | null }[] | null) ?? []) {
    summary = add(
      summary,
      await emit(admin, {
        userId,
        userEmail: null, // in-app only: the approver is usually the same user
        type: "approval.requested",
        title: `Approval requested: ${job.title ?? "publish job"}`,
        body: "A publish job is waiting for your review before it can go live.",
        link: "/review",
        dedupKey: `approval:${job.id}`,
      }),
    );
  }
  return summary;
}

/* ------------------------- budget alert ----------------------------------- */

function monthStartUtc(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

function monthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function notifyBudgetAlerts(
  admin: AdminClient,
  userId: string,
): Promise<TriggerSummary> {
  // Workspace budgets visible to this user's workspaces.
  const { data: budgets, error } = await admin
    .from("workspace_budgets")
    .select("workspace_id,monthly_credit_cap,alert_threshold_pct")
    .not("monthly_credit_cap", "is", null);
  if (error) throw new Error((error as { message?: string }).message ?? "budget scan failed");

  let summary = emptySummary();
  const month = monthStartUtc();
  const key = monthKey();
  for (const b of (budgets as
    | {
        workspace_id: string;
        monthly_credit_cap: number | null;
        alert_threshold_pct: number;
      }[]
    | null) ?? []) {
    const cap = Number(b.monthly_credit_cap);
    if (!cap || cap <= 0) continue;
    const { data: spendRows, error: spendError } = await admin
      .from("generation_jobs")
      .select("cost_actual_credits")
      .eq("workspace_id", b.workspace_id)
      .gte("created_at", month);
    if (spendError) continue; // never break other triggers on one bad scope
    const spent =
      (spendRows as { cost_actual_credits: number | null }[] | null)?.reduce(
        (s, r) => s + (Number(r.cost_actual_credits) || 0),
        0,
      ) ?? 0;
    const pct = (spent / cap) * 100;
    const threshold = Number(b.alert_threshold_pct ?? 80);
    if (pct >= threshold) {
      summary = add(
        summary,
        await emit(admin, {
          userId,
          userEmail: await getUserEmail(admin, userId),
          type: "budget.alert",
          title: `Budget alert: ${Math.round(pct)}% of monthly credits used`,
          body: `Workspace spend is ${spent.toFixed(0)} of ${cap.toFixed(0)} credits this month.`,
          link: "/billing",
          dedupKey: `budget:${b.workspace_id}:${key}`,
          emailSubject: `Vidora budget alert: ${Math.round(pct)}% used`,
        }),
      );
    }
  }
  return summary;
}

/* ------------------------- quota warning ---------------------------------- */

/**
 * YouTube quota visibility lives in channel_connections.quota (D65):
 * { videos_insert: {...}, search_list: {...}, units: { used, limit } }.
 * Warn once per day when daily units cross 80%.
 */
export async function notifyQuotaWarnings(
  admin: AdminClient,
  userId: string,
): Promise<TriggerSummary> {
  const { data, error } = await admin
    .from("channel_connections")
    .select("id,platform,display_name,quota")
    .eq("user_id", userId)
    .eq("platform", "youtube");
  if (error) throw new Error((error as { message?: string }).message ?? "quota scan failed");

  const today = new Date().toISOString().slice(0, 10);
  let summary = emptySummary();
  for (const c of (data as
    | {
        id: string;
        display_name: string | null;
        quota: { units?: { used?: number; limit?: number } } | null;
      }[]
    | null) ?? []) {
    const units = c.quota?.units;
    const used = Number(units?.used ?? 0);
    const limit = Number(units?.limit ?? 0);
    if (!limit || limit <= 0) continue;
    if (used / limit >= 0.8) {
      summary = add(
        summary,
        await emit(admin, {
          userId,
          userEmail: await getUserEmail(admin, userId),
          type: "quota.warning",
          title: `YouTube quota at ${Math.round((used / limit) * 100)}%`,
          body: `${c.display_name ?? "Your channel"} used ${used} of ${limit} daily API units. Heavy operations may be throttled.`,
          link: "/studio",
          dedupKey: `quota:${c.id}:${today}`,
          emailSubject: "Vidora: YouTube API quota warning",
        }),
      );
    }
  }
  return summary;
}

/* ------------------------- experiment concluded --------------------------- */

interface ExperimentRow {
  id: string;
  user_id: string;
  name: string;
  conclusion: { winner_arm_id?: string; p_value?: number; decided_at?: string } | null;
  updated_at: string;
}

export async function notifyExperimentConcluded(
  admin: AdminClient,
  userId: string,
): Promise<TriggerSummary> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("experiments")
    .select("id,user_id,name,conclusion,updated_at")
    .eq("user_id", userId)
    .eq("status", "completed")
    .gte("updated_at", since)
    .limit(25);
  if (error) throw new Error((error as { message?: string }).message ?? "experiment scan failed");

  const userEmail = await getUserEmail(admin, userId);
  let summary = emptySummary();
  for (const e of (data as ExperimentRow[] | null) ?? []) {
    const decidedAt = e.conclusion?.decided_at;
    const p = e.conclusion?.p_value;
    summary = add(
      summary,
      await emit(admin, {
        userId,
        userEmail,
        type: "experiment.concluded",
        title: `Experiment concluded: ${e.name}`,
        body:
          `The test reached a decision${typeof p === "number" ? ` (p=${p.toFixed(4)})` : ""}. ` +
          `Review the winner before applying it — applying is a human click.`,
        link: "/experiments",
        dedupKey: `experiment:${e.id}:${decidedAt ?? e.updated_at}`,
        emailSubject: `Experiment concluded: ${e.name}`,
      }),
    );
  }
  return summary;
}

/* ------------------------- runner ----------------------------------------- */

/** Run every trigger for one user. Designed for a worker/cron call. */
export async function runAllNotificationTriggers(
  admin: AdminClient,
  userId: string,
): Promise<TriggerSummary & { byTrigger: Record<string, TriggerSummary> }> {
  const byTrigger: Record<string, TriggerSummary> = {};
  byTrigger["render"] = await notifyRenderEvents(admin, userId);
  byTrigger["publish"] = await notifyPublishEvents(admin, userId);
  byTrigger["approval"] = await notifyApprovalRequested(admin, userId);
  byTrigger["budget"] = await notifyBudgetAlerts(admin, userId);
  byTrigger["quota"] = await notifyQuotaWarnings(admin, userId);
  byTrigger["experiment"] = await notifyExperimentConcluded(admin, userId);
  const total = emptySummary();
  for (const s of Object.values(byTrigger)) {
    total.emitted += s.emitted;
    total.duplicates += s.duplicates;
    total.emailed += s.emailed;
  }
  return { ...total, byTrigger };
}
