/**
 * Stream D — Smart Folders (F7) server functions.
 *
 * Contract: docs/PHASE2_CONTRACTS.md "Stream D — server functions".
 * Rule engine math here is the pinned outlier definition:
 *   outlier_score = video's latest snapshot views / channel median views
 *   (median over the channel's videos' latest snapshot view counts,
 *   including the video itself). Deterministic, no network.
 *
 * Pure, unit-testable pieces are exported at the bottom (evaluateRuleValue,
 * medianOf, outlierScoreFor, coerceRuleValue). Server handlers are thin.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "../server-auth";
import { adminDb, type AdminDb } from "./youtube-api.server";
import type { Json } from "@/integrations/supabase/types";

/* ------------------------------------------------------------------ */
/* Pinned contract vocab                                               */
/* ------------------------------------------------------------------ */

/** Polymorphic item types that may be pinned into a folder (whitelist). */
export const FOLDER_ITEM_TYPES = ["videos", "video_ideas", "research_sources", "channels"] as const;
export type FolderItemType = (typeof FOLDER_ITEM_TYPES)[number];

/** Rule fields pinned by the Phase 2 contract. */
export const RULE_FIELDS = [
  "videos.view_count",
  "videos.outlier_score",
  "videos.published_at",
  "video_ideas.status",
  "research_sources.source_type",
  "channels.subscriber_count",
] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

export const RULE_OPERATORS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in"] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];

type FieldKind = "number" | "string" | "date";

const FIELD_KIND: Record<RuleField, FieldKind> = {
  "videos.view_count": "number",
  "videos.outlier_score": "number",
  "videos.published_at": "date",
  "video_ideas.status": "string",
  "research_sources.source_type": "string",
  "channels.subscriber_count": "number",
};

const ITEM_TABLE: Record<FolderItemType, string> = {
  videos: "videos",
  video_ideas: "video_ideas",
  research_sources: "research_sources",
  channels: "channels",
};

export interface FolderItem {
  itemType: FolderItemType;
  itemId: string;
  title: string;
  detail: string | null;
}

/* ------------------------------------------------------------------ */
/* Pure rule engine (exported for unit tests)                          */
/* ------------------------------------------------------------------ */

/** Median of a finite list; null when empty or all non-finite. */
export function medianOf(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 1 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2;
}

/**
 * Outlier multiple: latestViews / median(siblingLatestViews).
 * `siblingLatestViews` is the channel's videos' latest snapshot view
 * counts INCLUDING this video (standard channel-median definition).
 * Returns null when there is no usable median (no snapshots, median ≤ 0,
 * or latestViews unknown).
 */
export function outlierScoreFor(
  latestViews: number | null | undefined,
  siblingLatestViews: number[],
): number | null {
  if (latestViews == null || !Number.isFinite(latestViews)) return null;
  const median = medianOf(siblingLatestViews);
  if (median == null || median <= 0) return null;
  return latestViews / median;
}

const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

/** Coerce a candidate (from a row) and rule value into a number, or null. */
function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && NUMERIC_RE.test(v.trim())) return Number(v.trim());
  return null;
}

/** Loose equality: numeric-vs-numeric compares as numbers, else as strings. */
function looseEq(a: unknown, b: unknown): boolean {
  const an = toNumber(a);
  const bn = toNumber(b);
  if (an !== null && bn !== null) return an === bn;
  return String(a) === String(b);
}

/**
 * Evaluate one operator against a candidate value and a stored rule value.
 * A null/undefined candidate never matches (insufficient data ≠ match).
 */
export function evaluateRuleValue(
  operator: RuleOperator,
  candidate: unknown,
  ruleValue: unknown,
): boolean {
  if (candidate === null || candidate === undefined) return false;
  switch (operator) {
    case "eq":
      return looseEq(candidate, ruleValue);
    case "neq":
      return !looseEq(candidate, ruleValue);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const c = toNumber(candidate);
      const r = toNumber(ruleValue);
      if (c === null || r === null) return false;
      if (operator === "gt") return c > r;
      if (operator === "gte") return c >= r;
      if (operator === "lt") return c < r;
      return c <= r;
    }
    case "contains":
      return String(candidate).toLowerCase().includes(String(ruleValue).toLowerCase());
    case "in":
      return Array.isArray(ruleValue) && ruleValue.some((v) => looseEq(candidate, v));
  }
}

