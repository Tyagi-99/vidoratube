/**
 * Phase 2 (Intelligence) shared types — COORDINATOR-OWNED.
 * Streams consume these; changes require coordinator approval
 * (see docs/PHASE2_CONTRACTS.md).
 */

export type Confidence = "high" | "medium" | "low";

export interface ScoreFactor {
  /** Machine key, e.g. "demand", "competition", "velocity", "freshness". */
  key: string;
  /** Human label. */
  label: string;
  /** 0..1, weights across factors sum to 1. */
  weight: number;
  /** 0..100 normalized. */
  value: number;
  /** One-line explanation of how this value was derived. */
  detail: string;
  /** Rows behind this factor (0 → factor renders with "weak evidence" badge). */
  evidenceCount: number;
}

export interface NicheScore {
  score0to100: number;
  factors: ScoreFactor[];
  confidence: Confidence;
  /** ISO timestamp. */
  capturedAt: string;
  source: "youtube-data-api";
  /** Channels behind the score. */
  channelCount: number;
}

export interface OutlierScore {
  /** Multiple of channel median, e.g. 3.2 = 3.2x the channel's typical views. */
  score: number;
  /** Views/day since first snapshot; null when fewer than 2 snapshots. */
  velocityPerDay: number | null;
  factors: ScoreFactor[];
  confidence: Confidence;
  snapshotsUsed: number;
}

export interface Freshness {
  capturedAt: string | null;
  staleAfterHours: number;
}

export type StatusEnvelope =
  | { status: "ok" }
  | { status: "unconfigured"; reason: string }
  | { status: "insufficient_data"; reason: string };

/** Confidence rule: high ≥ 10 evidence channels / ≥ 3 snapshots; medium ≥ 4; else low. */
export function confidenceFor(evidenceCount: number, snapshotCount = 0): Confidence {
  if (evidenceCount >= 10 || snapshotCount >= 3) return "high";
  if (evidenceCount >= 4 || snapshotCount >= 2) return "medium";
  return "low";
}
