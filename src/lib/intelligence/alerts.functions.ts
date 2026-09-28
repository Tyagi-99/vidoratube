/**
 * Phase 6 Stream E (P1) — Watchtower competitor alerts server functions.
 *
 * Rules are evaluated on demand via `checkAlertRules` (a scheduled cron can
 * call the same envelope later — cron ownership is outside this stream).
 * Every fire is delivered through the existing notification pipeline
 * (`emitNotification`, dedup key `alert:<ruleId>:<videoId|channelId>`) and
 * auto-creates a draft `video_ideas` row so the signal lands in the ideation
 * backlog, not just the bell.
 *
 * Honesty: evaluation runs against the user's own tracked data
 * (`channels`, `videos`, `video_snapshots`, `channel_snapshots`). With no
 * tracked channels the check returns an honest `no_data` envelope and makes
 * zero writes — it never invents alerts.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "../server-auth";
import {
  adminDb,
  dbList,
  dbOne,
  type AdminDb,
} from "./youtube-api.server";
import { intelDb, computeOutlierScore } from "./outliers.functions";
import {
  ALERT_NOTIFICATION_TYPE,
  ALERT_RULE_TYPES,
  evaluateAlertRules,
  validateAlertRule,
  type AlertConditions,
  type AlertRuleType,
  type EvalContext,
} from "./alerts";
import { emitNotification } from "../notifications.server";
import type { Json } from "@/integrations/supabase/types";

/* ------------------------------------------------------------------ */
/* Local row types (D89: `type` aliases, not interfaces)                */
/* ------------------------------------------------------------------ */

export type AlertRuleRow = {
  id: string;
  user_id: string;
  name: string;
  rule_type: AlertRuleType;
  channel_id: string | null;
  folder_id: string | null;
  /** JSON conditions — Json keeps the server-fn return serializable. */
  conditions: Record<string, Json>;
  is_active: boolean;
  last_fired_at: string | null;
  created_at: string;
  updated_at: string;
};

type ChannelRow = {
  id: string;
  title: string | null;
  tracked: boolean | null;
  user_id: string;
};

type VideoRow = {
  id: string;
  channel_id: string | null;
  title: string | null;
  published_at: string | null;
};

type VideoSnapshotRow = {
  video_id: string;
  captured_at: string;
  view_count: number | null;
};

type ChannelSnapshotRow = {
  channel_id: string;
  captured_at: string;
  subscriber_count: number | null;
  view_count: number | null;
  video_count: number | null;
};

type FolderItemRow = { folder_id: string; item_type: string; item_id: string };

const RULE_COLUMNS =
  "id, user_id, name, rule_type, channel_id, folder_id, conditions, is_active, last_fired_at, created_at, updated_at";

async function getAdmin(): Promise<AdminDb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return adminDb(supabaseAdmin);
}

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

const createRuleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  ruleType: z.enum(ALERT_RULE_TYPES),
  channelId: z.string().uuid().nullable().optional(),
  folderId: z.string().uuid().nullable().optional(),
  conditions: z.record(z.string(), z.unknown()).default({}),
});

const ruleIdSchema = z.object({ ruleId: z.string().uuid() });

/* ------------------------------------------------------------------ */
/* CRUD                                                                */
/* ------------------------------------------------------------------ */

export const listAlertRules = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({}).parse(i))
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    const rows = await dbList<AlertRuleRow>(
      intelDb(admin)
        .from("alert_rules")
        .select(RULE_COLUMNS)
        .eq("user_id", userId)
        .order("updated_at", { ascending: false }),
    );
    return { status: "ok" as const, rules: rows };
  });

