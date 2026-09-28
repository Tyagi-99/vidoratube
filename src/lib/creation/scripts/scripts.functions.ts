/**
 * F12 Script Studio — server functions.
 *
 * Section-based script editor with append-only version history:
 *  - every save writes a new `script_versions` row (never mutates history);
 *  - restore = a new version copying an old one;
 *  - status flow draft → in_review → approved → locked;
 *  - LOCKED IS SERVER-ENFORCED: save/restore/status-edit fns throw
 *    `ScriptLockedError` while a script is locked (the client cannot be
 *    trusted to hide the buttons);
 *  - approving a script under strict mode runs the F11 gate first and
 *    refuses while any claim lacks a human CONFIRM (fail-closed, D105 —
 *    waived counts as unconfirmed under strict mode);
 *  - brand-voice binding READS `brand_profiles` (Stream A owns CRUD) and
 *    injects tone/vocabulary/persona/do/don't/sample into generation prompts.
 *
 * Paid LLM ops: `generateScriptDraft` runs the credit preflight gate first
 * (ESTIMATE → balance → budget), returns a `ProviderResult` envelope
 * (never throws for provider states), and debits 1 credit on success via the
 * idempotent ledger RPC — the same pattern as research.functions.ts.
 *
 * Client-bundle rule: no top-level `node:*` imports; server-only modules via
 * dynamic import() inside handlers.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireAppUser } from "@/lib/server-auth";
import type { ProviderResult } from "@/lib/providers/contracts";
import {
  BrandVoiceContextSchema,
  ScriptSectionsSchema,
  ScriptStatusSchema,
  validateStatusTransition,
  type BrandVoiceContext,
  type ScriptRow,
  type ScriptSection,
  type ScriptStatus,
  type ScriptVersionRow,
} from "./types";
import { estimateScriptTiming } from "./timing";
import { diffScriptVersions, type ScriptDiff } from "./diff";
import { evaluateStrictGate } from "../claims/linker";

/** Minimal surface of the service-role client used by this module. */
export type AdminDb = Pick<SupabaseClient, "from">;
type Db = AdminDb;

const SCRIPT_MODEL = "google/gemini-3.5-flash";

/**
 * Deterministic script-generation adapter for E2E (D200).
 *
 * Active ONLY when VIDORA_E2E_ADAPTER=deterministic is set in the server
 * environment. Returns canned, topic-derived sections instead of calling the
 * Lovable AI gateway — no provider keys, no cost, fully reproducible. The
 * credit preflight, debit-first charge, and version-save path are unchanged,
 * so E2E still exercises the real billing + persistence code. Fail-closed:
 * any other value (or unset) keeps the production provider path.
 */
const DETERMINISTIC_ADAPTER_MODEL = "[adapter:deterministic-e2e] script-draft";

function isDeterministicAdapter(): boolean {
  return (
    typeof process !== "undefined" &&
    process.env["VIDORA_E2E_ADAPTER"] === "deterministic"
  );
}

function deterministicScriptContent(topic: string, sectionCount: number): string {
  const clean = topic.trim().slice(0, 200) || "Untitled topic";
  const count = Math.min(Math.max(sectionCount, 1), 20);
  const beats = ["Hook", "Setup", "Rising tension", "Climax", "Payoff"];
  const sections = Array.from({ length: count }, (_, i) => ({
    heading: i < beats.length ? beats[i]! : `Beat ${i + 1}`,
    body:
      `[deterministic-e2e] Narration for "${clean}" — section ${i + 1} of ${count}. ` +
      "This is a deterministic test draft: no AI provider was called. " +
      "Replace with real narration before publishing.",
  }));
  return JSON.stringify({ sections });
}
const SCRIPT_DEBIT_REASON = "script-studio: ai draft generation";

export class ScriptLockedError extends Error {
  constructor(scriptId: string) {
    super("Script is locked and read-only — unlock it to review state before editing");
    this.name = "ScriptLockedError";
    void scriptId;
  }
}

export type BrandProfileLite = { id: string; name: string };

