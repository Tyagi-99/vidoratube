/**
 * F35 learning engine tests (pure logic, in-memory store).
 *
 * Covers the evidence gate (no gateless promotions), comment-signal
 * drafting (read-only over engagement insights, ≥3 threshold, dedupe), and
 * pattern mining (validated-only input, "AI analysis" label, citations).
 */
import { describe, expect, it } from "vitest";
import {
  archiveLearningLifecycle,
  createManualLearningLifecycle,
  createMemoryLearningStore,
  draftCommentSignalLearnings,
  draftCommentSignalsLifecycle,
  evidenceGateCheck,
  minePatternBriefs,
  minePatternsLifecycle,
  promoteLearningLifecycle,
  refuteLearningLifecycle,
  validateManualLearning,
  EvidenceGateError,
  LearningValidationError,
  type EngagementInsightRow,
  type LearningRow,
} from "./learnings.server";

const NOW = new Date("2026-09-28T12:00:00Z");
const DAY = 86_400_000;

function learning(over: Partial<LearningRow> = {}): LearningRow {
  return {
    id: "learn-1",
    user_id: "user-1",
    kind: "experiment_outcome",
    topic: "title",
    payload: { statement: "Variant B beat control on CTR." },
    evidence: {
      type: "experiment_outcome",
      refs: ["exp-1"],
      metrics: { p_value: 0.0077 },
      sample: 4000,
    },
    confidence: 0.99,
    source: "system",
    status: "proposed",
    experiment_id: "exp-1",
    created_at: new Date(NOW.getTime() - DAY).toISOString(),
    ...over,
  };
}

function insight(over: Partial<EngagementInsightRow> = {}): EngagementInsightRow {
  return {
    id: "ins-1",
    user_id: "user-1",
    kind: "audience_request",
    comment_id: null,
    payload: { theme: "more behind-the-scenes" },
    created_at: new Date(NOW.getTime() - 2 * DAY).toISOString(),
    ...over,
  };
}

describe("evidenceGateCheck", () => {
  it("passes with evidence + confidence in (0, 1]", () => {
    expect(
      evidenceGateCheck({
        evidence: { refs: ["a"], metrics: {}, sample: 10 },
        confidence: 0.8,
      }).ok,
    ).toBe(true);
    expect(
      evidenceGateCheck({
        evidence: {},
        confidence: 1,
      }).ok,
    ).toBe(false); // no evidence at all
  });

  it("rejects missing evidence, missing confidence, and confidence 0", () => {
    const noEvidence = evidenceGateCheck({ evidence: {}, confidence: 0.9 });
    expect(noEvidence.ok).toBe(false);
    expect(noEvidence.reasons.join(" ")).toContain("no evidence");

    const noConfidence = evidenceGateCheck({
      evidence: { refs: ["a"] },
      confidence: null,
    });
    expect(noConfidence.ok).toBe(false);

    const zeroConfidence = evidenceGateCheck({
      evidence: { refs: ["a"] },
      confidence: 0,
    });
    expect(zeroConfidence.ok).toBe(false);
    expect(zeroConfidence.reasons.join(" ")).toContain("(0, 1]");
  });
});

describe("promoteLearningLifecycle", () => {
  it("promotes a gated learning proposed → validated", async () => {
    const store = createMemoryLearningStore({ learnings: [learning()] });
    const out = await promoteLearningLifecycle(store, "learn-1");
    expect(out.status).toBe("validated");
  });

  it("refuses to promote without evidence (stays proposed)", async () => {
    const store = createMemoryLearningStore({
      learnings: [learning({ id: "learn-2", evidence: {}, confidence: null })],
    });
    await expect(promoteLearningLifecycle(store, "learn-2")).rejects.toBeInstanceOf(
      EvidenceGateError,
    );
    expect((await store.getLearning("learn-2"))?.status).toBe("proposed");
  });

  it("refuses to promote with zero confidence", async () => {
    const store = createMemoryLearningStore({
      learnings: [learning({ id: "learn-3", confidence: 0 })],
    });
    await expect(promoteLearningLifecycle(store, "learn-3")).rejects.toBeInstanceOf(
      EvidenceGateError,
    );
  });

  it("refuses to re-validate an already validated learning", async () => {
    const store = createMemoryLearningStore({
      learnings: [learning({ status: "validated" })],
    });
    await expect(promoteLearningLifecycle(store, "learn-1")).rejects.toThrow(
      LearningValidationError,
    );
  });
});