export const createAlertRule = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => createRuleSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const errors = validateAlertRule({
      name: data.name,
      ruleType: data.ruleType,
      channelId: data.channelId ?? null,
      folderId: data.folderId ?? null,
      // The pure validator re-checks every field at runtime (D300).
      conditions: data.conditions as Partial<AlertConditions[AlertRuleType]>,
    });
    if (errors.length > 0) throw new Error(errors.join(" "));
    const admin = await getAdmin();
    // Verify scope ownership before persisting.
    if (data.channelId) {
      const ch = await dbOne<ChannelRow>(
        intelDb(admin)
          .from("channels")
          .select("id")
          .eq("id", data.channelId)
          .eq("user_id", userId)
          .maybeSingle<ChannelRow>(),
      );
      if (!ch) throw new Error("Channel not found.");
    }
    if (data.folderId) {
      const f = await dbOne<{ id: string }>(
        intelDb(admin)
          .from("folders")
          .select("id")
          .eq("id", data.folderId)
          .eq("user_id", userId)
          .maybeSingle<{ id: string }>(),
      );
      if (!f) throw new Error("Folder not found.");
    }
    const row = await dbOne<AlertRuleRow>(
      intelDb(admin)
        .from("alert_rules")
        .insert({
          user_id: userId,
          name: data.name.trim(),
          rule_type: data.ruleType,
          channel_id: data.channelId ?? null,
          folder_id: data.folderId ?? null,
          conditions: data.conditions,
          is_active: true,
        })
        .select(RULE_COLUMNS)
        .single<AlertRuleRow>(),
    );
    if (!row) throw new Error("Failed to create alert rule.");
    return { status: "ok" as const, rule: row };
  });

export const deleteAlertRule = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => ruleIdSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    const { error } = await intelDb(admin)
      .from("alert_rules")
      .delete()
      .eq("id", data.ruleId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { status: "ok" as const };
  });

