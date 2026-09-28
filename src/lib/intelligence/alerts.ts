/**
 * Phase 6 Stream E (P1) — Watchtower competitor alerts (competitor pattern AG-5).
 *
 * Rule types mirror the observed pattern (breakout-video, title-pattern,
 * multi-condition alerts) reimplemented in Vidora's own words, workflow, and
 * data model: a fired alert writes a notification AND auto-creates a draft
 * `video_ideas` row, so the signal lands directly in the ideation backlog
 * instead of stopping at a ping.
 *
 * Pure module — no I/O, no network, no randomness. DB access and notification
 * delivery live in `alerts.functions.ts`. All timestamps are ISO strings;
 * "now" is injected by the caller for testability.
 */

export const ALERT_RULE_TYPES = [
  "breakout_video",
  "title_pattern",
  "growth_condition",
] as const;
export type AlertRuleType = (typeof ALERT_RULE_TYPES)[number];

/** Notification type used for alert fires (free-text column — no enum change needed). */
export const ALERT_NOTIFICATION_TYPE = "intel.alert";

export interface AlertConditions {
  breakout_video: { minOutlier: number; lookbackDays: number };
  title_pattern: { pattern: string; lookbackDays: number };
  growth_condition: { minSubscribers: number | null; minAvgViews: number | null };
}