describe("refute / archive", () => {
  it("refutes and archives", async () => {
    const store = createMemoryLearningStore({ learnings: [learning()] });
    expect((await refuteLearningLifecycle(store, "learn-1")).status).toBe("refuted");
    expect((await archiveLearningLifecycle(store, "learn-1")).status).toBe("archived");
  });
});

describe("validateManualLearning", () => {
  it("accepts a well-formed manual learning", () => {
    const v = validateManualLearning({
      kind: "pattern",
      topic: "hook",
      statement: "Hooks phrased as questions hold attention longer.",
      evidence: { type: "manual", refs: [], metrics: { note: "editor review" }, sample: 12 },
      confidence: 0.7,
    });
    expect(v.topic).toBe("hook");
    expect(v.confidence).toBe(0.7);
  });

  it("rejects short statements, bad kinds, bad confidence", () => {
    expect(() => validateManualLearning({ kind: "pattern", statement: "too short" })).toThrow(
      LearningValidationError,
    );
    expect(() =>
      validateManualLearning({ kind: "bogus" as never, statement: "a long enough statement here" }),
    ).toThrow(LearningValidationError);
    expect(() =>
      validateManualLearning({
        kind: "pattern",
        statement: "a long enough statement here",
        confidence: 1.5,
      }),
    ).toThrow(LearningValidationError);
  });

  it("manual learnings without evidence stay proposed", async () => {
    const store = createMemoryLearningStore();
    const created = await createManualLearningLifecycle(store, "user-1", {
      kind: "pattern",
      statement: "Thumbnails with faces seem to do better, anecdotally.",
    });
    expect(created.status).toBe("proposed");
    expect(created.source).toBe("human");
    expect(created.confidence).toBeNull();
    await expect(promoteLearningLifecycle(store, created.id)).rejects.toBeInstanceOf(
      EvidenceGateError,
    );
  });
});

describe("draftCommentSignalLearnings", () => {
  it("drafts one learning per kind with ≥3 recent insights", () => {
    const insights = [
      insight({ id: "i1", kind: "audience_request" }),
      insight({ id: "i2", kind: "audience_request", payload: { theme: "more behind-the-scenes" } }),
      insight({ id: "i3", kind: "audience_request", payload: { theme: "tutorials" } }),
      insight({ id: "i4", kind: "question" }),
      insight({ id: "i5", kind: "question" }), // only 2 → no draft
    ];
    const drafts = draftCommentSignalLearnings(insights, [], NOW);
    expect(drafts).toHaveLength(1);
    const d = drafts[0]!;
    expect(d.kind).toBe("comment_signal");
    expect(d.topic).toBe("audience");
    expect(d.status).toBe("proposed");
    expect(d.source).toBe("system");
    expect(d.statement).toContain("3 audience requests");
    expect(d.statement).toContain("more behind-the-scenes");
    expect(d.evidence.type).toBe("comment_signal");
    expect(d.evidence.refs).toEqual(["i1", "i2", "i3"]);
    expect(d.evidence.sample).toBe(3);
    expect(d.confidence).toBe(0.6);
  });

  it("ignores insights older than 30 days and already-drafted kinds", () => {
    const insights = [
      insight({
        id: "old1",
        kind: "audience_request",
        created_at: new Date(NOW.getTime() - 40 * DAY).toISOString(),
      }),
      insight({
        id: "old2",
        kind: "audience_request",
        created_at: new Date(NOW.getTime() - 40 * DAY).toISOString(),
      }),
      insight({
        id: "old3",
        kind: "audience_request",
        created_at: new Date(NOW.getTime() - 40 * DAY).toISOString(),
      }),
    ];
    expect(draftCommentSignalLearnings(insights, [], NOW)).toHaveLength(0);

    const fresh = [
      insight({ id: "f1", kind: "trend" }),
      insight({ id: "f2", kind: "trend" }),
      insight({ id: "f3", kind: "trend" }),
    ];
    expect(draftCommentSignalLearnings(fresh, ["trend"], NOW)).toHaveLength(0);
    expect(draftCommentSignalLearnings(fresh, [], NOW)).toHaveLength(1);
  });
});

