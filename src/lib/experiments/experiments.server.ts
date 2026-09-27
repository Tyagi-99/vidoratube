/**
 * F34 — Experiment domain logic (pure; no DB, no framework).
 *
 * All lifecycle rules from the pinned contracts live here and are unit
 * tested with an in-memory store:
 *   - conclusion requires min sample on EVERY arm AND min duration AND
 *     p < 0.05 — for humans and auto-conclude alike (D147);
 *   - auto-conclude NEVER applies the winner (D147);
 *   - "Apply winner" is a separate human-only action (D148).
 *
 * The `.functions.ts` layer adapts a real Supabase client to
 * `ExperimentStore`; tests use `createMemoryExperimentStore`.
 */

import { isSignificant, twoProportionZTest, welchTTest, SIGNIFICANCE_LEVEL } from "./stats";
import type { Json } from "@/integrations/supabase/types";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export const PRIMARY_METRICS = [
  "ctr",
  "views",
  "avg_view_duration_s",
  "watch_time_minutes",
] as const;
export type PrimaryMetric = (typeof PRIMARY_METRICS)[number];

export const EXPERIMENT_STATUSES = ["draft", "running", "completed", "archived"] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

/** Documented jsonb shape of experiment_arms.metrics (D146). */
export interface ArmMetrics {
  /** CTR shape */
  impressions?: number;
  clicks?: number;
  /** Continuous shape (variance preferred; std accepted as fallback) */
  n?: number;
  mean?: number;
  variance?: number;
  std?: number;
}

export interface ExperimentRow {
  id: string;
  user_id: string;
  project_id: string | null;
  name: string;
  hypothesis: string;
  status: ExperimentStatus;
  primary_metric: PrimaryMetric;
  min_sample_size: number;
  min_duration_hours: number;
  started_at: string | null;
  ended_at: string | null;
  conclusion: Record<string, Json>;
  created_at: string;
  updated_at: string;
}

export interface ArmRow {
  id: string;
  experiment_id: string;
  name: string;
  arm_type: "control" | "variant";
  title_variant_id: string | null;
  thumbnail_id: string | null;
  traffic_split: number;
  metrics: ArmMetrics;
  created_at: string;
}

/** Pinned conclusion shape + auditable extras. */
export type ConclusionShape = {
  winner_arm_id: string | null;
  p_value: number | null;
  method: string;
  decided_at: string;
  decided_by: "human" | "auto";
  verdict: "winner" | "inconclusive";
  alpha: number;
  per_arm: PerArmConclusion[];
  gates: {
    min_sample_size: number;
    min_duration_hours: number;
    elapsed_hours: number;
  };
};

export type PerArmConclusion = {
  arm_id: string;
  arm_name: string;
  arm_type: "control" | "variant";
  sample_size: number;
  metric_value: number | null;
  p_value_vs_control: number | null;
  method: string;
  significant_improvement: boolean;
};

export interface SampleGateDetail {
  arm_id: string;
  arm_name: string;
  sample_size: number;
  required: number;
  ok: boolean;
}

export interface ConclusionEvaluation {
  can_conclude: boolean;
  sample_gate: { ok: boolean; detail: SampleGateDetail[] };
  duration_gate: {
    ok: boolean;
    elapsed_hours: number;
    required_hours: number;
  };
  arm_results: PerArmConclusion[];
  /** Null when gates fail — there is no conclusion to write yet. */
  conclusion: ConclusionShape | null;
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export class ExperimentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExperimentValidationError";
  }
}

export class ExperimentNotReadyError extends Error {
  readonly evaluation: ConclusionEvaluation;
  constructor(evaluation: ConclusionEvaluation) {
    super("Experiment is not ready for a conclusion: " + describeGates(evaluation));
    this.name = "ExperimentNotReadyError";
    this.evaluation = evaluation;
  }
}