export interface ScriptDataPort {
  getProject(
    userId: string,
    projectId: string,
  ): Promise<{ id: string; research_strict_mode: boolean } | null>;
  listScripts(userId: string, projectId: string): Promise<ScriptRow[]>;
  createScript(userId: string, projectId: string, title: string): Promise<ScriptRow>;
  getScript(userId: string, scriptId: string): Promise<ScriptRow | null>;
  getCurrentVersion(userId: string, scriptId: string): Promise<ScriptVersionRow | null>;
  getMaxVersionNumber(scriptId: string): Promise<number>;
  insertVersion(input: {
    scriptId: string;
    versionNumber: number;
    sections: ScriptSection[];
    fullText: string;
    wordCount: number;
    timing: ScriptVersionRow["timing"];
    createdBy: string;
    changeNote: string | null;
  }): Promise<ScriptVersionRow>;
  setCurrentVersion(scriptId: string, versionId: string, wordCount: number): Promise<void>;
  listVersions(userId: string, scriptId: string): Promise<ScriptVersionRow[]>;
  getVersion(
    userId: string,
    versionId: string,
  ): Promise<(ScriptVersionRow & { script_id: string }) | null>;
  setStatus(userId: string, scriptId: string, status: ScriptStatus): Promise<ScriptRow>;
  bindBrandProfile(
    userId: string,
    scriptId: string,
    brandProfileId: string | null,
  ): Promise<ScriptRow>;
  listBrandProfiles(userId: string): Promise<BrandProfileLite[]>;
  getBrandProfile(userId: string, brandProfileId: string): Promise<BrandVoiceContext | null>;
  listClaimReviewStates(
    userId: string,
    projectId: string,
  ): Promise<{ id: string; claim: string; review_state: "unreviewed" | "confirmed" | "waived" }[]>;
}

