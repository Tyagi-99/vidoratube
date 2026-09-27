/**
 * F35 — Learning engine domain logic (pure; no DB, no framework).
 *
 * Pinned contracts (docs/PHASE4_CONTRACTS.md):
 *   - learning_insights.status: proposed | validated | refuted | archived.
 *     Only `validated` learnings may feed brief advice.
 *   - evidence shape: { type, refs, metrics, sample }. A learning without
 *     evidence stays `proposed`. `confidence` 0–1 required to leave proposed.
 *   - AI-mined learnings are labeled "AI analysis" (source = 'ai_analysis').
 *
 * Convention: the human-readable text lives at payload.statement (the table
 * has no dedicated text column).
 */

import type { Json } from "@/integrations/supabase/types";

export const LEARNING_STATUSES = ["proposed", "validated", "refuted", "archived"] as const;
export type LearningStatus = (typeof LEARNING_STATUSES)[number];

export const LEARNING_KINDS = [
  "own_outlier",
  "pattern",
  "idea_boost",
  "safety_validation",
  "experiment_outcome",
  "comment_signal",
] as const;
export type LearningKind = (typeof LEARNING_KINDS)[number];

export const LEARNING_SOURCES = ["human", "ai_analysis", "system"] as const;
export type LearningSource = (typeof LEARNING_SOURCES)[number];

export const EVIDENCE_TYPES = [
  "experiment_outcome",
  "before_after",
  "comment_signal",
  "manual",
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export type EvidenceShape = {
  type: EvidenceType;
  refs: string[];
  metrics: Record<string, Json>;
  sample: number;
};

/**
 * Stored evidence: known optional fields plus any extra JSON keys.
 * Structured like a JSON object so TanStack server functions accept it.
 */
export interface LearningEvidence extends Record<string, Json> {
  type?: EvidenceType;
  refs?: string[];
  metrics?: Record<string, Json>;
  sample?: number;
}

export interface LearningRow {
  id: string;
  user_id: string;
  kind: LearningKind;
  topic: string;
  payload: Record<string, Json>;
  evidence: LearningEvidence;
  confidence: number | null;
  source: LearningSource;
  status: LearningStatus;
  experiment_id: string | null;
  created_at: string;
}

export interface EngagementInsightRow {
  id: string;
  user_id: string;
  kind: string;
  comment_id: string | null;
  payload: Record<string, Json>;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export class LearningValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LearningValidationError";
  }
}

export class EvidenceGateError extends Error {
  readonly reasons: string[];
  constructor(reasons: string[]) {
    super(`Evidence gate failed: ${reasons.join("; ")}`);
    this.name = "EvidenceGateError";
    this.reasons = reasons;
  }
}

/* ------------------------------------------------------------------ */
/* Evidence gate (D140)                                                */
/* ------------------------------------------------------------------ */

export interface GateCheck {
  ok: boolean;
  reasons: string[];
}

/**
 * A learning may leave `proposed` only with non-empty evidence AND a
 * confidence in (0, 1]. Confidence 0 is rejected — zero confidence is not
 * evidence.
 */
export function evidenceGateCheck(learning: {
  evidence: LearningRow["evidence"];
  confidence: number | null;
}): GateCheck {
  const reasons: string[] = [];
  const ev = learning.evidence ?? {};
  const hasRefs = Array.isArray(ev.refs) && ev.refs.length > 0;
  const hasMetrics =
    typeof ev.metrics === "object" && ev.metrics !== null && Object.keys(ev.metrics).length > 0;
  const hasSample = typeof ev.sample === "number" && ev.sample > 0;
  if (!hasRefs && !hasMetrics && !hasSample) {
    reasons.push("no evidence attached (needs refs, metrics, or a sample)");
  }
  const c = learning.confidence;
  if (c === null || c === undefined) {
    reasons.push("confidence is required to leave proposed (0–1)");
  } else if (!Number.isFinite(c) || c <= 0 || c > 1) {
    reasons.push("confidence must be within (0, 1]");
  }
  return { ok: reasons.length === 0, reasons };
}