function describeGates(e: ConclusionEvaluation): string {
  const parts: string[] = [];
  if (!e.sample_gate.ok) {
    const lacking = e.sample_gate.detail
      .filter((d) => !d.ok)
      .map((d) => `${d.arm_name} (${d.sample_size}/${d.required})`)
      .join(", ");
    parts.push(`min sample not reached: ${lacking}`);
  }
  if (!e.duration_gate.ok) {
    parts.push(
      `min duration not reached: ${e.duration_gate.elapsed_hours.toFixed(1)}h / ${e.duration_gate.required_hours}h`,
    );
  }
  return parts.join("; ");
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export interface CreateExperimentInput {
  name: string;
  hypothesis?: string | undefined;
  project_id?: string | null | undefined;
  primary_metric?: PrimaryMetric | undefined;
  min_sample_size?: number | undefined;
  min_duration_hours?: number | undefined;
}

export function validateCreateExperiment(
  input: CreateExperimentInput,
): Required<
  Pick<
    CreateExperimentInput,
    "name" | "project_id" | "primary_metric" | "min_sample_size" | "min_duration_hours"
  >
> & { hypothesis: string } {
  const name = (input.name ?? "").trim();
  if (name.length < 1 || name.length > 120) {
    throw new ExperimentValidationError("Experiment name must be 1–120 characters.");
  }
  const primary_metric = input.primary_metric ?? "ctr";
  if (!(PRIMARY_METRICS as readonly string[]).includes(primary_metric)) {
    throw new ExperimentValidationError(
      `primary_metric must be one of: ${PRIMARY_METRICS.join(" | ")}.`,
    );
  }
  const min_sample_size = input.min_sample_size ?? 100;
  if (!Number.isInteger(min_sample_size) || min_sample_size < 100) {
    throw new ExperimentValidationError(
      "min_sample_size must be an integer ≥ 100 (pinned floor; lowering needs a D-decision).",
    );
  }
  const min_duration_hours = input.min_duration_hours ?? 24;
  if (!Number.isFinite(min_duration_hours) || min_duration_hours < 1) {
    throw new ExperimentValidationError("min_duration_hours must be ≥ 1 (default 24).");
  }
  return {
    name,
    hypothesis: (input.hypothesis ?? "").trim(),
    project_id: input.project_id ?? null,
    primary_metric,
    min_sample_size,
    min_duration_hours,
  };
}

export interface ArmInput {
  name: string;
  arm_type: "control" | "variant";
  title_variant_id?: string | null | undefined;
  thumbnail_id?: string | null | undefined;
  traffic_split: number;
}

/** An A/B test needs exactly 1 control + ≥1 variant, splits summing to 1. */
export function validateArms(arms: ArmInput[]): void {
  if (arms.length < 2) {
    throw new ExperimentValidationError(
      "An experiment needs at least 2 arms (1 control + 1 variant).",
    );
  }
  const controls = arms.filter((a) => a.arm_type === "control");
  if (controls.length !== 1) {
    throw new ExperimentValidationError(
      `An experiment needs exactly 1 control arm (found ${controls.length}).`,
    );
  }
  for (const arm of arms) {
    if (!Number.isFinite(arm.traffic_split) || arm.traffic_split < 0 || arm.traffic_split > 1) {
      throw new ExperimentValidationError(
        `Arm "${arm.name}": traffic_split must be within [0, 1].`,
      );
    }
    if (!arm.title_variant_id && !arm.thumbnail_id) {
      throw new ExperimentValidationError(
        `Arm "${arm.name}": link a title variant and/or a thumbnail — an arm with no packaging content cannot run.`,
      );
    }
  }
  const total = arms.reduce((s, a) => s + a.traffic_split, 0);
  if (Math.abs(total - 1) > 0.001) {
    throw new ExperimentValidationError(`Traffic splits must sum to 1 (got ${total.toFixed(4)}).`);
  }
}

/* ------------------------------------------------------------------ */
/* Metric extraction                                                   */
/* ------------------------------------------------------------------ */

/** Sample size counting toward the min-sample gate (D146). */
export function armSampleSize(arm: ArmRow, primaryMetric: PrimaryMetric): number {
  const m = arm.metrics ?? {};
  if (primaryMetric === "ctr") {
    return Math.max(0, Math.floor(m.impressions ?? 0));
  }
  const n = m.n ?? m.impressions ?? 0;
  return Math.max(0, Math.floor(n));
}

/** Point estimate of the primary metric for display/comparison. */
export function armMetricValue(arm: ArmRow, primaryMetric: PrimaryMetric): number | null {
  const m = arm.metrics ?? {};
  if (primaryMetric === "ctr") {
    const imp = m.impressions ?? 0;
    if (imp <= 0) return null;
    return (m.clicks ?? 0) / imp;
  }
  return typeof m.mean === "number" && Number.isFinite(m.mean) ? m.mean : null;
}

function continuousParams(arm: ArmRow): { n: number; mean: number; variance: number } | null {
  const m = arm.metrics ?? {};
  const n = Math.floor(m.n ?? m.impressions ?? 0);
  const mean = m.mean;
  let variance = m.variance;
  if ((variance === undefined || variance === null) && typeof m.std === "number") {
    variance = m.std * m.std;
  }
  if (
    !Number.isInteger(n) ||
    n < 0 ||
    typeof mean !== "number" ||
    !Number.isFinite(mean) ||
    typeof variance !== "number" ||
    !Number.isFinite(variance) ||
    variance < 0
  ) {
    return null;
  }
  return { n, mean, variance };
}

/* ------------------------------------------------------------------ */
/* Conclusion evaluation                                               */
/* ------------------------------------------------------------------ */

export function testMethodFor(primaryMetric: PrimaryMetric): string {
  return primaryMetric === "ctr" ? "two-proportion-z" : "welch-t";
}

/**
 * Compare one variant arm against the control for the primary metric.
 * Higher metric values are "better" for all four primary metrics.
 */
function compareVsControl(
  control: ArmRow,
  variant: ArmRow,
  primaryMetric: PrimaryMetric,
): Omit<PerArmConclusion, "arm_id" | "arm_name" | "arm_type" | "sample_size" | "metric_value"> {
  const method = testMethodFor(primaryMetric);
  const controlValue = armMetricValue(control, primaryMetric);
  const variantValue = armMetricValue(variant, primaryMetric);

  let pValue: number | null = null;
  if (primaryMetric === "ctr") {
    const mc = control.metrics ?? {};
    const mv = variant.metrics ?? {};
    const r = twoProportionZTest(
      Math.floor(mc.clicks ?? 0),
      Math.floor(mc.impressions ?? 0),
      Math.floor(mv.clicks ?? 0),
      Math.floor(mv.impressions ?? 0),
    );
    pValue = r.pValue;
  } else {
    const pc = continuousParams(control);
    const pv = continuousParams(variant);
    if (pc && pv) {
      const r = welchTTest(pc.mean, pc.variance, pc.n, pv.mean, pv.variance, pv.n);
      pValue = r.pValue;
    }
  }

  const significantImprovement =
    pValue !== null &&
    controlValue !== null &&
    variantValue !== null &&
    isSignificant(pValue) &&
    variantValue > controlValue;

  return { p_value_vs_control: pValue, method, significant_improvement: significantImprovement };
}

/**
 * Evaluate whether an experiment may conclude, and if so with what result.
 * Pure: same rules for human and auto conclude (D147).
 */
export function evaluateConclusion(
  experiment: Pick<
    ExperimentRow,
    "primary_metric" | "min_sample_size" | "min_duration_hours" | "started_at"
  >,
  arms: ArmRow[],
  now: Date,
  decidedBy: "human" | "auto",
): ConclusionEvaluation {
  const required = experiment.min_sample_size;
  const detail: SampleGateDetail[] = arms.map((arm) => {
    const sample_size = armSampleSize(arm, experiment.primary_metric);
    return {
      arm_id: arm.id,
      arm_name: arm.name,
      sample_size,
      required,
      ok: sample_size >= required,
    };
  });
  const sampleGateOk = detail.length > 0 && detail.every((d) => d.ok);

  const startedAt = experiment.started_at ? new Date(experiment.started_at) : null;
  const elapsedHours =
    startedAt && !Number.isNaN(startedAt.getTime())
      ? (now.getTime() - startedAt.getTime()) / 3_600_000
      : 0;
  const durationGateOk = startedAt !== null && elapsedHours >= experiment.min_duration_hours;

  const control = arms.find((a) => a.arm_type === "control") ?? null;

  const arm_results: PerArmConclusion[] = arms.map((arm) => {
    const base = {
      arm_id: arm.id,
      arm_name: arm.name,
      arm_type: arm.arm_type,
      sample_size: armSampleSize(arm, experiment.primary_metric),
      metric_value: armMetricValue(arm, experiment.primary_metric),
    };
    if (arm.arm_type === "control" || !control) {
      return {
        ...base,
        p_value_vs_control: null,
        method: testMethodFor(experiment.primary_metric),
        significant_improvement: false,
      };
    }
    return { ...base, ...compareVsControl(control, arm, experiment.primary_metric) };
  });

  const can_conclude = sampleGateOk && durationGateOk;

  let conclusion: ConclusionShape | null = null;
  if (can_conclude) {
    const winners = arm_results.filter((r) => r.significant_improvement);
    winners.sort((a, b) => (a.p_value_vs_control ?? 1) - (b.p_value_vs_control ?? 1));
    const winner = winners[0] ?? null;
    const bestP =
      arm_results
        .map((r) => r.p_value_vs_control)
        .filter((p): p is number => p !== null)
        .sort((a, b) => a - b)[0] ?? null;
    conclusion = {
      winner_arm_id: winner ? winner.arm_id : null,
      p_value: winner ? winner.p_value_vs_control : bestP,
      method: testMethodFor(experiment.primary_metric),
      decided_at: now.toISOString(),
      decided_by: decidedBy,
      verdict: winner ? "winner" : "inconclusive",
      alpha: SIGNIFICANCE_LEVEL,
      per_arm: arm_results,
      gates: {
        min_sample_size: required,
        min_duration_hours: experiment.min_duration_hours,
        elapsed_hours: Math.round(elapsedHours * 10) / 10,
      },
    };
  }

  return {
    can_conclude,
    sample_gate: { ok: sampleGateOk, detail },
    duration_gate: {
      ok: durationGateOk,
      elapsed_hours: Math.round(elapsedHours * 10) / 10,
      required_hours: experiment.min_duration_hours,
    },
    arm_results,
    conclusion,
  };
}

/* ------------------------------------------------------------------ */
/* Learning draft (auto-drafted on conclude, always `proposed`)        */
/* ------------------------------------------------------------------ */

export interface ExperimentLearningDraft {
  kind: "experiment_outcome";
  topic: string;
  statement: string;
  payload: Record<string, Json>;
  evidence: {
    type: "experiment_outcome";
    refs: string[];
    metrics: Record<string, Json>;
    sample: number;
  };
  confidence: number;
  source: "system";
  status: "proposed";
  experiment_id: string;
}

function formatPct(x: number | null): string {
  return x === null ? "n/a" : `${(x * 100).toFixed(1)}%`;
}

function formatInt(n: number): string {
  return n.toLocaleString("en-US");
}

/** What packaging dimension did this experiment test? */
export function experimentTopic(arms: ArmRow[]): string {
  const hasTitle = arms.some((a) => a.title_variant_id);
  const hasThumb = arms.some((a) => a.thumbnail_id);
  if (hasTitle && hasThumb) return "packaging";
  if (hasTitle) return "title";
  if (hasThumb) return "thumbnail";
  return "general";
}

export function buildExperimentLearningDraft(
  experiment: Pick<ExperimentRow, "id" | "name" | "primary_metric">,
  arms: ArmRow[],
  conclusion: ConclusionShape,
): ExperimentLearningDraft {
  const topic = experimentTopic(arms);
  const totalSample = arms.reduce((s, a) => s + armSampleSize(a, experiment.primary_metric), 0);
  const byId = new Map(arms.map((a) => [a.id, a]));
  const metricLabel = experiment.primary_metric === "ctr" ? "CTR" : experiment.primary_metric;

  let statement: string;
  let confidence: number;
  if (conclusion.verdict === "winner" && conclusion.winner_arm_id) {
    const winner = byId.get(conclusion.winner_arm_id);
    const control = arms.find((a) => a.arm_type === "control");
    const wv = winner ? armMetricValue(winner, experiment.primary_metric) : null;
    const cv = control ? armMetricValue(control, experiment.primary_metric) : null;
    const valueText =
      experiment.primary_metric === "ctr"
        ? `${formatPct(wv)} vs ${formatPct(cv)}`
        : `${wv ?? "n/a"} vs ${cv ?? "n/a"}`;
    statement =
      `Variant "${winner?.name ?? "?"}" beat control ` +
      `"${control?.name ?? "?"}" on ${metricLabel} ` +
      `(${valueText}, p=${conclusion.p_value?.toFixed(4) ?? "n/a"}, ` +
      `n=${formatInt(totalSample)}).`;
    confidence = Math.round((1 - (conclusion.p_value ?? 0.05)) * 1000) / 1000;
  } else {
    statement =
      `No significant difference on ${metricLabel} ` +
      `(best p=${conclusion.p_value?.toFixed(4) ?? "n/a"}, ` +
      `n=${formatInt(totalSample)}).`;
    confidence = 0.5;
  }

  return {
    kind: "experiment_outcome",
    topic,
    statement,
    payload: {
      experiment_name: experiment.name,
      verdict: conclusion.verdict,
      primary_metric: experiment.primary_metric,
    },
    evidence: {
      type: "experiment_outcome",
      refs: [experiment.id],
      metrics: {
        primary_metric: experiment.primary_metric,
        p_value: conclusion.p_value,
        method: conclusion.method,
        per_arm: conclusion.per_arm.map((r) => ({
          arm_id: r.arm_id,
          arm_name: r.arm_name,
          arm_type: r.arm_type,
          sample_size: r.sample_size,
          metric_value: r.metric_value,
          p_value_vs_control: r.p_value_vs_control,
          significant_improvement: r.significant_improvement,
        })),
      },
      sample: totalSample,
    },
    confidence,
    source: "system",
    status: "proposed",
    experiment_id: experiment.id,
  };
}

/* ------------------------------------------------------------------ */
/* Apply-winner plan (human-only; the functions layer executes it)     */
/* ------------------------------------------------------------------ */

export interface ApplyWinnerPlan {
  experiment_id: string;
  winner_arm_id: string;
  title_variant_id: string | null;
  thumbnail_id: string | null;
  project_id: string | null;
}

/**
 * Pure plan for "Apply winner". Throws unless the experiment is completed
 * with a winner verdict — the functions layer re-checks this against the
 * live row before executing (never trust a stale client).
 */
export function buildApplyWinnerPlan(
  experiment: Pick<ExperimentRow, "id" | "status" | "project_id" | "conclusion">,
  arms: ArmRow[],
): ApplyWinnerPlan {
  if (experiment.status !== "completed") {
    throw new ExperimentValidationError("A winner can only be applied to a completed experiment.");
  }
  const conclusion = experiment.conclusion as unknown as Partial<ConclusionShape>;
  if (conclusion?.verdict !== "winner" || !conclusion.winner_arm_id) {
    throw new ExperimentValidationError(
      "This experiment has no winning arm to apply (verdict is not 'winner').",
    );
  }
  const winner = arms.find((a) => a.id === conclusion.winner_arm_id);
  if (!winner) {
    throw new ExperimentValidationError("Winning arm not found on this experiment.");
  }
  return {
    experiment_id: experiment.id,
    winner_arm_id: winner.id,
    title_variant_id: winner.title_variant_id,
    thumbnail_id: winner.thumbnail_id,
    project_id: experiment.project_id,
  };
}

/* ------------------------------------------------------------------ */
/* Store interface + lifecycle (tested with an in-memory store)        */
/* ------------------------------------------------------------------ */

export interface ExperimentStore {
  getExperiment(experimentId: string): Promise<ExperimentRow | null>;
  listArms(experimentId: string): Promise<ArmRow[]>;
  patchExperiment(
    experimentId: string,
    patch: Partial<
      Pick<ExperimentRow, "status" | "started_at" | "ended_at" | "conclusion" | "updated_at">
    >,
  ): Promise<ExperimentRow>;
  mergeArmMetrics(armId: string, metrics: ArmMetrics): Promise<ArmRow>;
}

export interface ConcludeOutcome {
  experiment: ExperimentRow;
  conclusion: ConclusionShape;
  learningDraft: ExperimentLearningDraft;
}

function requireOwned(experiment: ExperimentRow | null, experimentId: string): ExperimentRow {
  if (!experiment) {
    throw new ExperimentValidationError(`Experiment not found: ${experimentId}.`);
  }
  return experiment;
}

export async function startExperimentLifecycle(
  store: ExperimentStore,
  experimentId: string,
  now: Date,
): Promise<ExperimentRow> {
  const experiment = requireOwned(await store.getExperiment(experimentId), experimentId);
  if (experiment.status !== "draft") {
    throw new ExperimentValidationError(
      `Only draft experiments can be started (status: ${experiment.status}).`,
    );
  }
  const arms = await store.listArms(experimentId);
  validateArms(
    arms.map((a) => ({
      name: a.name,
      arm_type: a.arm_type,
      title_variant_id: a.title_variant_id,
      thumbnail_id: a.thumbnail_id,
      traffic_split: Number(a.traffic_split),
    })),
  );
  return store.patchExperiment(experimentId, {
    status: "running",
    // First start sets the clock; restarts after a pause keep the original
    // started_at (D147: the 24h gate is wall-clock from first start).
    started_at: experiment.started_at ?? now.toISOString(),
    updated_at: now.toISOString(),
  });
}

/** Pause = back to draft (D147); the duration clock keeps running. */
export async function pauseExperimentLifecycle(
  store: ExperimentStore,
  experimentId: string,
  now: Date,
): Promise<ExperimentRow> {
  const experiment = requireOwned(await store.getExperiment(experimentId), experimentId);
  if (experiment.status !== "running") {
    throw new ExperimentValidationError(
      `Only running experiments can be paused (status: ${experiment.status}).`,
    );
  }
  return store.patchExperiment(experimentId, {
    status: "draft",
    updated_at: now.toISOString(),
  });
}

export async function archiveExperimentLifecycle(
  store: ExperimentStore,
  experimentId: string,
  now: Date,
): Promise<ExperimentRow> {
  const experiment = requireOwned(await store.getExperiment(experimentId), experimentId);
  if (experiment.status === "archived") return experiment;
  return store.patchExperiment(experimentId, {
    status: "archived",
    updated_at: now.toISOString(),
  });
}

export interface RecordMetricsOutcome {
  arm: ArmRow;
  /** Present when this record triggered an auto-conclusion. */
  concluded: ConcludeOutcome | null;
  /** Live evaluation (gates + per-arm p-values) for the UI progress view. */
  evaluation: ConclusionEvaluation;
}

/**
 * Record metrics for one arm, then evaluate auto-conclude (D153).
 * Auto-conclude only fires from `running`; it never applies the winner.
 */
export async function recordMetricsLifecycle(
  store: ExperimentStore,
  experimentId: string,
  armId: string,
  metrics: ArmMetrics,
  now: Date,
): Promise<RecordMetricsOutcome> {
  const experiment = requireOwned(await store.getExperiment(experimentId), experimentId);
  const arm = await store.mergeArmMetrics(armId, metrics);
  const arms = await store.listArms(experimentId);
  const evaluation = evaluateConclusion(experiment, arms, now, "auto");

  let concluded: ConcludeOutcome | null = null;
  if (experiment.status === "running" && evaluation.can_conclude && evaluation.conclusion) {
    const updated = await store.patchExperiment(experimentId, {
      status: "completed",
      ended_at: now.toISOString(),
      conclusion: evaluation.conclusion,
      updated_at: now.toISOString(),
    });
    concluded = {
      experiment: updated,
      conclusion: evaluation.conclusion,
      learningDraft: buildExperimentLearningDraft(experiment, arms, evaluation.conclusion),
    };
  }
  return { arm, concluded, evaluation };
}

/**
 * Human conclude — same gates as auto (D147). Throws ExperimentNotReadyError
 * when gates fail so the UI can render "not yet significant" states.
 */
export async function concludeExperimentLifecycle(
  store: ExperimentStore,
  experimentId: string,
  now: Date,
  decidedBy: "human" | "auto",
): Promise<ConcludeOutcome> {
  const experiment = requireOwned(await store.getExperiment(experimentId), experimentId);
  if (experiment.status === "completed") {
    throw new ExperimentValidationError("Experiment is already completed.");
  }
  if (experiment.status === "archived") {
    throw new ExperimentValidationError("Archived experiments cannot conclude.");
  }
  const arms = await store.listArms(experimentId);
  const evaluation = evaluateConclusion(experiment, arms, now, decidedBy);
  if (!evaluation.can_conclude || !evaluation.conclusion) {
    throw new ExperimentNotReadyError(evaluation);
  }
  const updated = await store.patchExperiment(experimentId, {
    status: "completed",
    ended_at: now.toISOString(),
    conclusion: evaluation.conclusion,
    updated_at: now.toISOString(),
  });
  return {
    experiment: updated,
    conclusion: evaluation.conclusion,
    learningDraft: buildExperimentLearningDraft(experiment, arms, evaluation.conclusion),
  };
}

/* ------------------------------------------------------------------ */
/* In-memory store (tests)                                             */
/* ------------------------------------------------------------------ */

export function createMemoryExperimentStore(seed?: {
  experiments?: ExperimentRow[];
  arms?: ArmRow[];
}): ExperimentStore & {
  experiments: Map<string, ExperimentRow>;
  arms: Map<string, ArmRow>;
} {
  const experiments = new Map<string, ExperimentRow>();
  const arms = new Map<string, ArmRow>();
  for (const e of seed?.experiments ?? []) experiments.set(e.id, { ...e });
  for (const a of seed?.arms ?? []) arms.set(a.id, { ...a, metrics: { ...a.metrics } });

  const store: ExperimentStore = {
    async getExperiment(id) {
      const e = experiments.get(id);
      return e ? { ...e } : null;
    },
    async listArms(experimentId) {
      return [...arms.values()]
        .filter((a) => a.experiment_id === experimentId)
        .map((a) => ({ ...a, metrics: { ...a.metrics } }));
    },
    async patchExperiment(id, patch) {
      const e = experiments.get(id);
      if (!e) throw new ExperimentValidationError(`Experiment not found: ${id}.`);
      const next = { ...e, ...patch };
      experiments.set(id, next);
      return { ...next };
    },
    async mergeArmMetrics(armId, metrics) {
      const a = arms.get(armId);
      if (!a) throw new ExperimentValidationError(`Arm not found: ${armId}.`);
      const next = { ...a, metrics: { ...a.metrics, ...metrics } };
      arms.set(armId, next);
      return { ...next, metrics: { ...next.metrics } };
    },
  };
  return Object.assign(store, { experiments, arms });
}
