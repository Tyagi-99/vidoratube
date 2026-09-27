/**
 * F34 experiment lifecycle tests (pure logic, in-memory store).
 *
 * Covers the pinned stats discipline end to end: gating (min sample AND
 * 24h), winner selection, the p=0.0587 near-miss honesty case, auto-conclude
 * never applying the winner, and the apply-winner plan gate.
 */
import { describe, expect, it } from "vitest";
import {
  buildApplyWinnerPlan,
  buildExperimentLearningDraft,
  concludeExperimentLifecycle,
  createMemoryExperimentStore,
  evaluateConclusion,
  experimentTopic,
  pauseExperimentLifecycle,
  recordMetricsLifecycle,
  startExperimentLifecycle,
  validateArms,
  validateCreateExperiment,
  ExperimentNotReadyError,
  ExperimentValidationError,
  type ArmRow,
  type ExperimentRow,
} from "./experiments.server";

const NOW = new Date("2026-09-28T12:00:00Z");
const DAY_AGO = new Date("2026-09-27T10:00:00Z"); // 26h before NOW
const HOUR_AGO = new Date("2026-09-28T11:00:00Z");

function exp(over: Partial<ExperimentRow> = {}): ExperimentRow {
  return {
    id: "exp-1",
    user_id: "user-1",
    project_id: "proj-1",
    name: "Title test",
    hypothesis: "Curiosity gap wins",
    status: "running",
    primary_metric: "ctr",
    min_sample_size: 100,
    min_duration_hours: 24,
    started_at: DAY_AGO.toISOString(),
    ended_at: null,
    conclusion: {},
    created_at: DAY_AGO.toISOString(),
    updated_at: DAY_AGO.toISOString(),
    ...over,
  };
}

function arm(over: Partial<ArmRow> = {}): ArmRow {
  return {
    id: "arm-ctrl",
    experiment_id: "exp-1",
    name: "Control",
    arm_type: "control",
    title_variant_id: "tv-1",
    thumbnail_id: null,
    traffic_split: 0.5,
    metrics: {},
    created_at: DAY_AGO.toISOString(),
    ...over,
  };
}

const twoArms = (): ArmRow[] => [
  arm(),
  arm({
    id: "arm-var",
    name: "Variant",
    arm_type: "variant",
    title_variant_id: "tv-2",
  }),
];

describe("validateCreateExperiment", () => {
  it("applies pinned defaults", () => {
    const v = validateCreateExperiment({ name: "  My test  " });
    expect(v.name).toBe("My test");
    expect(v.primary_metric).toBe("ctr");
    expect(v.min_sample_size).toBe(100);
    expect(v.min_duration_hours).toBe(24);
  });

  it("rejects bad input", () => {
    expect(() => validateCreateExperiment({ name: "" })).toThrow(ExperimentValidationError);
    expect(() => validateCreateExperiment({ name: "x".repeat(121) })).toThrow(
      ExperimentValidationError,
    );
    expect(() =>
      validateCreateExperiment({ name: "ok", primary_metric: "likes" as never }),
    ).toThrow(ExperimentValidationError);
    // Pinned floor: min_sample_size can never go below 100 without a D-decision.
    expect(() => validateCreateExperiment({ name: "ok", min_sample_size: 50 })).toThrow(
      ExperimentValidationError,
    );
    expect(() => validateCreateExperiment({ name: "ok", min_duration_hours: 0 })).toThrow(
      ExperimentValidationError,
    );
  });
});

describe("validateArms", () => {
  it("requires 2+ arms with exactly one control", () => {
    expect(() => validateArms([])).toThrow(ExperimentValidationError);
    expect(() =>
      validateArms([{ name: "A", arm_type: "variant", title_variant_id: "t", traffic_split: 1 }]),
    ).toThrow(ExperimentValidationError);
    expect(() =>
      validateArms([
        { name: "A", arm_type: "control", title_variant_id: "t", traffic_split: 0.5 },
        { name: "B", arm_type: "control", title_variant_id: "t", traffic_split: 0.5 },
      ]),
    ).toThrow(/exactly 1 control/);
  });

  it("requires splits to sum to 1 and every arm to link content", () => {
    expect(() =>
      validateArms([
        { name: "A", arm_type: "control", title_variant_id: "t", traffic_split: 0.5 },
        { name: "B", arm_type: "variant", title_variant_id: "t", traffic_split: 0.4 },
      ]),
    ).toThrow(/sum to 1/);
    expect(() =>
      validateArms([
        { name: "A", arm_type: "control", title_variant_id: "t", traffic_split: 0.5 },
        { name: "B", arm_type: "variant", traffic_split: 0.5 },
      ]),
    ).toThrow(/no packaging content/);
  });

  it("accepts a valid A/B", () => {
    expect(() =>
      validateArms([
        { name: "A", arm_type: "control", title_variant_id: "t1", traffic_split: 0.5 },
        { name: "B", arm_type: "variant", thumbnail_id: "th1", traffic_split: 0.5 },
      ]),
    ).not.toThrow();
  });
});