/** Convert a rule value into the candidate domain for a field kind. */
export function candidateForField(
  field: RuleField,
  ruleValue: unknown,
): { coerce: (raw: unknown) => unknown } {
  void ruleValue;
  const kind = FIELD_KIND[field];
  if (kind === "date") {
    // Rule values are ISO date/datetime strings; candidates are ISO strings.
    // eq/neq compare by calendar day; gt/gte/lt/lte compare timestamps.
    return {
      coerce: (raw: unknown) => {
        if (typeof raw !== "string" || !raw) return null;
        const t = Date.parse(raw);
        return Number.isNaN(t) ? null : t;
      },
    };
  }
  return { coerce: (raw: unknown) => raw };
}

/**
 * Evaluate a full rule against a raw candidate from the row.
 * Handles date semantics: eq/neq compare calendar day, others timestamps.
 */
export function evaluateRule(
  field: RuleField,
  operator: RuleOperator,
  ruleValue: unknown,
  rawCandidate: unknown,
): boolean {
  if (FIELD_KIND[field] !== "date") {
    return evaluateRuleValue(operator, rawCandidate, ruleValue);
  }
  const toTs = (v: unknown): number | null => {
    if (typeof v !== "string" || !v) return null;
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  };
  if (operator === "eq" || operator === "neq") {
    // Calendar-day equality: "2026-09-01T10:00:00Z" matches "2026-09-01".
    const day = (v: unknown): string | null => {
      if (typeof v !== "string" || !v) return null;
      const t = Date.parse(v);
      return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
    };
    const c = day(rawCandidate);
    const r = day(ruleValue);
    if (c === null || r === null) return false;
    return operator === "eq" ? c === r : c !== r;
  }
  return evaluateRuleValue(operator, toTs(rawCandidate), toTs(ruleValue));
}

/** Zod-level validation of (field, operator, value) triples. */
export const addRuleSchema = z
  .object({
    folderId: z.string().uuid(),
    field: z.enum(RULE_FIELDS),
    operator: z.enum(RULE_OPERATORS),
    value: z.unknown(),
  })
  .superRefine((data, ctx) => {
    if (data.operator === "in" && !Array.isArray(data.value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "operator 'in' requires an array value",
      });
    }
    const kind = FIELD_KIND[data.field];
    if (["gt", "gte", "lt", "lte"].includes(data.operator)) {
      if (kind === "number" && toNumber(data.value) === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `operator '${data.operator}' on ${data.field} requires a numeric value`,
        });
      }
      if (kind === "date") {
        const t = typeof data.value === "string" ? Date.parse(data.value) : NaN;
        if (Number.isNaN(t)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `operator '${data.operator}' on ${data.field} requires an ISO date value`,
          });
        }
      }
    }
  });

/* ------------------------------------------------------------------ */
/* Server-only helpers                                                 */
/* ------------------------------------------------------------------ */

type Admin = AdminDb;

/** Row shapes for intelligence tables missing from the generated Database type. */
interface FolderListRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}
interface FolderPinRow {
  item_type: string;
  item_id: string;
  added_at: string;
}
interface VideoSnapshotLite {
  video_id: string;
  view_count: number | null;
}
interface ChannelSnapshotLite {
  channel_id: string;
  subscriber_count: number | null;
}
interface VideoRuleRow {
  id: string;
  title: string | null;
  published_at: string | null;
  channel_id: string | null;
  channels: { title: string | null } | null;
}
interface IdeaRow {
  id: string;
  title: string | null;
  status: string | null;
}
interface SourceRow {
  id: string;
  title: string | null;
  url: string | null;
  source_type: string | null;
}
interface ChannelRuleRow {
  id: string;
  title: string | null;
  handle: string | null;
}
interface RuleOwnershipRow {
  id: string;
  folder_id: string;
  folders: { user_id: string } | null;
}
interface FolderRuleRow {
  id: string;
  folder_id: string;
  field: string;
  operator: string;
  value: Json;
  position: number;
  created_at: string;
}

/** Polymorphic row for the title/detail display helpers. */
interface FolderDisplayRow {
  id: string;
  title?: string | null;
  handle?: string | null;
  status?: string | null;
  source_type?: string | null;
  url?: string | null;
  published_at?: string | null;
  channel_id?: string | null;
  channels?: { title: string | null } | null;
  latestViews?: number | null;
  outlier?: number | null;
  subscribers?: number | null;
  channelTitle?: string | null;
}