export const toggleAlertRule = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    ruleIdSchema.extend({ isActive: z.boolean() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    const { error } = await intelDb(admin)
      .from("alert_rules")
      .update({ is_active: data.isActive })
      .eq("id", data.ruleId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { status: "ok" as const };
  });

/* ------------------------------------------------------------------ */
/* Evaluation                                                          */
/* ------------------------------------------------------------------ */

export const checkAlertRules = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({}).parse(i))
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = adminDb(supabaseAdmin);
    const db = intelDb(admin);

    const rules = await dbList<AlertRuleRow>(
      db.from("alert_rules").select(RULE_COLUMNS).eq("user_id", userId).eq("is_active", true),
    );
    if (rules.length === 0) {
      return { status: "no_rules" as const, checked: 0, fired: 0 };
    }

    const channels = await dbList<ChannelRow>(
      db.from("channels").select("id, title, tracked, user_id").eq("user_id", userId),
    );
    if (channels.length === 0) {
      return {
        status: "no_data" as const,
        checked: rules.length,
        fired: 0,
        reason: "No tracked channels yet. Track a channel from Intelligence → Channels first.",
      };
    }
    const channelIds = channels.map((c) => c.id);

    const videos = await dbList<VideoRow>(
      db
        .from("videos")
        .select("id, channel_id, title, published_at")
        .eq("user_id", userId)
        .in("channel_id", channelIds),
    );
    const videoIds = videos.map((v) => v.id);

    const videoSnaps =
      videoIds.length > 0
        ? await dbList<VideoSnapshotRow>(
            db
              .from("video_snapshots")
              .select("video_id, captured_at, view_count")
              .in("video_id", videoIds)
              .order("captured_at", { ascending: true }),
          )
        : [];
    const channelSnaps = await dbList<ChannelSnapshotRow>(
      db
        .from("channel_snapshots")
        .select("channel_id, captured_at, subscriber_count, view_count, video_count")
        .in("channel_id", channelIds)
        .order("captured_at", { ascending: true }),
    );

    // Folder scopes → channel id sets (only 'channels' item types count).
    const folderIds = [...new Set(rules.map((r) => r.folder_id).filter(Boolean))] as string[];
    const folderChannelIds = new Map<string, string[]>();
    if (folderIds.length > 0) {
      const items = await dbList<FolderItemRow>(
        db
          .from("folder_items")
          .select("folder_id, item_type, item_id")
          .in("folder_id", folderIds)
          .eq("item_type", "channels"),
      );
      for (const item of items) {
        const list = folderChannelIds.get(item.folder_id) ?? [];
        list.push(item.item_id);
        folderChannelIds.set(item.folder_id, list);
      }
    }

    // Latest view count per video → outlier multiple vs channel median
    // (same math as the Outlier Explorer, F4).
    const snapsByVideo = new Map<string, VideoSnapshotRow[]>();
    for (const s of videoSnaps) {
      const list = snapsByVideo.get(s.video_id) ?? [];
      list.push(s);
      snapsByVideo.set(s.video_id, list);
    }
    const latestViews = new Map<string, number>();
    for (const [videoId, snaps] of snapsByVideo) {
      const last = snaps[snaps.length - 1];
      if (last?.view_count != null) latestViews.set(videoId, last.view_count);
    }
    const outlierByVideo = new Map<string, number | null>();
    for (const v of videos) {
      const views = latestViews.get(v.id);
      if (views == null || !v.channel_id) {
        outlierByVideo.set(v.id, null);
        continue;
      }
      const siblings = videos.filter(
        (o) => o.id !== v.id && o.channel_id === v.channel_id && latestViews.get(o.id) != null,
      );
      const outlier = computeOutlierScore({
        latestViews: views,
        siblingLatestViews: siblings.map((s) => latestViews.get(s.id) as number),
        snapshots: (snapsByVideo.get(v.id) ?? []).map((s) => ({
          capturedAt: s.captured_at,
          viewCount: s.view_count,
        })),
      });
      outlierByVideo.set(v.id, outlier?.score ?? null);
    }

    // Latest channel snapshot per channel.
    const latestChannelSnap = new Map<string, ChannelSnapshotRow>();
    for (const s of channelSnaps) latestChannelSnap.set(s.channel_id, s);

    const nowIso = new Date().toISOString();
    const ctx: EvalContext = {
      rules: rules.map((r) => ({
        id: r.id,
        name: r.name,
        ruleType: r.rule_type,
        channelId: r.channel_id,
        folderId: r.folder_id,
        isActive: r.is_active,
        conditions: r.conditions ?? {},
        folderChannelIds: r.folder_id ? (folderChannelIds.get(r.folder_id) ?? []) : [],
      })),
      channels: channels.map((c) => ({ id: c.id, title: c.title, tracked: c.tracked })),
      videos: videos.map((v) => ({
        id: v.id,
        channelId: v.channel_id ?? "",
        title: v.title,
        publishedAt: v.published_at,
        latestViews: latestViews.get(v.id) ?? null,
        outlierScore: outlierByVideo.get(v.id) ?? null,
      })),
      latestSnapshots: [...latestChannelSnap.values()].map((s) => ({
        channelId: s.channel_id,
        capturedAt: s.captured_at,
        subscriberCount: s.subscriber_count,
        viewCount: s.view_count,
        videoCount: s.video_count,
      })),
      nowIso,
    };

    const fires = evaluateAlertRules(ctx);

    let delivered = 0;
    for (const fire of fires) {
      const notify = await emitNotification(supabaseAdmin, {
        userId,
        type: ALERT_NOTIFICATION_TYPE,
        title: `Watchtower: ${fire.ruleName}`,
        body: `${fire.channelTitle ?? "A channel"} — ${fire.videoTitle ?? fire.detail}. ${fire.detail}`,
        link: "/intelligence/outliers",
        dedupKey: fire.dedupKey,
      });
      if (!notify.notified && notify.duplicate) continue;
      if (notify.notified) {
        delivered += 1;
        // Auto-create a draft idea so the alert lands in the backlog.
        await dbOne<{ id: string }>(
          db
            .from("video_ideas")
            .insert({
              user_id: userId,
              project_id: null,
              title: fire.ideaTitle.slice(0, 200),
              hook: `Competitor signal: ${fire.detail}`,
              angle: `Watchtower rule "${fire.ruleName}" (${fire.ruleType})`,
              format: "long",
              difficulty: "medium",
              safety_flag: "safe",
              status: "new",
            })
            .select("id")
            .single<{ id: string }>(),
        ).catch(() => null);
        await db
          .from("alert_rules")
          .update({ last_fired_at: nowIso })
          .eq("id", fire.ruleId)
          .eq("user_id", userId);
      }
    }

    return {
      status: "ok" as const,
      checked: rules.length,
      fired: fires.length,
      delivered,
    };
  });