export interface AlertRuleInput {
  name: string;
  ruleType: AlertRuleType;
  channelId?: string | null;
  folderId?: string | null;
  conditions: Partial<AlertConditions[AlertRuleType]>;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Validate rule input; returns a list of human-readable errors (empty = valid). */
export function validateAlertRule(input: AlertRuleInput): string[] {
  const errors: string[] = [];
  const name = (input.name ?? "").trim();
  if (name.length < 1 || name.length > 120) errors.push("Name must be 1–120 characters.");
  if (!ALERT_RULE_TYPES.includes(input.ruleType)) errors.push("Unknown rule type.");
  const hasChannel = isUuid(input.channelId);
  const hasFolder = isUuid(input.folderId);
  if ((input.channelId || input.folderId) && !(hasChannel || hasFolder)) {
    errors.push("Scope must be a valid channel or folder id, or left empty for all channels.");
  }
  if (hasChannel && hasFolder) errors.push("A rule scopes to one channel or one folder, not both.");

  const c = (input.conditions ?? {}) as Record<string, unknown>;
  if (input.ruleType === "breakout_video") {
    const minOutlier = c["minOutlier"];
    const lookbackDays = c["lookbackDays"];
    if (!isFiniteNumber(minOutlier) || minOutlier < 1.2 || minOutlier > 100) {
      errors.push("minOutlier must be between 1.2 and 100 (× channel median).");
    }
    if (!isFiniteNumber(lookbackDays) || lookbackDays < 1 || lookbackDays > 90) {
      errors.push("lookbackDays must be between 1 and 90.");
    }
  } else if (input.ruleType === "title_pattern") {
    const pattern = c["pattern"];
    const lookbackDays = c["lookbackDays"];
    if (typeof pattern !== "string" || pattern.trim().length < 2 || pattern.length > 200) {
      errors.push("pattern must be a 2–200 character regular expression.");
    } else {
      try {
        // eslint-disable-next-line no-new
        new RegExp(pattern);
      } catch {
        errors.push("pattern is not a valid regular expression.");
      }
    }
    if (!isFiniteNumber(lookbackDays) || lookbackDays < 1 || lookbackDays > 90) {
      errors.push("lookbackDays must be between 1 and 90.");
    }
  } else {
    const minSubscribers = c["minSubscribers"];
    const minAvgViews = c["minAvgViews"];
    if (minSubscribers !== null && minSubscribers !== undefined) {
      if (!isFiniteNumber(minSubscribers) || minSubscribers < 0) {
        errors.push("minSubscribers must be a non-negative number or null.");
      }
    }
    if (minAvgViews !== null && minAvgViews !== undefined) {
      if (!isFiniteNumber(minAvgViews) || minAvgViews < 0) {
        errors.push("minAvgViews must be a non-negative number or null.");
      }
    }
    if (
      (minSubscribers === null || minSubscribers === undefined) &&
      (minAvgViews === null || minAvgViews === undefined)
    ) {
      errors.push("Set at least one of minSubscribers or minAvgViews.");
    }
  }
  return errors;
}

/* ------------------------------------------------------------------ */
/* Evaluation (pure)                                                   */
/* ------------------------------------------------------------------ */

export interface EvalChannel {
  id: string;
  title: string | null;
  tracked: boolean | null;
}

export interface EvalVideo {
  id: string;
  channelId: string;
  title: string | null;
  publishedAt: string | null;
  latestViews: number | null;
  /** Outlier multiple vs channel median (null when not computable). */
  outlierScore: number | null;
}

export interface EvalChannelSnapshot {
  channelId: string;
  capturedAt: string;
  subscriberCount: number | null;
  viewCount: number | null;
  videoCount: number | null;
}

export interface AlertFire {
  /** Stable dedup key for the notification writer: alert:<ruleId>:<subjectId>. */
  dedupKey: string;
  ruleId: string;
  ruleName: string;
  ruleType: AlertRuleType;
  channelId: string;
  channelTitle: string | null;
  videoId: string | null;
  videoTitle: string | null;
  /** Human-readable one-liner, e.g. "3.4× channel median · 128K views". */
  detail: string;
  /** Suggested draft-idea title for the auto-created video_ideas row. */
  ideaTitle: string;
}

export interface EvalContext {
  rules: Array<{
    id: string;
    name: string;
    ruleType: AlertRuleType;
    channelId: string | null;
    folderId: string | null;
    isActive: boolean;
    conditions: Record<string, unknown>;
    /** Channel ids inside the folder scope (empty when scope is channel/global). */
    folderChannelIds: string[];
  }>;
  channels: EvalChannel[];
  videos: EvalVideo[];
  latestSnapshots: EvalChannelSnapshot[];
  /** ISO "now" for lookback math. */
  nowIso: string;
}

function inLookback(publishedAt: string | null, nowMs: number, lookbackDays: number): boolean {
  if (!publishedAt) return false;
  const t = Date.parse(publishedAt);
  if (Number.isNaN(t)) return false;
  return t >= nowMs - lookbackDays * 86_400_000 && t <= nowMs + 60_000;
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

function ruleAppliesToChannel(
  rule: EvalContext["rules"][number],
  channelId: string,
): boolean {
  if (rule.channelId) return rule.channelId === channelId;
  if (rule.folderId) return rule.folderChannelIds.includes(channelId);
  return true; // global scope: every tracked channel
}

function evaluateBreakout(
  rule: EvalContext["rules"][number],
  ctx: EvalContext,
  nowMs: number,
): AlertFire[] {
  const minOutlier = rule.conditions["minOutlier"] as number;
  const lookbackDays = rule.conditions["lookbackDays"] as number;
  const fires: AlertFire[] = [];
  const channelById = new Map(ctx.channels.map((c) => [c.id, c]));
  for (const video of ctx.videos) {
    const channel = channelById.get(video.channelId);
    if (!channel || channel.tracked === false) continue;
    if (!ruleAppliesToChannel(rule, video.channelId)) continue;
    if (!inLookback(video.publishedAt, nowMs, lookbackDays)) continue;
    if (video.outlierScore === null || video.outlierScore < minOutlier) continue;
    fires.push({
      dedupKey: `alert:${rule.id}:${video.id}`,
      ruleId: rule.id,
      ruleName: rule.name,
      ruleType: rule.ruleType,
      channelId: video.channelId,
      channelTitle: channel.title,
      videoId: video.id,
      videoTitle: video.title,
      detail:
        `${video.outlierScore.toFixed(1)}× channel median` +
        (video.latestViews !== null ? ` · ${formatCompact(video.latestViews)} views` : ""),
      ideaTitle: video.title ?? "(untitled video)",
    });
  }
  return fires;
}

function evaluateTitlePattern(
  rule: EvalContext["rules"][number],
  ctx: EvalContext,
  nowMs: number,
): AlertFire[] {
  const pattern = String(rule.conditions["pattern"] ?? "");
  const lookbackDays = rule.conditions["lookbackDays"] as number;
  let re: RegExp;
  try {
    re = new RegExp(pattern, "i");
  } catch {
    return []; // invalid regexes are rejected at creation; never throw at check time
  }
  const fires: AlertFire[] = [];
  const channelById = new Map(ctx.channels.map((c) => [c.id, c]));
  for (const video of ctx.videos) {
    const channel = channelById.get(video.channelId);
    if (!channel || channel.tracked === false) continue;
    if (!ruleAppliesToChannel(rule, video.channelId)) continue;
    if (!inLookback(video.publishedAt, nowMs, lookbackDays)) continue;
    if (!video.title || !re.test(video.title)) continue;
    fires.push({
      dedupKey: `alert:${rule.id}:${video.id}`,
      ruleId: rule.id,
      ruleName: rule.name,
      ruleType: rule.ruleType,
      channelId: video.channelId,
      channelTitle: channel.title,
      videoId: video.id,
      videoTitle: video.title,
      detail: `title matches /${pattern}/`,
      ideaTitle: video.title,
    });
  }
  return fires;
}

function evaluateGrowth(
  rule: EvalContext["rules"][number],
  ctx: EvalContext,
): AlertFire[] {
  const minSubscribers = rule.conditions["minSubscribers"] as number | null | undefined;
  const minAvgViews = rule.conditions["minAvgViews"] as number | null | undefined;
  const fires: AlertFire[] = [];
  const videosByChannel = new Map<string, EvalVideo[]>();
  for (const v of ctx.videos) {
    const list = videosByChannel.get(v.channelId) ?? [];
    list.push(v);
    videosByChannel.set(v.channelId, list);
  }
  const snapByChannel = new Map(ctx.latestSnapshots.map((s) => [s.channelId, s]));
  for (const channel of ctx.channels) {
    if (channel.tracked === false) continue;
    if (!ruleAppliesToChannel(rule, channel.id)) continue;
    const snap = snapByChannel.get(channel.id);
    if (!snap) continue;
    const subs = snap.subscriberCount;
    const channelVideos = (videosByChannel.get(channel.id) ?? []).filter(
      (v) => v.latestViews !== null,
    );
    const avgViews =
      channelVideos.length > 0
        ? channelVideos.reduce((sum, v) => sum + (v.latestViews ?? 0), 0) / channelVideos.length
        : null;
    const subsOk =
      minSubscribers === null || minSubscribers === undefined
        ? true
        : subs !== null && subs >= minSubscribers;
    const viewsOk =
      minAvgViews === null || minAvgViews === undefined
        ? true
        : avgViews !== null && avgViews >= minAvgViews;
    if (!subsOk || !viewsOk) continue;
    const parts: string[] = [];
    if (subs !== null) parts.push(`${formatCompact(subs)} subs`);
    if (avgViews !== null) parts.push(`avg ${formatCompact(avgViews)} views`);
    fires.push({
      dedupKey: `alert:${rule.id}:${channel.id}`,
      ruleId: rule.id,
      ruleName: rule.name,
      ruleType: rule.ruleType,
      channelId: channel.id,
      channelTitle: channel.title,
      videoId: null,
      videoTitle: null,
      detail: parts.join(" · ") || "conditions met",
      ideaTitle: `Study ${channel.title ?? "this channel"}'s growth`,
    });
  }
  return fires;
}

/**
 * Evaluate every active rule against the provided context.
 * Deterministic: identical rows + identical nowIso → identical fires.
 */
export function evaluateAlertRules(ctx: EvalContext): AlertFire[] {
  const nowMs = Date.parse(ctx.nowIso);
  const fires: AlertFire[] = [];
  for (const rule of ctx.rules) {
    if (!rule.isActive) continue;
    if (rule.ruleType === "breakout_video") fires.push(...evaluateBreakout(rule, ctx, nowMs));
    else if (rule.ruleType === "title_pattern")
      fires.push(...evaluateTitlePattern(rule, ctx, nowMs));
    else fires.push(...evaluateGrowth(rule, ctx));
  }
  // Stable order: rule name, then channel, then video.
  fires.sort((a, b) =>
    a.ruleName.localeCompare(b.ruleName) ||
    (a.channelTitle ?? "").localeCompare(b.channelTitle ?? "") ||
    (a.videoTitle ?? "").localeCompare(b.videoTitle ?? ""),
  );
  return fires;
}