/** postgrest-js head-count query: select(columns, { count: "exact", head: true }). */
interface HeadCountQuery {
  select(
    columns: string,
    options: { count: "exact"; head: boolean },
  ): Promise<{ count: number | null; error: { message: string } | null }>;
}

async function countExact(admin: Admin, table: string, folderId: string): Promise<number> {
  const res = await (
    admin.from(table).eq("folder_id", folderId) as unknown as HeadCountQuery
  ).select("id", { count: "exact", head: true });
  if (res.error) throw new Error(res.error.message);
  return res.count ?? 0;
}

async function getAdmin(): Promise<Admin> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return adminDb(supabaseAdmin);
}

async function ownFolder(
  admin: Admin,
  userId: string,
  folderId: string,
): Promise<{ id: string; name: string; description: string } | null> {
  const { data, error } = await admin
    .from("folders")
    .select("id, name, description")
    .eq("id", folderId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { id: string; name: string; description: string } | null) ?? null;
}

const uuidSchema = z.string().uuid();
const folderIdSchema = z.object({ folderId: z.string().uuid() });

/* ------------------------------------------------------------------ */
/* createFolder                                                        */
/* ------------------------------------------------------------------ */

const createFolderSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).optional().default(""),
});

export const createFolder = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => createFolderSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    const { data: folder, error } = await admin
      .from("folders")
      .insert({ user_id: userId, name: data.name, description: data.description })
      .select("id, name, description, created_at, updated_at")
      .single<FolderListRow>();
    if (error) throw new Error(error.message);
    return { status: "ok" as const, folder };
  });

/* ------------------------------------------------------------------ */
/* listFolders (with itemCount, ruleCount)                             */
/* ------------------------------------------------------------------ */

export const listFolders = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({}).parse(i))
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    const { data: folders, error } = await admin
      .from("folders")
      .select("id, name, description, created_at, updated_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const out = [];
    for (const f of (folders ?? []) as FolderListRow[]) {
      const [itemCount, ruleCount] = await Promise.all([
        countExact(admin, "folder_items", f.id),
        countExact(admin, "folder_rules", f.id),
      ]);
      out.push({
        id: f.id,
        name: f.name,
        description: f.description,
        created_at: f.created_at,
        updated_at: f.updated_at,
        itemCount: itemCount ?? 0,
        ruleCount: ruleCount ?? 0,
      });
    }
    return { status: "ok" as const, folders: out };
  });

/* ------------------------------------------------------------------ */
/* updateFolder / deleteFolder                                         */
/* ------------------------------------------------------------------ */

const updateFolderSchema = z.object({
  folderId: z.string().uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
});

export const updateFolder = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => updateFolderSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    const existing = await ownFolder(admin, userId, data.folderId);
    if (!existing) throw new Error("Folder not found");
    const patch: Record<string, string> = {};
    if (data.name !== undefined) patch["name"] = data.name;
    if (data.description !== undefined) patch["description"] = data.description;
    const { data: folder, error } = await admin
      .from("folders")
      .update(patch)
      .eq("id", data.folderId)
      .eq("user_id", userId)
      .select("id, name, description, created_at, updated_at")
      .single<FolderListRow>();
    if (error) throw new Error(error.message);
    return { status: "ok" as const, folder };
  });

export const deleteFolder = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => folderIdSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    const existing = await ownFolder(admin, userId, data.folderId);
    if (!existing) throw new Error("Folder not found");
    // folder_rules / folder_items cascade on delete.
    const { error } = await admin
      .from("folders")
      .delete()
      .eq("id", data.folderId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { status: "ok" as const };
  });

/* ------------------------------------------------------------------ */
/* addRule / removeRule                                                */
/* ------------------------------------------------------------------ */

export const addRule = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => addRuleSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    const existing = await ownFolder(admin, userId, data.folderId);
    if (!existing) throw new Error("Folder not found");
    const count = await countExact(admin, "folder_rules", data.folderId);
    const { data: rule, error } = await admin
      .from("folder_rules")
      .insert({
        folder_id: data.folderId,
        field: data.field,
        operator: data.operator,
        value: (data.value ?? null) as Json,
        position: count,
      })
      .select("id, folder_id, field, operator, value, position, created_at")
      .single<FolderRuleRow>();
    if (error) throw new Error(error.message);
    return { status: "ok" as const, rule };
  });

const removeRuleSchema = z.object({ ruleId: z.string().uuid() });