export function makeSupabaseScriptPort(admin: Db): ScriptDataPort {
  const check = (error: { message: string } | null, what: string) => {
    if (error) throw new Error(`${what}: ${error.message}`);
  };
  // Local helper (not a `this`-dependent object method) — keeps `this`
  // typing clean for TS.
  const getScript = async (userId: string, scriptId: string): Promise<ScriptRow | null> => {
    const { data, error } = await admin
      .from("scripts")
      .select("*")
      .eq("user_id", userId)
      .eq("id", scriptId)
      .single();
    if (error) return null;
    return data as ScriptRow;
  };
  return {
    async getProject(userId, projectId) {
      const { data, error } = await admin
        .from("projects")
        .select("id, research_strict_mode")
        .eq("user_id", userId)
        .eq("id", projectId)
        .single();
      if (error) return null;
      return data as { id: string; research_strict_mode: boolean };
    },

    async listScripts(userId, projectId) {
      const { data, error } = await admin
        .from("scripts")
        .select("*")
        .eq("user_id", userId)
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false });
      check(error, "listScripts");
      return (data ?? []) as ScriptRow[];
    },

    async createScript(userId, projectId, title) {
      const { data, error } = await admin
        .from("scripts")
        .insert({ user_id: userId, project_id: projectId, title })
        .select("*")
        .single();
      check(error, "createScript");
      return data as ScriptRow;
    },

    async getScript(userId, scriptId) {
      return getScript(userId, scriptId);
    },

    async getCurrentVersion(userId, scriptId) {
      const script = await getScript(userId, scriptId);
      if (!script?.current_version_id) return null;
      const { data, error } = await admin
        .from("script_versions")
        .select("*")
        .eq("id", script.current_version_id)
        .single();
      if (error) return null;
      return data as ScriptVersionRow;
    },

    async getMaxVersionNumber(scriptId) {
      const { data, error } = await admin
        .from("script_versions")
        .select("version_number")
        .eq("script_id", scriptId)
        .order("version_number", { ascending: false })
        .limit(1);
      check(error, "getMaxVersionNumber");
      const rows = (data ?? []) as { version_number: number }[];
      return rows.length > 0 ? (rows[0]?.version_number ?? 0) : 0;
    },

    async insertVersion(input) {
      const { data, error } = await admin
        .from("script_versions")
        .insert({
          script_id: input.scriptId,
          version_number: input.versionNumber,
          sections: input.sections,
          full_text: input.fullText,
          word_count: input.wordCount,
          timing: input.timing,
          created_by: input.createdBy,
          change_note: input.changeNote,
        })
        .select("*")
        .single();
      check(error, "insertVersion");
      return data as ScriptVersionRow;
    },

    async setCurrentVersion(scriptId, versionId, wordCount) {
      const { error } = await admin
        .from("scripts")
        .update({
          current_version_id: versionId,
          word_count: wordCount,
          updated_at: new Date().toISOString(),
        })
        .eq("id", scriptId);
      check(error, "setCurrentVersion");
    },

    async listVersions(userId, scriptId) {
      const script = await getScript(userId, scriptId);
      if (!script) throw new Error("Script not found");
      const { data, error } = await admin
        .from("script_versions")
        .select("*")
        .eq("script_id", scriptId)
        .order("version_number", { ascending: false });
      check(error, "listVersions");
      return (data ?? []) as ScriptVersionRow[];
    },

    async getVersion(userId, versionId) {
      const { data, error } = await admin
        .from("script_versions")
        .select("*, scripts!inner(user_id)")
        .eq("id", versionId)
        .single();
      if (error) return null;
      const row = data as ScriptVersionRow & { scripts: { user_id: string } };
      if (row.scripts.user_id !== userId) return null;
      return row;
    },

    async setStatus(userId, scriptId, status) {
      const { data, error } = await admin
        .from("scripts")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("id", scriptId)
        .select("*")
        .single();
      check(error, "setStatus");
      return data as ScriptRow;
    },

    async bindBrandProfile(userId, scriptId, brandProfileId) {
      const { data, error } = await admin
        .from("scripts")
        .update({
          brand_profile_id: brandProfileId,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("id", scriptId)
        .select("*")
        .single();
      check(error, "bindBrandProfile");
      return data as ScriptRow;
    },

    async listBrandProfiles(userId) {
      const { data, error } = await admin
        .from("brand_profiles")
        .select("id, name")
        .eq("user_id", userId)
        .order("name", { ascending: true });
      check(error, "listBrandProfiles");
      return (data ?? []) as BrandProfileLite[];
    },

    async getBrandProfile(userId, brandProfileId) {
      const { data, error } = await admin
        .from("brand_profiles")
        .select("id, name, tone, vocabulary, persona, do_list, dont_list, sample_text")
        .eq("user_id", userId)
        .eq("id", brandProfileId)
        .single();
      if (error) return null;
      const parsed = BrandVoiceContextSchema.safeParse(data);
      return parsed.success ? parsed.data : null;
    },

    async listClaimReviewStates(userId, projectId) {
      const { data, error } = await admin
        .from("research_claims")
        .select("id, claim, review_state, research_sources!inner(project_id)")
        .eq("user_id", userId)
        .eq("research_sources.project_id", projectId);
      check(error, "listClaimReviewStates");
      return (
        (data ?? []) as {
          id: string;
          claim: string;
          review_state: "unreviewed" | "confirmed" | "waived";
        }[]
      ).map(({ id, claim, review_state }) => ({ id, claim, review_state }));
    },
  };
}

/* ------------------------------------------------------------------ */
/* Business logic over the port (pure, unit-tested)                     */
/* ------------------------------------------------------------------ */

export function buildFullText(sections: ScriptSection[]): string {
  return sections.map((s) => `${s.heading}\n${s.body}`.trim()).join("\n\n");
}

export type SaveVersionResult = { version: ScriptVersionRow; script: ScriptRow };

/**
 * Save a new version (append-only history). Throws ScriptLockedError when
 * the script is locked. Every save → exactly one new script_versions row.
 */
export async function saveScriptVersion(
  port: ScriptDataPort,
  userId: string,
  scriptId: string,
  sections: ScriptSection[],
  changeNote: string | null,
): Promise<SaveVersionResult> {
  const script = await port.getScript(userId, scriptId);
  if (!script) throw new Error("Script not found");
  if (script.status === "locked") throw new ScriptLockedError(scriptId);

  const parsed = ScriptSectionsSchema.parse(sections);
  const timing = estimateScriptTiming(parsed);
  const wordCount = timing.totalWords;
  const versionNumber = (await port.getMaxVersionNumber(scriptId)) + 1;

  const version = await port.insertVersion({
    scriptId,
    versionNumber,
    sections: parsed.map((s) => ({
      ...s,
      estSeconds: timing.sections.find((t) => t.id === s.id)?.estSeconds ?? 0,
    })),
    fullText: buildFullText(parsed),
    wordCount,
    timing: {
      sections: Object.fromEntries(timing.sections.map((t) => [t.id, t.estSeconds])),
      totalSeconds: timing.totalSeconds,
      wpm: timing.wpm,
    },
    createdBy: userId,
    changeNote,
  });
  await port.setCurrentVersion(scriptId, version.id, wordCount);
  return { version, script: { ...script, word_count: wordCount, current_version_id: version.id } };
}

