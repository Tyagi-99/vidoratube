/**
 * Phase 6 Stream E (P6) — packaging checklist server functions.
 *
 * - `getPackagingChecklist`: evaluates the pinned rules
 *   (`src/lib/publish/checklist.ts`) against a real publish job the user
 *   owns, then marks findings dismissed when a matching
 *   `checklist_dismissals` row exists at the current CHECKLIST_VERSION.
 * - `dismissChecklistRule` / `restoreChecklistRule`: reasoned dismissal
 *   management. A dismissal needs a 3–500 character reason and only quiets
 *   the checklist's own warning — it never touches the safety/approval gates
 *   (D305).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "../server-auth";
import { adminDb, dbList, dbOne, type AdminDb } from "../intelligence/youtube-api.server";
import {
  CHECKLIST_RULES,
  CHECKLIST_VERSION,
  evaluateChecklist,
  type ChecklistFinding,
} from "./checklist";

const PUBLISH_COLUMNS =
  "id, title, description, tags, privacy, safety_score, scheduled_for";

type PublishJobRow = {
  id: string;
  title: string | null;
  description: string | null;
  tags: string[] | null;
  privacy: string | null;
  safety_score: number | null;
  scheduled_for: string | null;
};

type DismissalRow = {
  rule_id: string;
  checklist_version: number;
  channel_id: string | null;
  reason: string;
  created_at: string;
};

export interface DismissedFinding extends ChecklistFinding {
  dismissed: boolean;
  dismissalReason: string | null;
}

async function getAdmin(): Promise<AdminDb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return adminDb(supabaseAdmin);
}

const jobIdSchema = z.object({ publishJobId: z.string().uuid() });

async function ownJob(
  db: AdminDb,
  userId: string,
  publishJobId: string,
): Promise<PublishJobRow | null> {
  // publish_jobs is user-owned through its project; verify both hops.
  const job = await dbOne<PublishJobRow & { project_id: string }>(
    db
      .from("publish_jobs")
      .select(`${PUBLISH_COLUMNS}, project_id`)
      .eq("id", publishJobId)
      .maybeSingle<PublishJobRow & { project_id: string }>(),
  );
  if (!job) return null;
  const project = await dbOne<{ user_id: string }>(
    db
      .from("projects")
      .select("user_id")
      .eq("id", job.project_id)
      .eq("user_id", userId)
      .maybeSingle<{ user_id: string }>(),
  );
  return project ? job : null;
}

export const getPackagingChecklist = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => jobIdSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ status: "ok"; findings: DismissedFinding[] }> => {
    const { userId } = context as { userId: string };
    const db = await getAdmin();
    const job = await ownJob(db, userId, data.publishJobId);
    if (!job) throw new Error("Publish job not found.");
    const findings = evaluateChecklist(job);
    const dismissals = await dbList<DismissalRow>(
      db
        .from("checklist_dismissals")
        .select("rule_id, checklist_version, channel_id, reason, created_at")
        .eq("user_id", userId)
        .eq("checklist_version", CHECKLIST_VERSION),
    );
    const byRule = new Map(dismissals.map((d) => [d.rule_id, d]));
    return {
      status: "ok",
      findings: findings.map((f) => {
        const d = byRule.get(f.id);
        return {
          ...f,
          dismissed: Boolean(d),
          dismissalReason: d?.reason ?? null,
        };
      }),
    };
  });

const dismissSchema = z.object({
  ruleId: z.string().trim().min(1).max(80),
  reason: z.string().trim().min(3).max(500),
  /** Optional channel scope; null = applies to every project. */
  channelId: z.string().uuid().nullable().optional(),
});

export const dismissChecklistRule = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => dismissSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    if (!CHECKLIST_RULES.some((r) => r.id === data.ruleId)) {
      throw new Error("Unknown checklist rule.");
    }
    const db = await getAdmin();
    // The unique indexes are partial (global vs channel-scoped), so plain
    // upsert onConflict is unreliable — delete-then-insert instead.
    const scope = data.channelId ?? null;
    let drop: ReturnType<AdminDb["from"]> = db
      .from("checklist_dismissals")
      .delete()
      .eq("user_id", userId)
      .eq("rule_id", data.ruleId)
      .eq("checklist_version", CHECKLIST_VERSION);
    drop = scope ? drop.eq("channel_id", scope) : drop.is("channel_id", null);
    // Bare await: deleting zero rows is fine (list-mode fetch, no .single()).
    await dbList<unknown>(drop);
    await dbOne<unknown>(
      db
        .from("checklist_dismissals")
        .insert({
          user_id: userId,
          rule_id: data.ruleId,
          checklist_version: CHECKLIST_VERSION,
          channel_id: scope,
          reason: data.reason.trim(),
        })
        .select("id")
        .single<unknown>(),
    );
    return { status: "ok" as const };
  });

const restoreSchema = z.object({
  ruleId: z.string().trim().min(1).max(80),
  channelId: z.string().uuid().nullable().optional(),
});

export const restoreChecklistRule = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => restoreSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const db = await getAdmin();
    let query: ReturnType<AdminDb["from"]> = db
      .from("checklist_dismissals")
      .delete()
      .eq("user_id", userId)
      .eq("rule_id", data.ruleId)
      .eq("checklist_version", CHECKLIST_VERSION);
    query = data.channelId ? query.eq("channel_id", data.channelId) : query.is("channel_id", null);
    // Restoring a non-dismissed rule is a no-op (list-mode fetch).
    await dbList<unknown>(query);
    return { status: "ok" as const };
  });