export const removeRule = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => removeRuleSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    const { data: rule, error: findError } = await admin
      .from("folder_rules")
      .select("id, folder_id, folders!inner(user_id)")
      .eq("id", data.ruleId)
      .maybeSingle<RuleOwnershipRow>();
    if (findError) throw new Error(findError.message);
    if (!rule || rule.folders?.user_id !== userId) {
      throw new Error("Rule not found");
    }
    const { error } = await admin.from("folder_rules").delete().eq("id", data.ruleId);
    if (error) throw new Error(error.message);
    return { status: "ok" as const };
  });

/* ------------------------------------------------------------------ */
/* pinItem / unpinItem                                                 */
/* ------------------------------------------------------------------ */

const pinSchema = z.object({
  folderId: z.string().uuid(),
  itemType: z.enum(FOLDER_ITEM_TYPES),
  itemId: z.string().uuid(),
});

export const pinItem = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => pinSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    const existing = await ownFolder(admin, userId, data.folderId);
    if (!existing) throw new Error("Folder not found");
    // Validate the referenced row exists (table name from strict whitelist).
    const { data: target, error: targetError } = await admin
      .from(ITEM_TABLE[data.itemType])
      .select("id")
      .eq("id", data.itemId)
      .eq("user_id", userId)
      .maybeSingle();
    if (targetError) throw new Error(targetError.message);
    if (!target) throw new Error("Item not found");
    const { error } = await admin.from("folder_items").upsert(
      {
        folder_id: data.folderId,
        item_type: data.itemType,
        item_id: data.itemId,
      },
      { onConflict: "folder_id,item_type,item_id", ignoreDuplicates: true },
    );
    if (error) throw new Error(error.message);
    return { status: "ok" as const, pinned: true as const };
  });

export const unpinItem = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => pinSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    const existing = await ownFolder(admin, userId, data.folderId);
    if (!existing) throw new Error("Folder not found");
    const { error } = await admin
      .from("folder_items")
      .delete()
      .eq("folder_id", data.folderId)
      .eq("item_type", data.itemType)
      .eq("item_id", data.itemId);
    if (error) throw new Error(error.message);
    return { status: "ok" as const };
  });

/* ------------------------------------------------------------------ */
/* getFolderContents — pinned + server-side rule matching               */
/* ------------------------------------------------------------------ */

/** JSON-serializable rule value (matches the folder_rules.value jsonb column). */
export type RuleValue = string | number | boolean | null | Array<string | number | boolean>;

/** A stored rule row, returned alongside contents so the UI can list/remove. */
export interface FolderRule {
  id: string;
  field: RuleField;
  operator: RuleOperator;
  value: RuleValue;
  position: number;
}

const RULE_SCAN_LIMIT = 500;

function fmtViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function itemDetailFor(type: FolderItemType, row: FolderDisplayRow): string | null {
  switch (type) {
    case "videos": {
      const bits: string[] = [];
      if (typeof row.latestViews === "number") bits.push(`${fmtViews(row.latestViews)} views`);
      if (typeof row.outlier === "number") bits.push(`${row.outlier.toFixed(1)}× outlier`);
      if (row.channelTitle) bits.push(row.channelTitle);
      return bits.length ? bits.join(" · ") : null;
    }
    case "video_ideas":
      return row.status ? `status: ${row.status}` : null;
    case "research_sources": {
      const bits: string[] = [];
      if (row.source_type) bits.push(row.source_type);
      if (row.url) bits.push(row.url);
      return bits.length ? bits.join(" · ") : null;
    }
    case "channels": {
      const bits: string[] = [];
      if (typeof row.subscribers === "number") bits.push(`${fmtViews(row.subscribers)} subs`);
      if (row.handle) bits.push(row.handle);
      return bits.length ? bits.join(" · ") : null;
    }
  }
}

function titleFor(type: FolderItemType, row: FolderDisplayRow): string {
  switch (type) {
    case "videos":
      return row.title || "Untitled video";
    case "video_ideas":
      return row.title || "Untitled idea";
    case "research_sources":
      return row.title || row.url || "Untitled source";
    case "channels":
      return row.title || row.handle || "Untitled channel";
  }
}

