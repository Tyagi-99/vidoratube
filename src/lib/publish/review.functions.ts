import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "@/lib/server-auth";

/**
 * Phase 4, Stream A (F29) — Review Studio.
 *
 * The approval queue reads the server-enforced `approvals` table (D61) plus
 * draft publish jobs awaiting team review. Client sign-off state comes from
 * `workspace_approvals` (D78) and is SURFACED here — it never satisfies the
 * D61 publish gate; only approvePublishJob's server-written `approvals` row
 * (plus approved_by/approved_at on the job) does.
 *
 * approve/reject are server-only:
 * - approve → the existing approvePublishJob (score<50 still HARD-BLOCKS
 *   public, D62 — the rule lives there and is not re-invented here).
 * - reject → rejectPublishJob below: draft/approved/scheduled → canceled,
 *   audit-logged with the reason. There is no un-cancel; a rejected job is
 *   dead by design so a "reject" can never silently become a publish.
 */

export interface ReviewQueueJob {
  id: string;
  status: string;
  title: string | null;
  description: string | null;
  tags: string[] | null;
  privacy: string | null;
  made_for_kids: boolean | null;
  scheduled_for: string | null;
  safety_score: number | null;
  project_id: string;
  workspace_id: string | null;
  created_at: string;
  video_job_id: string | null;
  youtube_video_id: string | null;
  youtube_url: string | null;
}

export interface ReviewQueueApproval {
  id: string;
  publish_job_id: string | null;
  approver_id: string;
  scope: string;
  approved_at: string;
  notes: string | null;
}

export interface ReviewQueueSignoff {
  publish_job_id: string;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
}

/**
 * Team review queue: all draft/approved/scheduled jobs with their latest
 * safety score, the server approval history for them, and any workspace
 * client sign-off. Scores come from `safety_scores` (latest per project) —
 * the same source approvePublishJob enforces the <50 block against.
 */
export const getReviewQueue = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: jobs, error } = await supabase
      .from("publish_jobs")
      .select(
        "id, status, title, description, tags, privacy, made_for_kids, scheduled_for, safety_score, project_id, workspace_id, created_at, video_job_id, youtube_video_id, youtube_url",
      )
      .eq("user_id", userId)
      .in("status", ["draft", "approved", "scheduled"])
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    const list = (jobs ?? []) as ReviewQueueJob[];
    const jobIds = list.map((j) => j.id);
    const projectIds = [...new Set(list.map((j) => j.project_id))];

    // Latest safety score per project (defense-in-depth display; the block
    // itself is enforced server-side in approvePublishJob/executePublishJob).
    const { data: scores } = await supabase
      .from("safety_scores")
      .select("project_id, score, created_at")
      .eq("user_id", userId)
      .in("project_id", projectIds.length ? projectIds : ["00000000-0000-0000-0000-000000000000"])
      .order("created_at", { ascending: false });
    const latestByProject = new Map<string, number>();
    for (const s of (scores ?? []) as { project_id: string; score: number }[]) {
      if (!latestByProject.has(s.project_id)) latestByProject.set(s.project_id, s.score);
    }

    // Server-enforced approval history (D61) for these jobs.
    const { data: approvals } = jobIds.length
      ? await supabase
          .from("approvals")
          .select("id, publish_job_id, approver_id, scope, approved_at, notes")
          .eq("user_id", userId)
          .in("publish_job_id", jobIds)
          .order("approved_at", { ascending: false })
      : { data: [] as ReviewQueueApproval[] };

    // Client sign-off (D78) — informational only.
    const { data: signoffs } = jobIds.length
      ? await supabase
          .from("workspace_approvals")
          .select("publish_job_id, status, decided_by, decided_at")
          .in("publish_job_id", jobIds)
      : { data: [] as ReviewQueueSignoff[] };

    return {
      jobs: list.map((j) => ({
        ...j,
        latest_safety_score: latestByProject.get(j.project_id) ?? j.safety_score ?? null,
      })),
      approvals: (approvals ?? []) as ReviewQueueApproval[],
      signoffs: (signoffs ?? []) as ReviewQueueSignoff[],
    };
  });

const rejectSchema = z.object({
  publish_job_id: z.string().uuid(),
  /** Required: rejections are audit-logged with the reason. */
  reason: z.string().trim().min(1).max(500),
});

export type RejectInput = z.infer<typeof rejectSchema>;

/**
 * Core of rejectPublishJob, exported for tests. Server-only rejection:
 * draft/approved/scheduled → canceled, audit-logged. Published/failed jobs
 * cannot be rejected (nothing to reject); canceled jobs stay canceled.
 */
export async function runRejectPublishJob({
  supabase,
  userId,
  input,
}: {
  supabase: any;
  userId: string;
  input: RejectInput;
}): Promise<{ ok: true }> {
  const { data: job } = await supabase
    .from("publish_jobs")
    .select("id, status")
    .eq("id", input.publish_job_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!job) throw new Error("Publish job not found");
  if (!["draft", "approved", "scheduled"].includes(job.status)) {
    throw new Error(`This job can't be rejected in its current state (${job.status}).`);
  }

  const { data: updated, error } = await supabase
    .from("publish_jobs")
    .update({ status: "canceled" })
    .eq("id", job.id)
    .eq("user_id", userId)
    .in("status", ["draft", "approved", "scheduled"])
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!updated) throw new Error("The job changed while rejecting — please try again.");

  const { auditPublishEvent } = await import("./audit");
  await auditPublishEvent({
    workspaceId: null,
    actorUserId: userId,
    action: "publish.rejected",
    entityType: "publish_job",
    entityId: job.id,
    metadata: { previous_status: job.status, reason: input.reason },
  });
  return { ok: true };
}

/** Server-only rejection of a publish job (draft/approved/scheduled → canceled). */
export const rejectPublishJob = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((input: unknown) => rejectSchema.parse(input))
  .handler(async ({ data, context }) => {
    return runRejectPublishJob({ supabase: context.supabase, userId: context.userId, input: data });
  });
