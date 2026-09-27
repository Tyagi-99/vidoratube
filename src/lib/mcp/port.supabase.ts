/**
 * Phase 4 Stream E (F41) — MCP data port backed by Supabase (service role).
 *
 * SERVER-ONLY. Production implementation of `McpDataPort` from
 * `./server.ts`. Several tables (`channels`, `scripts`, `analytics_snapshots`,
 * …) are not in the generated Database types, so this module goes through
 * the structural `UntypedDb` surface from `../api-keys/keys.server`.
 *
 * Identity rule (D154): an API key acts as its creator (`created_by`) inside
 * its workspace. User-scoped tables are filtered by the creator's user id;
 * workspace-scoped reads additionally accept the key's workspace id.
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  makeSupabaseScriptPort,
  saveScriptVersion,
  generateScriptDraft,
} from "@/lib/creation/scripts/scripts.functions";
import type { ScriptSection } from "@/lib/creation/scripts/types";
import { type UntypedDb } from "../api-keys/keys.server";
import { McpError } from "./server";
import type {
  McpAnalytics,
  McpChannelDetail,
  McpChannelSummary,
  McpDataPort,
  McpDraftScriptResult,
  McpGenerateResult,
  McpLearning,
  McpProjectDetail,
  McpProjectSummary,
  McpPublishRequestResult,
} from "./server";

type Row = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

export function makeSupabaseMcpPort(admin: SupabaseClient<Database>): McpDataPort {
  const db = admin as unknown as UntypedDb;
  const scriptPort = makeSupabaseScriptPort(admin);

  async function list(
    table: string,
    build: (
      q: import("../api-keys/keys.server").UntypedQuery,
    ) => import("../api-keys/keys.server").UntypedQuery,
  ): Promise<Row[]> {
    const { data, error } = await build(db.from(table).select());
    if (error) throw new McpError("db_error", `Database read failed: ${error.message}`, 500);
    return (data ?? []) as Row[];
  }

  async function requireProject(userId: string, projectId: string): Promise<Row> {
    const rows = await list("projects", (q) =>
      q.select("id, title, user_id").eq("id", projectId).eq("user_id", userId).limit(1),
    );
    const project = rows[0];
    if (!project) throw new McpError("project_not_found", "Project not found", 404);
    return project;
  }

  async function requireChannel(
    userId: string,
    workspaceId: string,
    channelId: string,
  ): Promise<Row> {
    // Workspace channel, or the key owner's personal (workspace-less) channel.
    const wsRows = await list("channels", (q) =>
      q.select("*").eq("id", channelId).eq("workspace_id", workspaceId).limit(1),
    );
    if (wsRows[0]) return wsRows[0];
    const ownRows = await list("channels", (q) =>
      q.select("*").eq("id", channelId).eq("user_id", userId).is("workspace_id", null).limit(1),
    );
    if (ownRows[0]) return ownRows[0];
    throw new McpError("channel_not_found", "Channel not found", 404);
  }

  function toSummary(r: Row): McpChannelSummary {
    return {
      id: String(r["id"]),
      platform: str(r["platform"]) ?? "youtube",
      handle: str(r["handle"]),
      title: str(r["title"]),
      is_own: r["is_own"] === true,
      status: r["tracked"] === false ? "untracked" : "tracked",
    };
  }

  async function latestSnapshot(channelId: string): Promise<McpChannelDetail["latest_snapshot"]> {
    const rows = await list("analytics_snapshots", (q) =>
      q
        .select("snapshot_date, metrics, revenue_usd, revenue_basis")
        .eq("channel_id", channelId)
        .order("snapshot_date", { ascending: false })
        .limit(1),
    );
    const s = rows[0];
    if (!s) return null;
    return {
      snapshot_date: str(s["snapshot_date"]) ?? "",
      metrics: (s["metrics"] as Record<string, unknown>) ?? {},
      revenue_usd: num(s["revenue_usd"]),
      revenue_basis: str(s["revenue_basis"]) ?? "estimate",
    };
  }

  return {
    async searchChannels({ userId, workspaceId, query, limit }) {
      const q = query.toLowerCase();
      const [wsRows, ownRows] = await Promise.all([
        list("channels", (qq) =>
          qq
            .select("id, platform, handle, title, is_own, tracked")
            .eq("workspace_id", workspaceId)
            .limit(limit * 3),
        ),
        list("channels", (qq) =>
          qq
            .select("id, platform, handle, title, is_own, tracked")
            .eq("user_id", userId)
            .is("workspace_id", null)
            .limit(limit * 3),
        ),
      ]);
      const seen = new Set<string>();
      const out: McpChannelSummary[] = [];
      for (const r of [...wsRows, ...ownRows]) {
        const id = String(r["id"]);
        if (seen.has(id)) continue;
        const hay =
          `${str(r["handle"]) ?? ""} ${str(r["title"]) ?? ""} ${str(r["platform"]) ?? ""}`.toLowerCase();
        if (!hay.includes(q)) continue;
        seen.add(id);
        out.push(toSummary(r));
        if (out.length >= limit) break;
      }
      return out;
    },

    async getChannel({ userId, workspaceId, channelId }) {
      let row: Row;
      try {
        row = await requireChannel(userId, workspaceId, channelId);
      } catch (e) {
        if (e instanceof McpError && e.code === "channel_not_found") return null;
        throw e;
      }
      return {
        ...toSummary(row),
        external_channel_id: str(row["external_channel_id"]) ?? "",
        latest_snapshot: await latestSnapshot(channelId),
      };
    },

    async listProjects({ userId, limit }) {
      const rows = await list("projects", (q) =>
        q
          .select("id, title, topic, status, updated_at")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(limit),
      );
      return rows.map((r): McpProjectSummary => ({
        id: String(r["id"]),
        title: str(r["title"]) ?? "Untitled project",
        topic: str(r["topic"]) ?? "",
        status: str(r["status"]) ?? "draft",
        updated_at: str(r["updated_at"]) ?? "",
      }));
    },

    async getProject({ userId, projectId }) {
      const rows = await list("projects", (q) =>
        q
          .select("id, title, topic, status, mode, language, duration_minutes, updated_at")
          .eq("id", projectId)
          .eq("user_id", userId)
          .limit(1),
      );
      const p = rows[0];
      if (!p) return null;
      const scripts = await list("scripts", (q) =>
        q
          .select("id, title, status, word_count, current_version_id")
          .eq("project_id", projectId)
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(1),
      );
      const s = scripts[0];
      let versionNumber: number | null = null;
      if (s?.["current_version_id"]) {
        const vrows = await list("script_versions", (q) =>
          q.select("version_number").eq("id", String(s["current_version_id"])).limit(1),
        );
        versionNumber = num(vrows[0]?.["version_number"]);
      }
      const detail: McpProjectDetail = {
        id: String(p["id"]),
        title: str(p["title"]) ?? "Untitled project",
        topic: str(p["topic"]) ?? "",
        status: str(p["status"]) ?? "draft",
        updated_at: str(p["updated_at"]) ?? "",
        mode: str(p["mode"]) ?? "stock",
        language: str(p["language"]) ?? "English",
        duration_minutes: num(p["duration_minutes"]) ?? 5,
        latest_script: s
          ? {
              id: String(s["id"]),
              title: str(s["title"]) ?? "Untitled script",
              status: str(s["status"]) ?? "draft",
              version_number: versionNumber,
              word_count: num(s["word_count"]) ?? 0,
            }
          : null,
      };
      return detail;
    },

    async createDraftScript({ userId, projectId, title, sections }) {
      await requireProject(userId, projectId);
      const created = await scriptPort.createScript(userId, projectId, title);
      // D156: the ONLY status this path may ever produce is 'draft'.
      if (created.status !== "draft") {
        throw new McpError("invariant_violated", "Script was not created as a draft", 500);
      }
      const withIds: ScriptSection[] = sections.map((s) => ({
        id: randomUUID(),
        heading: s.heading,
        body: s.body,
      }));
      const { version } = await saveScriptVersion(
        scriptPort,
        userId,
        created.id,
        withIds,
        "MCP vidora.draft_script (verbatim)",
      );
      const result: McpDraftScriptResult = {
        script_id: created.id,
        version_number: version.version_number,
        status: "draft",
      };
      return result;
    },

    async generateScriptDraft({ userId, projectId, topic, sectionCount }) {
      await requireProject(userId, projectId);
      const out = await generateScriptDraft(scriptPort, admin, userId, {
        projectId,
        topic,
        sectionCount,
      });
      if (!out.ok) {
        return {
          ok: false,
          code: out.error?.code ?? "generation_failed",
          message: out.error?.message ?? "Script generation failed",
        };
      }
      const result: McpGenerateResult = {
        script_id: out.output!.scriptId,
        version_number: out.output!.versionNumber,
        status: "draft",
        estimated_credits: out.estimatedCost ?? null,
        actual_credits: out.actualCost ?? null,
      };
      return {
        ok: true,
        result,
        estimatedCredits: out.estimatedCost ?? null,
        actualCredits: out.actualCost ?? null,
      };
    },

    async createDraftPublishJob({
      userId,
      workspaceId,
      projectId,
      title,
      description,
      tags,
      privacy,
      scheduledFor,
    }) {
      await requireProject(userId, projectId);
      // D156: status is hardcoded to 'draft' — the tool schema has no status
      // field, so no caller input can ever reach any other state.
      const { data, error } = await db
        .from("publish_jobs")
        .insert({
          user_id: userId,
          workspace_id: workspaceId,
          project_id: projectId,
          status: "draft",
          title,
          description,
          tags,
          privacy,
          scheduled_for: scheduledFor,
        })
        .select("id, status")
        .single();
      if (error)
        throw new McpError("db_error", `Could not create draft publish job: ${error.message}`, 500);
      const row = data as unknown as { id: string; status: string };
      if (row.status !== "draft") {
        throw new McpError("invariant_violated", "Publish job was not created as a draft", 500);
      }
      const result: McpPublishRequestResult = { publish_job_id: row.id, status: "draft" };
      return result;
    },

    async getChannelAnalytics({ userId, workspaceId, channelId }) {
      try {
        await requireChannel(userId, workspaceId, channelId);
      } catch (e) {
        if (e instanceof McpError && e.code === "channel_not_found") return null;
        throw e;
      }
      const analytics: McpAnalytics = {
        channel_id: channelId,
        snapshot: await latestSnapshot(channelId),
      };
      return analytics;
    },

    async listLearnings({ userId, status, limit }) {
      const rows = await list("learning_insights", (q) => {
        let qq = q
          .select("id, kind, status, confidence, payload, evidence, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(limit);
        if (status) qq = qq.eq("status", status);
        return qq;
      });
      return rows.map((r): McpLearning => {
        const payload = (r["payload"] as Record<string, unknown>) ?? {};
        const aiMined =
          payload["origin"] === "ai_analysis" ||
          payload["ai_mined"] === true ||
          payload["mined_by"] === "ai";
        return {
          id: String(r["id"]),
          kind: str(r["kind"]) ?? "pattern",
          status: str(r["status"]) ?? "proposed",
          confidence: num(r["confidence"]),
          origin: aiMined ? "ai_analysis" : "manual",
          evidence: (r["evidence"] as Record<string, unknown> | null) ?? null,
          created_at: str(r["created_at"]) ?? "",
        };
      });
    },
  };
}