/** Latest snapshot view count per video id. */
async function latestVideoViews(admin: Admin, videoIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (videoIds.length === 0) return map;
  const { data, error } = await admin
    .from("video_snapshots")
    .select("video_id, view_count, captured_at")
    .in("video_id", videoIds)
    .order("captured_at", { ascending: false });
  if (error) throw new Error(error.message);
  for (const s of (data ?? []) as VideoSnapshotLite[]) {
    if (!map.has(s.video_id) && typeof s.view_count === "number") {
      map.set(s.video_id, s.view_count);
    }
  }
  return map;
}

/** Latest snapshot subscriber count per channel id. */
async function latestChannelSubs(admin: Admin, channelIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (channelIds.length === 0) return map;
  const { data, error } = await admin
    .from("channel_snapshots")
    .select("channel_id, subscriber_count, captured_at")
    .in("channel_id", channelIds)
    .order("captured_at", { ascending: false });
  if (error) throw new Error(error.message);
  for (const s of (data ?? []) as ChannelSnapshotLite[]) {
    if (!map.has(s.channel_id) && typeof s.subscriber_count === "number") {
      map.set(s.channel_id, s.subscriber_count);
    }
  }
  return map;
}

function videoCandidate(
  field: RuleField,
  row: FolderDisplayRow,
  latestViews: Map<string, number>,
  siblingViews: number[],
): unknown {
  switch (field) {
    case "videos.view_count":
      return latestViews.get(row.id) ?? null;
    case "videos.outlier_score":
      return outlierScoreFor(latestViews.get(row.id) ?? null, siblingViews);
    case "videos.published_at":
      return row.published_at ?? null;
    default:
      return null;
  }
}