/** Restore = new version copying an old one (history stays append-only). */
export async function restoreScriptVersion(
  port: ScriptDataPort,
  userId: string,
  versionId: string,
): Promise<SaveVersionResult> {
  const version = await port.getVersion(userId, versionId);
  if (!version) throw new Error("Version not found");
  return saveScriptVersion(
    port,
    userId,
    version.script_id,
    version.sections,
    `Restored from v${version.version_number}`,
  );
}

export type SetStatusResult = { script: ScriptRow };

/**
 * Move a script through the status flow. Locked scripts can only be
 * unlocked (locked → in_review); approving under strict mode runs the F11
 * gate and fails closed while any claim is unreviewed.
 */
export async function setScriptStatus(
  port: ScriptDataPort,
  userId: string,
  scriptId: string,
  status: ScriptStatus,
): Promise<SetStatusResult> {
  const script = await port.getScript(userId, scriptId);
  if (!script) throw new Error("Script not found");
  validateStatusTransition(script.status, status);

  if (status === "approved") {
    const project = await port.getProject(userId, script.project_id);
    if (project?.research_strict_mode) {
      const claims = await port.listClaimReviewStates(userId, script.project_id);
      const gate = evaluateStrictGate({ strictMode: true, claims });
      if (gate.blocked) {
        throw new Error(
          `Strict mode is on: cannot approve while ${gate.blocking.length} claim${gate.blocking.length === 1 ? "" : "s"} lack${gate.blocking.length === 1 ? "s" : ""} a human CONFIRM. Confirm each claim in the Evidence Desk first (waived claims still block strict mode).`,
        );
      }
    }
  }

  return { script: await port.setStatus(userId, scriptId, status) };
}

/* ── AI draft generation (brand-voice prompt) ──────────────────────── */

/** Deterministic, sorted-key serialization for the brand vocabulary JSON blob. */
function serializeVocabulary(vocabulary: unknown): string {
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, val]) => [k, sortKeys(val)]),
      );
    }
    return v;
  };
  if (Array.isArray(vocabulary)) {
    return vocabulary
      .map((x) => (typeof x === "string" ? x : JSON.stringify(sortKeys(x))))
      .join("; ");
  }
  return JSON.stringify(sortKeys(vocabulary));
}