describe("evaluateConclusion gating", () => {
  it("refuses to conclude before min sample on every arm", () => {
    const arms = twoArms();
    arms[0]!.metrics = { impressions: 2000, clicks: 100 };
    arms[1]!.metrics = { impressions: 50, clicks: 10 }; // below 100
    const e = evaluateConclusion(exp(), arms, NOW, "auto");
    expect(e.can_conclude).toBe(false);
    expect(e.sample_gate.ok).toBe(false);
    expect(e.conclusion).toBeNull();
    expect(e.sample_gate.detail.find((d) => d.arm_id === "arm-var")?.ok).toBe(false);
  });

  it("refuses to conclude before 24h even with huge samples", () => {
    const arms = twoArms();
    arms[0]!.metrics = { impressions: 50000, clicks: 2500 };
    arms[1]!.metrics = { impressions: 50000, clicks: 4000 };
    const e = evaluateConclusion(exp({ started_at: HOUR_AGO.toISOString() }), arms, NOW, "human");
    expect(e.can_conclude).toBe(false);
    expect(e.duration_gate.ok).toBe(false);
    expect(e.duration_gate.elapsed_hours).toBeCloseTo(1, 5);
    expect(e.conclusion).toBeNull();
  });

  it("names the winner when gates pass and p < 0.05 (100/2000 vs 140/2000)", () => {
    const arms = twoArms();
    arms[0]!.metrics = { impressions: 2000, clicks: 100 };
    arms[1]!.metrics = { impressions: 2000, clicks: 140 };
    const e = evaluateConclusion(exp(), arms, NOW, "auto");
    expect(e.can_conclude).toBe(true);
    expect(e.conclusion?.verdict).toBe("winner");
    expect(e.conclusion?.winner_arm_id).toBe("arm-var");
    expect(e.conclusion?.p_value).toBeCloseTo(0.00774202, 6);
    expect(e.conclusion?.method).toBe("two-proportion-z");
    expect(e.conclusion?.decided_by).toBe("auto");
    expect(e.conclusion?.decided_at).toBe(NOW.toISOString());
  });

  it("is inconclusive on the p=0.0587 near-miss (120/2000 vs 150/2000)", () => {
    // Honesty: p > 0.05 with full samples is "inconclusive", never a winner.
    const arms = twoArms();
    arms[0]!.metrics = { impressions: 2000, clicks: 120 };
    arms[1]!.metrics = { impressions: 2000, clicks: 150 };
    const e = evaluateConclusion(exp(), arms, NOW, "human");
    expect(e.can_conclude).toBe(true);
    expect(e.conclusion?.verdict).toBe("inconclusive");
    expect(e.conclusion?.winner_arm_id).toBeNull();
    expect(e.conclusion?.p_value).toBeCloseTo(0.05866886, 6);
  });

  it("is inconclusive when the variant underperforms (wrong direction)", () => {
    const arms = twoArms();
    arms[0]!.metrics = { impressions: 2000, clicks: 140 };
    arms[1]!.metrics = { impressions: 2000, clicks: 100 };
    const e = evaluateConclusion(exp(), arms, NOW, "auto");
    expect(e.conclusion?.verdict).toBe("inconclusive");
    expect(e.conclusion?.winner_arm_id).toBeNull();
  });

  it("picks the best of several variants by smallest p", () => {
    const arms = [
      ...twoArms(),
      arm({
        id: "arm-var2",
        name: "Variant 2",
        arm_type: "variant",
        title_variant_id: "tv-3",
        traffic_split: 0.25,
      }),
    ];
    arms[0]!.metrics = { impressions: 2000, clicks: 100 };
    arms[0]!.traffic_split = 0.5;
    arms[1]!.metrics = { impressions: 2000, clicks: 140 }; // p=0.0077
    arms[1]!.traffic_split = 0.25;
    arms[2]!.metrics = { impressions: 2000, clicks: 170 }; // p≈1.6e-5, stronger
    const e = evaluateConclusion(exp(), arms, NOW, "auto");
    expect(e.conclusion?.winner_arm_id).toBe("arm-var2");
  });

  it("supports continuous metrics via Welch's t-test", () => {
    const e1 = exp({ primary_metric: "watch_time_minutes" });
    const arms = twoArms();
    arms[0]!.metrics = { n: 120, mean: 42.5, variance: 180 };
    arms[1]!.metrics = { n: 118, mean: 48.2, variance: 195 };
    const e = evaluateConclusion(e1, arms, NOW, "auto");
    expect(e.can_conclude).toBe(true);
    expect(e.conclusion?.verdict).toBe("winner");
    expect(e.conclusion?.method).toBe("welch-t");
    expect(e.conclusion?.p_value).toBeCloseTo(0.00151091, 6);
  });

  it("accepts std instead of variance for continuous metrics", () => {
    const e1 = exp({ primary_metric: "avg_view_duration_s" });
    const arms = twoArms();
    arms[0]!.metrics = { n: 150, mean: 30.0, std: 10 };
    arms[1]!.metrics = { n: 150, mean: 30.5, std: Math.sqrt(102) };
    const e = evaluateConclusion(e1, arms, NOW, "auto");
    expect(e.conclusion?.verdict).toBe("inconclusive");
    expect(e.conclusion?.p_value).toBeCloseTo(0.66687896, 4);
  });
});