export const getFolderContents = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => folderIdSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const admin = await getAdmin();
    const existing = await ownFolder(admin, userId, data.folderId);
    if (!existing) throw new Error("Folder not found");

    /* ---- pinned items ---- */
    const { data: pinRows, error: pinError } = await admin
      .from("folder_items")
      .select("item_type, item_id, added_at")
      .eq("folder_id", data.folderId)
      .order("added_at", { ascending: false });
    if (pinError) throw new Error(pinError.message);

    const pinned: FolderItem[] = [];
    const byType = new Map<FolderItemType, string[]>();
    for (const p of (pinRows ?? []) as FolderPinRow[]) {
      const t = p.item_type as FolderItemType;
      if (!(FOLDER_ITEM_TYPES as readonly string[]).includes(t)) continue;
      const arr = byType.get(t) ?? [];
      arr.push(p.item_id as string);
      byType.set(t, arr);
    }
    for (const [type, ids] of byType) {
      const select =
        type === "videos"
          ? "id, title, published_at, channel_id, channels(title)"
          : type === "video_ideas"
            ? "id, title, status"
            : type === "research_sources"
              ? "id, title, url, source_type"
              : "id, title, handle";
      const { data: rows, error } = await admin
        .from(ITEM_TABLE[type])
        .select(select)
        .in("id", ids)
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
      const views = type === "videos" ? await latestVideoViews(admin, ids) : new Map();
      const subs = type === "channels" ? await latestChannelSubs(admin, ids) : new Map();
      for (const row of (rows ?? []) as FolderDisplayRow[]) {
        const enriched = {
          ...row,
          latestViews: views.get(row.id),
          subscribers: subs.get(row.id),
          channelTitle: row.channels?.title ?? null,
        };
        pinned.push({
          itemType: type,
          itemId: row.id,
          title: titleFor(type, row),
          detail: itemDetailFor(type, enriched),
        });
      }
    }

    /* ---- rule-matched items ---- */
    const { data: ruleRows, error: ruleError } = await admin
      .from("folder_rules")
      .select("id, field, operator, value, position")
      .eq("folder_id", data.folderId)
      .order("position", { ascending: true });
    if (ruleError) throw new Error(ruleError.message);
    const rules = (ruleRows ?? []) as FolderRule[];
    const pinnedKeys = new Set(pinned.map((p) => `${p.itemType}:${p.itemId}`));
    const ruleMatched: FolderItem[] = [];
    if (rules.length > 0) {
      const rulesByTable = new Map<string, typeof rules>();
      for (const r of rules) {
        const table = r.field.split(".")[0]!;
        const arr = rulesByTable.get(table) ?? [];
        arr.push(r);
        rulesByTable.set(table, arr);
      }

      const matchAll = (
        table: string,
        _row: unknown,
        candidateOf: (field: RuleField) => unknown,
      ): boolean =>
        (rulesByTable.get(table) ?? []).every((r) =>
          evaluateRule(r.field, r.operator, r.value, candidateOf(r.field)),
        );

      // videos
      if (rulesByTable.has("videos")) {
        const { data: videos, error } = await admin
          .from("videos")
          .select("id, title, published_at, channel_id, channels(title)")
          .eq("user_id", userId)
          .order("published_at", { ascending: false })
          .limit(RULE_SCAN_LIMIT);
        if (error) throw new Error(error.message);
        const list = (videos ?? []) as VideoRuleRow[];
        const views = await latestVideoViews(
          admin,
          list.map((v) => v.id as string),
        );
        // Sibling views per channel for the channel-median math.
        const byChannel = new Map<string, number[]>();
        for (const v of list) {
          const ch = (v.channel_id as string | null) ?? "__none__";
          const arr = byChannel.get(ch) ?? [];
          const vw = views.get(v.id as string);
          if (typeof vw === "number") arr.push(vw);
          byChannel.set(ch, arr);
        }
        for (const v of list) {
          const ch = (v.channel_id as string | null) ?? "__none__";
          const siblings = byChannel.get(ch) ?? [];
          const latest = views.get(v.id as string) ?? null;
          const outlier = outlierScoreFor(latest, siblings);
          const enriched = {
            ...v,
            latestViews: latest,
            outlier,
            channelTitle: v.channels?.title ?? null,
          };
          if (matchAll("videos", v, (f) => videoCandidate(f, v, views, siblings))) {
            const key = `videos:${v.id}`;
            if (!pinnedKeys.has(key)) {
              ruleMatched.push({
                itemType: "videos",
                itemId: v.id,
                title: titleFor("videos", v),
                detail: itemDetailFor("videos", enriched),
              });
            }
          }
        }
      }

      // video_ideas
      if (rulesByTable.has("video_ideas")) {
        const { data: ideas, error } = await admin
          .from("video_ideas")
          .select("id, title, status")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(RULE_SCAN_LIMIT);
        if (error) throw new Error(error.message);
        for (const row of (ideas ?? []) as IdeaRow[]) {
          if (
            matchAll("video_ideas", row, (f) =>
              f === "video_ideas.status" ? (row.status ?? null) : null,
            )
          ) {
            const key = `video_ideas:${row.id}`;
            if (!pinnedKeys.has(key)) {
              ruleMatched.push({
                itemType: "video_ideas",
                itemId: row.id,
                title: titleFor("video_ideas", row),
                detail: itemDetailFor("video_ideas", row),
              });
            }
          }
        }
      }

      // research_sources
      if (rulesByTable.has("research_sources")) {
        const { data: sources, error } = await admin
          .from("research_sources")
          .select("id, title, url, source_type")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(RULE_SCAN_LIMIT);
        if (error) throw new Error(error.message);
        for (const row of (sources ?? []) as SourceRow[]) {
          if (
            matchAll("research_sources", row, (f) =>
              f === "research_sources.source_type" ? (row.source_type ?? null) : null,
            )
          ) {
            const key = `research_sources:${row.id}`;
            if (!pinnedKeys.has(key)) {
              ruleMatched.push({
                itemType: "research_sources",
                itemId: row.id,
                title: titleFor("research_sources", row),
                detail: itemDetailFor("research_sources", row),
              });
            }
          }
        }
      }

      // channels
      if (rulesByTable.has("channels")) {
        const { data: channels, error } = await admin
          .from("channels")
          .select("id, title, handle")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(RULE_SCAN_LIMIT);
        if (error) throw new Error(error.message);
        const list = (channels ?? []) as ChannelRuleRow[];
        const subs = await latestChannelSubs(
          admin,
          list.map((c) => c.id as string),
        );
        for (const c of list) {
          const enriched = { ...c, subscribers: subs.get(c.id) ?? null };
          if (
            matchAll("channels", c, (f) =>
              f === "channels.subscriber_count" ? (subs.get(c.id) ?? null) : null,
            )
          ) {
            const key = `channels:${c.id}`;
            if (!pinnedKeys.has(key)) {
              ruleMatched.push({
                itemType: "channels",
                itemId: c.id,
                title: titleFor("channels", c),
                detail: itemDetailFor("channels", enriched),
              });
            }
          }
        }
      }
    }

    return { status: "ok" as const, pinned, ruleMatched, rules };
  });

// uuidSchema is re-exported for tests that build inputs.
export { uuidSchema };