/** Pure prompt builder — unit-tested to carry the brand voice through. */
export function buildScriptPrompt(
  topic: string,
  sectionCount: number,
  brand: BrandVoiceContext | null,
): { system: string; user: string } {
  const vocab = brand ? serializeVocabulary(brand.vocabulary) : "";
  const vocabLine =
    vocab && vocab !== "{}" && vocab !== "[]" && vocab !== "null" ? `Vocabulary: ${vocab}` : "";
  const system = [
    "You are a YouTube scriptwriter. Respond with JSON only: an object with a",
    '"sections" array of { "heading": string, "body": string } — narration-ready',
    "prose, no stage directions, no markdown fences.",
    brand
      ? [
          "",
          "BRAND VOICE (follow it exactly):",
          `Tone: ${brand.tone || "(not specified)"}`,
          `Persona: ${brand.persona || "(not specified)"}`,
          brand.do_list.length > 0 ? `Always do: ${brand.do_list.join("; ")}` : "",
          brand.dont_list.length > 0 ? `Never do: ${brand.dont_list.join("; ")}` : "",
          vocabLine,
          brand.sample_text ? `Voice sample to match:\n${brand.sample_text}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  const user = `Write a ${sectionCount}-section video script about: ${topic}. Each section body ~120-180 words of spoken narration.`;
  return { system, user };
}

const GeneratedSectionsSchema = z.object({
  sections: z
    .array(z.object({ heading: z.string().min(1).max(120), body: z.string().min(1).max(20000) }))
    .min(1)
    .max(20),
});

export type GenerateDraftInput = {
  projectId: string;
  topic: string;
  sectionCount: number;
  brandProfileId?: string | undefined;
};

export type GenerateDraftOutput = ProviderResult<{
  scriptId: string;
  versionNumber: number;
  sections: ScriptSection[];
}>;

/**
 * Generate an AI script draft. Preflight-gated, ProviderResult envelope,
 * 1 credit debited BEFORE the draft is saved (debit-first convention, same
 * as publish/thumbnail flows: if the debit fails, nothing is persisted).
 * Never throws for provider/billing states — unconfigured / denied /
 * provider errors all arrive in the envelope so the UI can render them
 * honestly.
 */
export async function generateScriptDraft(
  port: ScriptDataPort,
  admin: SupabaseClient<Database>,
  userId: string,
  input: GenerateDraftInput,
): Promise<GenerateDraftOutput> {
  const fail = (
    status: ProviderResult<unknown>["status"],
    code: string,
    message: string,
  ): GenerateDraftOutput =>
    ({
      ok: false,
      output: null,
      model: null,
      taskId: null,
      latencyMs: 0,
      estimatedCost: null,
      actualCost: null,
      costCurrency: "credits",
      status,
      error: { code, message },
      usage: {},
    }) as GenerateDraftOutput;

  const started = Date.now();
  // One idempotency key per generation attempt: a retry spends another
  // credit (new output), a double-submit within the same attempt does not.
  const generationRef = crypto.randomUUID();
  const brand = input.brandProfileId
    ? await port.getBrandProfile(userId, input.brandProfileId)
    : null;

  // Preflight: ESTIMATE → balance → budget. The estimate needs token counts;
  // we estimate from the prompt we are about to send (labeled ESTIMATE).
  const { system, user } = buildScriptPrompt(input.topic, input.sectionCount, brand);
  const promptChars = system.length + user.length;
  const inputTokens = Math.max(1, Math.ceil(promptChars / 4));
  const outputTokens = Math.max(1, input.sectionCount * 260);
  const { preflightCreditsCheck } = await import("@/lib/credits/preflight.server");
  const preflight = await preflightCreditsCheck(admin, {
    userId,
    projectId: input.projectId,
    jobType: "llm_chat",
    provider: "lovable-ai",
    tokens: { input: inputTokens, output: outputTokens },
  });
  if (!preflight.ok) {
    return fail(
      "error",
      preflight.code,
      preflight.code === "INSUFFICIENT_CREDITS"
        ? "Not enough credits to generate a script draft."
        : preflight.code === "BUDGET_EXCEEDED"
          ? "This generation would exceed the project budget cap."
          : "Could not estimate the generation cost — refusing rather than spending blind.",
    );
  }

  const { recordApiCost, gatewayChatUnitCostUsd } = await import("@/lib/api-cost");
  let content: string;
  let usedInputTokens: number;
  let usedOutputTokens: number;
  let modelLabel = SCRIPT_MODEL;
  let draftNotePrefix = `AI-generated draft (${SCRIPT_MODEL})`;

  if (isDeterministicAdapter()) {
    // Deterministic E2E adapter (D200): skip the provider call entirely.
    content = deterministicScriptContent(input.topic, input.sectionCount);
    usedInputTokens = 0;
    usedOutputTokens = 0;
    modelLabel = DETERMINISTIC_ADAPTER_MODEL;
    draftNotePrefix = "[adapter:deterministic-e2e] deterministic draft";
    await recordApiCost(admin, {
      userId,
      provider: "lovable-ai",
      operation: "llm_script",
      units: 0,
      unitCostUsd: 0,
      meta: {
        adapter: "deterministic-e2e",
        model: modelLabel,
        input_tokens: 0,
        output_tokens: 0,
        cost_basis: "e2e-deterministic-zero",
      },
    });
  } else {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) {
      return fail(
        "unconfigured",
        "unconfigured",
        "AI script generation is not configured (LOVABLE_API_KEY is missing). Write sections manually or ask the workspace owner to connect AI.",
      );
    }

    let res: Response;
    try {
      res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: SCRIPT_MODEL,
          messages: [
            { role: "system", content: system + "\nRespond with JSON only. No markdown fences." },
            { role: "user", content: user },
          ],
          temperature: 0.7,
        }),
      });
    } catch (e) {
      return fail("error", "network_error", e instanceof Error ? e.message : "AI request failed");
    }
    if (!res.ok) {
      return fail("error", "provider_error", `AI request failed (${res.status})`);
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    content = json.choices?.[0]?.message?.content ?? "";

    // Cost bookkeeping: fail-open, never breaks the user's draft.
    usedInputTokens = Math.ceil(promptChars / 4);
    usedOutputTokens = Math.max(1, Math.ceil(content.length / 4));
    await recordApiCost(admin, {
      userId,
      provider: "lovable-ai",
      operation: "llm_script",
      units: usedInputTokens + usedOutputTokens,
      unitCostUsd: gatewayChatUnitCostUsd(usedInputTokens, usedOutputTokens),
      meta: {
        model: SCRIPT_MODEL,
        input_tokens: usedInputTokens,
        output_tokens: usedOutputTokens,
        cost_basis: "gateway-passthrough-estimate",
      },
    });
  }

  const parsed = GeneratedSectionsSchema.safeParse(tryParseJson(content));
  if (!parsed.success) {
    return fail(
      "error",
      "bad_response",
      "The AI returned an unparseable script — no draft was saved.",
    );
  }

  // Debit BEFORE persisting (debit-first convention): if the debit fails,
  // nothing is saved, so no unpaid output can remain. Matches the publish
  // thumbnail/SEO flows. The RPC is idempotent per generationRef.
  const { debitOneCreditForProject, OUT_OF_CREDITS_MESSAGE } = await import("@/lib/credits");
  try {
    await debitOneCreditForProject(admin, userId, generationRef, SCRIPT_DEBIT_REASON);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Credit debit failed";
    return fail(
      "error",
      msg === OUT_OF_CREDITS_MESSAGE ? "INSUFFICIENT_CREDITS" : "DEBIT_FAILED",
      msg === OUT_OF_CREDITS_MESSAGE
        ? "Not enough credits to complete the debit — no draft was saved."
        : `Credit debit failed (${msg}) — no draft was saved.`,
    );
  }

  // Persist as a new version on the project's latest script (or a new one).
  // A locked script is never written to — generation starts a fresh script.
  // crypto.randomUUID() is universal (browser + node) — see D86.
  const sections: ScriptSection[] = parsed.data.sections.map((s) => ({
    id: crypto.randomUUID(),
    heading: s.heading,
    body: s.body,
  }));
  const scripts = await port.listScripts(userId, input.projectId);
  let target = scripts[0] ?? null;
  if (!target || target.status === "locked") {
    target = await port.createScript(
      userId,
      input.projectId,
      `Script — ${input.topic.slice(0, 60)}`,
    );
  }
  const { version } = await saveScriptVersion(
    port,
    userId,
    target.id,
    sections,
    `${draftNotePrefix}${brand ? `, brand voice: ${brand.name}` : ""}`,
  );

  return {
    ok: true,
    output: { scriptId: target.id, versionNumber: version.version_number, sections },
    model: modelLabel,
    taskId: null,
    latencyMs: Date.now() - started,
    estimatedCost: preflight.estimate.credits,
    actualCost: 1,
    costCurrency: "credits",
    status: "ok",
    error: null,
    usage: { inputTokens: usedInputTokens, outputTokens: usedOutputTokens },
  };
}

function tryParseJson(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Strip markdown fences if the model added them despite instructions.
    const fenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try {
      return JSON.parse(fenced);
    } catch {
      return null;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Server functions                                                     */
/* ------------------------------------------------------------------ */

async function getPort(): Promise<ScriptDataPort> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return makeSupabaseScriptPort(supabaseAdmin);
}

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type ScriptDetail = {
  script: ScriptRow;
  version: ScriptVersionRow | null;
  brandVoice: BrandVoiceContext | null;
};

export const listProjectScripts = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ projectId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<ScriptRow[]> => {
    const { userId } = context;
    return (await getPort()).listScripts(userId, data.projectId);
  });

export const createProjectScript = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        title: z.string().trim().min(1).max(120).default("Untitled script"),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<ScriptRow> => {
    const { userId } = context;
    const port = await getPort();
    const project = await port.getProject(userId, data.projectId);
    if (!project) throw new Error("Project not found");
    const script = await port.createScript(userId, data.projectId, data.title);
    // A fresh script starts with one empty section so the editor has shape.
    // crypto.randomUUID() is universal (browser + node) — see D86.
    await saveScriptVersion(
      port,
      userId,
      script.id,
      [{ id: crypto.randomUUID(), heading: "Introduction", body: "" }],
      "Script created",
    );
    return (await port.getScript(userId, script.id))!;
  });

export const getScriptDetail = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ scriptId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<ScriptDetail> => {
    const { userId } = context;
    const port = await getPort();
    const script = await port.getScript(userId, data.scriptId);
    if (!script) throw new Error("Script not found");
    const [version, brandVoice] = await Promise.all([
      port.getCurrentVersion(userId, data.scriptId),
      script.brand_profile_id
        ? port.getBrandProfile(userId, script.brand_profile_id)
        : Promise.resolve(null),
    ]);
    return { script, version, brandVoice };
  });

export const saveScript = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        scriptId: z.string().uuid(),
        sections: ScriptSectionsSchema,
        changeNote: z.string().max(300).default(""),
      })
      .parse(i),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ versionNumber: number; totalSeconds: number; wordCount: number }> => {
      const { userId } = context;
      const { version } = await saveScriptVersion(
        await getPort(),
        userId,
        data.scriptId,
        data.sections,
        data.changeNote || null,
      );
      return {
        versionNumber: version.version_number,
        totalSeconds: version.timing.totalSeconds,
        wordCount: version.word_count,
      };
    },
  );

export const listScriptVersions = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ scriptId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<ScriptVersionRow[]> => {
    const { userId } = context;
    return (await getPort()).listVersions(userId, data.scriptId);
  });

export const diffScriptVersionPair = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z.object({ fromVersionId: z.string().uuid(), toVersionId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }): Promise<ScriptDiff[]> => {
    const { userId } = context;
    const port = await getPort();
    const [from, to] = await Promise.all([
      port.getVersion(userId, data.fromVersionId),
      port.getVersion(userId, data.toVersionId),
    ]);
    if (!from || !to) throw new Error("Version not found");
    return diffScriptVersions(from.sections, to.sections);
  });

export const restoreScriptVersionFn = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) => z.object({ versionId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<{ versionNumber: number }> => {
    const { userId } = context;
    const { version } = await restoreScriptVersion(await getPort(), userId, data.versionId);
    return { versionNumber: version.version_number };
  });

export const setScriptStatusFn = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z.object({ scriptId: z.string().uuid(), status: ScriptStatusSchema }).parse(i),
  )
  .handler(async ({ data, context }): Promise<ScriptRow> => {
    const { userId } = context;
    return (await setScriptStatus(await getPort(), userId, data.scriptId, data.status)).script;
  });

export const bindScriptBrandProfile = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z
      .object({ scriptId: z.string().uuid(), brandProfileId: z.string().uuid().nullable() })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<ScriptRow> => {
    const { userId } = context;
    const port = await getPort();
    const script = await port.getScript(userId, data.scriptId);
    if (!script) throw new Error("Script not found");
    if (script.status === "locked") throw new ScriptLockedError(data.scriptId);
    if (data.brandProfileId) {
      const profile = await port.getBrandProfile(userId, data.brandProfileId);
      if (!profile) throw new Error("Brand profile not found");
    }
    return port.bindBrandProfile(userId, data.scriptId, data.brandProfileId);
  });

export const listBrandVoiceProfiles = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .handler(async ({ context }): Promise<BrandProfileLite[]> => {
    const { userId } = context;
    return (await getPort()).listBrandProfiles(userId);
  });

export const generateScriptDraftFn = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        topic: z.string().trim().min(3).max(300),
        sectionCount: z.number().int().min(2).max(12).default(5),
        brandProfileId: z.string().uuid().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<GenerateDraftOutput> => {
    const { userId } = context;
    const port = await getPort();
    const project = await port.getProject(userId, data.projectId);
    if (!project) throw new Error("Project not found");
    return generateScriptDraft(port, await getAdmin(), userId, data);
  });