describe("lifecycle: start / pause / record / auto-conclude", () => {
  function seedStore() {
    return createMemoryExperimentStore({
      experiments: [exp({ status: "draft", started_at: null })],
      arms: twoArms(),
    });
  }

  it("start validates arms and sets the clock once", async () => {
    const store = seedStore();
    const started = await startExperimentLifecycle(store, "exp-1", NOW);
    expect(started.status).toBe("running");
    expect(started.started_at).toBe(NOW.toISOString());
    // Pausing then restarting keeps the original started_at (D138).
    await pauseExperimentLifecycle(store, "exp-1", NOW);
    const restarted = await startExperimentLifecycle(
      store,
      "exp-1",
      new Date("2026-09-29T12:00:00Z"),
    );
    expect(restarted.started_at).toBe(NOW.toISOString());
  });

  it("start refuses invalid arm setups", async () => {
    const store = createMemoryExperimentStore({
      experiments: [exp({ status: "draft", started_at: null })],
      arms: [arm()], // only one arm
    });
    await expect(startExperimentLifecycle(store, "exp-1", NOW)).rejects.toThrow(
      ExperimentValidationError,
    );
  });

  it("record triggers auto-conclude when gates pass — without applying the winner", async () => {
    const store = seedStore();
    await startExperimentLifecycle(store, "exp-1", DAY_AGO);
    // started 26h ago; record enough metrics on both arms
    await recordMetricsLifecycle(
      store,
      "exp-1",
      "arm-ctrl",
      { impressions: 2000, clicks: 100 },
      NOW,
    );
    const out = await recordMetricsLifecycle(
      store,
      "exp-1",
      "arm-var",
      { impressions: 2000, clicks: 140 },
      NOW,
    );
    expect(out.concluded).not.toBeNull();
    expect(out.concluded?.conclusion.verdict).toBe("winner");
    expect(out.concluded?.conclusion.decided_by).toBe("auto");
    expect(out.concluded?.experiment.status).toBe("completed");
    // Auto-drafted learning is proposed, never validated, with evidence.
    const draft = out.concluded!.learningDraft;
    expect(draft.status).toBe("proposed");
    expect(draft.kind).toBe("experiment_outcome");
    expect(draft.source).toBe("system");
    expect(draft.experiment_id).toBe("exp-1");
    expect(draft.evidence.type).toBe("experiment_outcome");
    expect(draft.evidence.refs).toEqual(["exp-1"]);
    expect(draft.evidence.sample).toBe(4000);
    expect(draft.confidence).toBeCloseTo(0.992, 4); // 1 − p, rounded to 3dp
    expect(draft.statement).toContain("Variant");
    // CRITICAL: auto-conclude never applies the winner — no apply side
    // effects happened here; the plan is only built on explicit human action.
    const after = await store.getExperiment("exp-1");
    expect(after?.status).toBe("completed");
  });

  it("record does not auto-conclude before the gates pass", async () => {
    const store = seedStore();
    await startExperimentLifecycle(store, "exp-1", HOUR_AGO); // 1h ago
    const out = await recordMetricsLifecycle(
      store,
      "exp-1",
      "arm-var",
      { impressions: 2000, clicks: 140 },
      NOW,
    );
    expect(out.concluded).toBeNull();
    expect(out.evaluation.can_conclude).toBe(false);
    expect(out.evaluation.duration_gate.ok).toBe(false);
    // But the UI still gets live per-arm progress for "not yet significant".
    expect(out.evaluation.arm_results).toHaveLength(2);
  });

  it("human conclude throws ExperimentNotReadyError with gate detail", async () => {
    const store = seedStore();
    await startExperimentLifecycle(store, "exp-1", HOUR_AGO);
    await expect(concludeExperimentLifecycle(store, "exp-1", NOW, "human")).rejects.toBeInstanceOf(
      ExperimentNotReadyError,
    );
    try {
      await concludeExperimentLifecycle(store, "exp-1", NOW, "human");
    } catch (err) {
      const e = err as ExperimentNotReadyError;
      expect(e.evaluation.duration_gate.ok).toBe(false);
      expect(e.message).toContain("min duration not reached");
    }
  });

  it("human conclude on ready data completes with decided_by human", async () => {
    const store = seedStore();
    await startExperimentLifecycle(store, "exp-1", DAY_AGO);
    await recordMetricsLifecycle(
      store,
      "exp-1",
      "arm-ctrl",
      { impressions: 2000, clicks: 100 },
      NOW,
    );
    // Don't let auto-conclude fire: pause first (back to draft), then conclude as human.
    await pauseExperimentLifecycle(store, "exp-1", NOW);
    await store.mergeArmMetrics("arm-var", { impressions: 2000, clicks: 140 });
    const out = await concludeExperimentLifecycle(store, "exp-1", NOW, "human");
    expect(out.conclusion.decided_by).toBe("human");
    expect(out.conclusion.verdict).toBe("winner");
  });
});