export function assertCanPromote(learning: {
  status: LearningStatus;
  evidence: LearningRow["evidence"];
  confidence: number | null;
}): void {
  if (learning.status !== "proposed") {
    throw new LearningValidationError(
      `Only proposed learnings can be validated (status: ${learning.status}).`,
    );
  }
  const check = evidenceGateCheck(learning);
  if (!check.ok) throw new EvidenceGateError(check.reasons);
}

/* ------------------------------------------------------------------ */
/* Manual learning input                                               */
/* ------------------------------------------------------------------ */

export interface ManualLearningInput {
  kind: LearningKind;
  topic?: string | undefined;
  statement: string;
  evidence?: EvidenceShape | undefined;
  confidence?: number | null | undefined;
  experiment_id?: string | null | undefined;
}

export function validateManualLearning(input: ManualLearningInput): Omit<
  ManualLearningInput,
  "statement" | "evidence"
> & {
  statement: string;
  topic: string;
  evidence: LearningEvidence;
  confidence: number | null;
  experiment_id: string | null;
} {
  if (!(LEARNING_KINDS as readonly string[]).includes(input.kind)) {
    throw new LearningValidationError(`kind must be one of: ${LEARNING_KINDS.join(" | ")}.`);
  }
  const statement = (input.statement ?? "").trim();
  if (statement.length < 10 || statement.length > 2000) {
    throw new LearningValidationError("statement must be 10–2000 characters.");
  }
  const topic = (input.topic ?? "general").trim() || "general";
  if (input.confidence !== undefined && input.confidence !== null) {
    const c = input.confidence;
    if (!Number.isFinite(c) || c < 0 || c > 1) {
      throw new LearningValidationError("confidence must be within [0, 1].");
    }
  }
  if (input.evidence) {
    if (!(EVIDENCE_TYPES as readonly string[]).includes(input.evidence.type)) {
      throw new LearningValidationError(
        `evidence.type must be one of: ${EVIDENCE_TYPES.join(" | ")}.`,
      );
    }
  }
  return {
    kind: input.kind,
    topic,
    statement,
    evidence: (input.evidence ?? {}) as LearningEvidence,
    confidence: input.confidence ?? null,
    experiment_id: input.experiment_id ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Comment-signal drafts (read-only over Stream D's table, D142)       */
/* ------------------------------------------------------------------ */

export interface CommentSignalDraft {
  kind: "comment_signal";
  topic: "audience";
  statement: string;
  payload: Record<string, Json>;
  evidence: EvidenceShape;
  confidence: number;
  source: "system";
  status: "proposed";
}

const INSIGHT_KIND_LABELS: Record<string, string> = {
  audience_request: "audience requests",
  question: "recurring questions",
  sentiment_shift: "sentiment shifts",
  top_commenter: "top commenters",
  trend: "trend signals",
};

const COMMENT_SIGNAL_WINDOW_DAYS = 30;
const COMMENT_SIGNAL_MIN_COUNT = 3;

/**
 * Draft learnings from engagement insights (Stream D owns all writes to
 * that table — this function only reads rows passed in).
 *
 * @param insights            recent engagement_insights rows (any window)
 * @param alreadyDraftedKinds signal kinds drafted within the window already
 *                            (derived from existing learnings' payload)
 */
export function draftCommentSignalLearnings(
  insights: EngagementInsightRow[],
  alreadyDraftedKinds: string[],
  now: Date,
): CommentSignalDraft[] {
  const cutoff = now.getTime() - COMMENT_SIGNAL_WINDOW_DAYS * 86_400_000;
  const recent = insights.filter((i) => {
    const t = new Date(i.created_at).getTime();
    return !Number.isNaN(t) && t >= cutoff;
  });
  const byKind = new Map<string, EngagementInsightRow[]>();
  for (const i of recent) {
    const list = byKind.get(i.kind) ?? [];
    list.push(i);
    byKind.set(i.kind, list);
  }

  const drafts: CommentSignalDraft[] = [];
  for (const [kind, rows] of byKind) {
    if (rows.length < COMMENT_SIGNAL_MIN_COUNT) continue;
    if (alreadyDraftedKinds.includes(kind)) continue;
    const label = INSIGHT_KIND_LABELS[kind] ?? kind;
    // Surface the most common payload theme when present (honest: only when
    // the payloads actually carry one).
    const themes = rows
      .map((r) => r.payload?.["theme"] ?? r.payload?.["topic"] ?? null)
      .filter((t): t is string => typeof t === "string" && t.length > 0);
    const themeNote = themes.length > 0 ? ` Most common theme: "${mode(themes)}".` : "";
    const statement =
      `${rows.length} ${label} in the last ${COMMENT_SIGNAL_WINDOW_DAYS} days.` + themeNote;
    drafts.push({
      kind: "comment_signal",
      topic: "audience",
      statement,
      payload: {
        statement,
        signal_kind: kind,
        window_days: COMMENT_SIGNAL_WINDOW_DAYS,
        insight_count: rows.length,
      },
      evidence: {
        type: "comment_signal",
        refs: rows.map((r) => r.id),
        metrics: { by_kind: { [kind]: rows.length } },
        sample: rows.length,
      },
      confidence: 0.6,
      source: "system",
      status: "proposed",
    });
  }
  return drafts;
}

function mode(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0]!;
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Pattern mining (validated learnings only, D141)                     */
/* ------------------------------------------------------------------ */

export interface PatternDraft {
  kind: "pattern";
  topic: string;
  statement: string;
  payload: Record<string, Json>;
  evidence: EvidenceShape;
  confidence: number;
  source: "ai_analysis";
  status: "proposed";
}

interface LiftSample {
  learningId: string;
  liftPct: number;
}

/** Extract per-learning winner-vs-control lift from experiment evidence. */
function extractLift(learning: LearningRow): LiftSample | null {
  const metrics = learning.evidence?.metrics ?? {};
  const perArm = metrics["per_arm"];
  if (!Array.isArray(perArm)) return null;
  const field = (r: unknown, k: string): Json | undefined =>
    typeof r === "object" && r !== null ? (r as Record<string, Json>)[k] : undefined;
  const control = perArm.find((r) => field(r, "arm_type") === "control");
  const winner = perArm.find((r) => field(r, "significant_improvement") === true);
  const cv = field(control, "metric_value");
  const wv = field(winner, "metric_value");
  if (typeof cv !== "number" || typeof wv !== "number" || cv <= 0) return null;
  return { learningId: learning.id, liftPct: ((wv - cv) / cv) * 100 };
}

/**
 * Aggregate VALIDATED learnings into brief pattern advice, grouped by topic.
 * Every draft is source 'ai_analysis' (renders as "AI analysis"), cites the
 * underlying learning ids, and stays `proposed` for human validation.
 */
export function minePatternBriefs(validated: LearningRow[]): PatternDraft[] {
  const eligible = validated.filter((l) => l.status === "validated");
  const byTopic = new Map<string, LearningRow[]>();
  for (const l of eligible) {
    const list = byTopic.get(l.topic) ?? [];
    list.push(l);
    byTopic.set(l.topic, list);
  }

  const drafts: PatternDraft[] = [];
  for (const [topic, learnings] of byTopic) {
    const lifts = learnings.map(extractLift).filter((l): l is LiftSample => l !== null);
    const confidences = learnings
      .map((l) => l.confidence)
      .filter((c): c is number => typeof c === "number" && Number.isFinite(c));
    const totalSample = learnings.reduce(
      (s, l) => s + (typeof l.evidence?.sample === "number" ? l.evidence.sample : 0),
      0,
    );

    let statement: string;
    let metrics: Record<string, Json>;
    if (lifts.length > 0) {
      const vals = lifts.map((l) => l.liftPct).sort((a, b) => a - b);
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      const min = vals[0]!;
      const max = vals[vals.length - 1]!;
      const nExp = lifts.length;
      statement =
        `Across ${nExp} experiment${nExp === 1 ? "" : "s"}, ${topic} variants ` +
        `outperformed control by an average of ${avg.toFixed(1)}% ` +
        `(range ${min.toFixed(1)}%–${max.toFixed(1)}%).`;
      metrics = {
        n_learnings: learnings.length,
        n_experiments_with_lift: nExp,
        avg_lift_pct: Math.round(avg * 10) / 10,
        min_lift_pct: Math.round(min * 10) / 10,
        max_lift_pct: Math.round(max * 10) / 10,
      };
    } else {
      statement =
        `${learnings.length} validated learning${learnings.length === 1 ? "" : "s"} ` +
        `about ${topic} — no comparable lift figures to aggregate yet.`;
      metrics = { n_learnings: learnings.length };
    }

    drafts.push({
      kind: "pattern",
      topic,
      statement,
      payload: {
        statement,
        cited_learning_ids: learnings.map((l) => l.id),
      },
      evidence: {
        type: "experiment_outcome",
        refs: learnings.map((l) => l.id),
        metrics,
        sample: totalSample,
      },
      // Conservative: the brief is only as confident as its weakest citation.
      confidence: confidences.length > 0 ? Math.round(Math.min(...confidences) * 1000) / 1000 : 0.5,
      source: "ai_analysis",
      status: "proposed",
    });
  }
  return drafts;
}

/* ------------------------------------------------------------------ */
/* Store interface + lifecycle                                         */
/* ------------------------------------------------------------------ */

export interface LearningStore {
  getLearning(id: string): Promise<LearningRow | null>;
  /** Recent learnings for dedupe / listing. */
  listLearnings(filter: {
    userId: string;
    kinds?: LearningKind[] | undefined;
    statuses?: LearningStatus[] | undefined;
    since?: string | undefined;
    limit?: number | undefined;
  }): Promise<LearningRow[]>;
  listEngagementInsights(userId: string): Promise<EngagementInsightRow[]>;
  insertLearning(row: Omit<LearningRow, "id" | "created_at">): Promise<LearningRow>;
  patchLearning(
    id: string,
    patch: Partial<Pick<LearningRow, "status" | "confidence" | "evidence" | "payload">>,
  ): Promise<LearningRow>;
}

export async function promoteLearningLifecycle(
  store: LearningStore,
  id: string,
): Promise<LearningRow> {
  const learning = await store.getLearning(id);
  if (!learning) throw new LearningValidationError(`Learning not found: ${id}.`);
  assertCanPromote(learning);
  return store.patchLearning(id, { status: "validated" });
}

export async function refuteLearningLifecycle(
  store: LearningStore,
  id: string,
): Promise<LearningRow> {
  const learning = await store.getLearning(id);
  if (!learning) throw new LearningValidationError(`Learning not found: ${id}.`);
  if (learning.status === "archived") {
    throw new LearningValidationError("Archived learnings cannot be refuted.");
  }
  return store.patchLearning(id, { status: "refuted" });
}

export async function archiveLearningLifecycle(
  store: LearningStore,
  id: string,
): Promise<LearningRow> {
  const learning = await store.getLearning(id);
  if (!learning) throw new LearningValidationError(`Learning not found: ${id}.`);
  return store.patchLearning(id, { status: "archived" });
}

export async function createManualLearningLifecycle(
  store: LearningStore,
  userId: string,
  input: ManualLearningInput,
): Promise<LearningRow> {
  const v = validateManualLearning(input);
  return store.insertLearning({
    user_id: userId,
    kind: v.kind,
    topic: v.topic,
    payload: { statement: v.statement },
    evidence: v.evidence,
    confidence: v.confidence,
    source: "human",
    status: "proposed",
    experiment_id: v.experiment_id,
  });
}

export interface DraftOutcome {
  inserted: LearningRow[];
  skipped: string[];
}

/** Draft comment-signal learnings; skips kinds drafted in the last 30 days. */
export async function draftCommentSignalsLifecycle(
  store: LearningStore,
  userId: string,
  now: Date,
): Promise<DraftOutcome> {
  const [insights, recent] = await Promise.all([
    store.listEngagementInsights(userId),
    store.listLearnings({
      userId,
      kinds: ["comment_signal"],
      since: new Date(now.getTime() - 30 * 86_400_000).toISOString(),
      limit: 100,
    }),
  ]);
  const alreadyDraftedKinds = recent
    .map((l) => l.payload?.["signal_kind"])
    .filter((k): k is string => typeof k === "string");
  const drafts = draftCommentSignalLearnings(insights, alreadyDraftedKinds, now);
  const inserted: LearningRow[] = [];
  for (const d of drafts) {
    inserted.push(
      await store.insertLearning({
        user_id: userId,
        kind: d.kind,
        topic: d.topic,
        payload: d.payload,
        evidence: d.evidence as LearningRow["evidence"],
        confidence: d.confidence,
        source: d.source,
        status: d.status,
        experiment_id: null,
      }),
    );
  }
  return { inserted, skipped: alreadyDraftedKinds };
}

/** Mine pattern briefs from validated learnings (D141). */
export async function minePatternsLifecycle(
  store: LearningStore,
  userId: string,
): Promise<DraftOutcome> {
  const validated = await store.listLearnings({
    userId,
    statuses: ["validated"],
    limit: 500,
  });
  const drafts = minePatternBriefs(validated);
  const inserted: LearningRow[] = [];
  for (const d of drafts) {
    inserted.push(
      await store.insertLearning({
        user_id: userId,
        kind: d.kind,
        topic: d.topic,
        payload: d.payload,
        evidence: d.evidence as LearningRow["evidence"],
        confidence: d.confidence,
        source: d.source,
        status: d.status,
        experiment_id: null,
      }),
    );
  }
  return { inserted, skipped: [] };
}

/* ------------------------------------------------------------------ */
/* In-memory store (tests)                                             */
/* ------------------------------------------------------------------ */

export function createMemoryLearningStore(seed?: {
  learnings?: LearningRow[];
  insights?: EngagementInsightRow[];
}): LearningStore & {
  learnings: Map<string, LearningRow>;
  insights: EngagementInsightRow[];
} {
  const learnings = new Map<string, LearningRow>();
  for (const l of seed?.learnings ?? []) learnings.set(l.id, { ...l });
  const insights = [...(seed?.insights ?? [])];
  let seq = 1000;

  const store: LearningStore = {
    async getLearning(id) {
      const l = learnings.get(id);
      return l ? { ...l } : null;
    },
    async listLearnings(filter) {
      let rows = [...learnings.values()].filter((l) => l.user_id === filter.userId);
      if (filter.kinds) rows = rows.filter((l) => filter.kinds!.includes(l.kind));
      if (filter.statuses) rows = rows.filter((l) => filter.statuses!.includes(l.status));
      if (filter.since) rows = rows.filter((l) => l.created_at >= filter.since!);
      rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return rows.slice(0, filter.limit ?? 100).map((l) => ({ ...l }));
    },
    async listEngagementInsights(userId) {
      return insights.filter((i) => i.user_id === userId).map((i) => ({ ...i }));
    },
    async insertLearning(row) {
      const id = `learn-${seq++}`;
      const full: LearningRow = {
        ...row,
        id,
        created_at: new Date().toISOString(),
      };
      learnings.set(id, full);
      return { ...full };
    },
    async patchLearning(id, patch) {
      const l = learnings.get(id);
      if (!l) throw new LearningValidationError(`Learning not found: ${id}.`);
      const next = { ...l, ...patch };
      learnings.set(id, next);
      return { ...next };
    },
  };
  return Object.assign(store, { learnings, insights });
}