describe("draftCommentSignalsLifecycle", () => {
  it("inserts drafts and dedupes kinds drafted within 30 days", async () => {
    const store = createMemoryLearningStore({
      insights: [
        insight({ id: "i1", kind: "audience_request" }),
        insight({ id: "i2", kind: "audience_request" }),
        insight({ id: "i3", kind: "audience_request" }),
      ],
    });
    const first = await draftCommentSignalsLifecycle(store, "user-1", NOW);
    expect(first.inserted).toHaveLength(1);
    const second = await draftCommentSignalsLifecycle(store, "user-1", NOW);
    expect(second.inserted).toHaveLength(0);
    expect(second.skipped).toContain("audience_request");
  });
});

function validatedExperimentLearning(
  id: string,
  topic: string,
  controlValue: number,
  winnerValue: number,
  confidence: number,
): LearningRow {
  return learning({
    id,
    topic,
    status: "validated",
    confidence,
    evidence: {
      type: "experiment_outcome",
      refs: ["exp-x"],
      metrics: {
        p_value: 0.01,
        per_arm: [
          {
            arm_id: "c",
            arm_name: "Control",
            arm_type: "control",
            sample_size: 2000,
            metric_value: controlValue,
            p_value_vs_control: null,
            significant_improvement: false,
          },
          {
            arm_id: "v",
            arm_name: "Variant",
            arm_type: "variant",
            sample_size: 2000,
            metric_value: winnerValue,
            p_value_vs_control: 0.01,
            significant_improvement: true,
          },
        ],
      },
      sample: 4000,
    },
  });
}

describe("minePatternBriefs", () => {
  it("aggregates validated learnings by topic with lift stats", () => {
    const learnings = [
      validatedExperimentLearning("l1", "thumbnail", 0.05, 0.07, 0.99), // +40%
      validatedExperimentLearning("l2", "thumbnail", 0.04, 0.048, 0.95), // +20%
      validatedExperimentLearning("l3", "title", 0.05, 0.06, 0.9), // +20%
    ];
    const drafts = minePatternBriefs(learnings);
    expect(drafts).toHaveLength(2);

    const thumb = drafts.find((d) => d.topic === "thumbnail")!;
    expect(thumb.kind).toBe("pattern");
    expect(thumb.source).toBe("ai_analysis"); // ALWAYS labeled AI analysis
    expect(thumb.status).toBe("proposed"); // human validates before trust
    expect(thumb.statement).toContain("Across 2 experiments");
    expect(thumb.statement).toContain("average of 30.0%");
    expect(thumb.statement).toContain("range 20.0%–40.0%");
    expect(thumb.evidence.refs).toEqual(["l1", "l2"]); // cites learnings
    expect(thumb.evidence.metrics["avg_lift_pct"]).toBe(30);
    // Conservative confidence: weakest citation.
    expect(thumb.confidence).toBe(0.95);
  });

  it("ignores non-validated learnings (only validated feed brief advice)", () => {
    const learnings = [
      validatedExperimentLearning("l1", "thumbnail", 0.05, 0.07, 0.99),
      learning({ id: "l2", topic: "thumbnail", status: "proposed" }), // not validated
    ];
    const drafts = minePatternBriefs(learnings);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.evidence.refs).toEqual(["l1"]);
  });

  it("handles topics with no lift figures honestly", () => {
    const learnings = [learning({ id: "l9", topic: "hook", status: "validated", confidence: 0.7 })];
    const drafts = minePatternBriefs(learnings);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.statement).toContain("no comparable lift figures");
  });
});

describe("minePatternsLifecycle", () => {
  it("inserts AI-analysis pattern drafts for validated learnings", async () => {
    const store = createMemoryLearningStore({
      learnings: [
        validatedExperimentLearning("l1", "thumbnail", 0.05, 0.07, 0.99),
        validatedExperimentLearning("l2", "thumbnail", 0.04, 0.048, 0.95),
      ],
    });
    const out = await minePatternsLifecycle(store, "user-1");
    expect(out.inserted).toHaveLength(1);
    const row = out.inserted[0]!;
    expect(row.kind).toBe("pattern");
    expect(row.source).toBe("ai_analysis");
    expect(row.status).toBe("proposed");
    expect(row.topic).toBe("thumbnail");
  });
});