describe("buildApplyWinnerPlan", () => {
  it("throws unless the experiment is completed with a winner", () => {
    const running = exp({ status: "running" });
    expect(() => buildApplyWinnerPlan(running, twoArms())).toThrow(/completed/);
    const inconclusive = exp({
      status: "completed",
      conclusion: { verdict: "inconclusive", winner_arm_id: null },
    });
    expect(() => buildApplyWinnerPlan(inconclusive, twoArms())).toThrow(/no winning arm/);
  });

  it("returns the winner's linked content", () => {
    const done = exp({
      status: "completed",
      conclusion: { verdict: "winner", winner_arm_id: "arm-var" },
    });
    const arms = twoArms();
    arms[1]!.thumbnail_id = "th-9";
    const plan = buildApplyWinnerPlan(done, arms);
    expect(plan.winner_arm_id).toBe("arm-var");
    expect(plan.title_variant_id).toBe("tv-2");
    expect(plan.thumbnail_id).toBe("th-9");
    expect(plan.project_id).toBe("proj-1");
  });
});

describe("buildExperimentLearningDraft", () => {
  it("drafts a winner statement with evidence and 1-p confidence", () => {
    const arms = twoArms();
    arms[0]!.metrics = { impressions: 2000, clicks: 100 };
    arms[1]!.metrics = { impressions: 2000, clicks: 140 };
    const conclusion = evaluateConclusion(exp(), arms, NOW, "auto").conclusion!;
    const draft = buildExperimentLearningDraft(exp(), arms, conclusion);
    expect(draft.topic).toBe("title");
    expect(draft.statement).toContain("7.0% vs 5.0%");
    expect(draft.statement).toContain("p=0.0077");
    expect(draft.confidence).toBeCloseTo(0.992, 4); // 1 − p, rounded to 3dp
    expect(draft.evidence.metrics["p_value"]).toBeCloseTo(0.00774202, 6);
  });

  it("drafts an inconclusive statement with 0.5 confidence", () => {
    const arms = twoArms();
    arms[0]!.metrics = { impressions: 2000, clicks: 120 };
    arms[1]!.metrics = { impressions: 2000, clicks: 150 };
    const conclusion = evaluateConclusion(exp(), arms, NOW, "human").conclusion!;
    const draft = buildExperimentLearningDraft(exp(), arms, conclusion);
    expect(draft.statement).toContain("No significant difference");
    expect(draft.confidence).toBe(0.5);
  });
});

describe("experimentTopic", () => {
  it("classifies the tested dimension", () => {
    expect(experimentTopic(twoArms())).toBe("title");
    const thumbs = twoArms().map((a) => ({ ...a, title_variant_id: null, thumbnail_id: "th-1" }));
    expect(experimentTopic(thumbs)).toBe("thumbnail");
    const both = twoArms().map((a) => ({ ...a, thumbnail_id: "th-1" }));
    expect(experimentTopic(both)).toBe("packaging");
  });
});
