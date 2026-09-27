/**
 * Stream B — deterministic niche opportunity scoring (F1).
 *
 * Rule-based engine, no LLM. The score is ALWAYS returned together with its
 * factors (score is never presented without them — see PHASE2_CONTRACTS.md).
 * All math is pure/deterministic: identical inputs → identical outputs.
 */

import { confidenceFor, type Confidence, type NicheScore, type ScoreFactor } from "./types";

/**
 * Pinned ChannelCard shape (PHASE2_CONTRACTS.md §Stream A).
 * Stream A writes the rows; scoring only consumes this shape.
 */
export interface ChannelCardInput {
  id: string;
  externalChannelId: string;
  handle: string | null;
  title: string | null;
  subscriberCount: number | null;
  videoCount: number | null;
  viewCount: number | null;
  growth7dPct: number | null;
  lastSnapshotAt: string | null;
}

export interface NicheInput {
  id: string;
  name: string;
  keywords: string[];
  minSubs?: number | null;
  maxSubs?: number | null;
  preferredLanguage?: string | null;
  preferredFormat?: string | null;
  /** Optional per-factor weight overrides, e.g. { demand: 2, velocity: 1 }. */
  scoringWeights?: Record<string, number> | null;
}

export interface ScoreInput {
  niche: NicheInput;
  /** Channels already filtered to the niche's filters (subs band, active, …). */
  channels: ChannelCardInput[];
  /**
   * Demand proxy: videos published by the niche's tracked channels in the
   * last 7 days. Labeled ESTIMATE everywhere it surfaces — it measures
   * tracked-channel output volume, not market-wide demand.
   */
  videosPublished7d: number;
  /** Override "now" for deterministic tests. */
  now?: Date;
}

const FACTOR_KEYS = ["demand", "competition", "velocity", "freshness"] as const;

const DEFAULT_WEIGHTS: Record<(typeof FACTOR_KEYS)[number], number> = {
  demand: 0.3,
  competition: 0.25,
  velocity: 0.25,
  freshness: 0.2,
};

/** Freshness horizon: a channel snapshot counts as fresh for 72 hours. */
export const FRESHNESS_HOURS = 72;

function clamp01to100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Resolve factor weights: niche.scoring_weights overrides the defaults for
 * any of the four factor keys; everything is normalized to sum to 1.
 * Falls back to defaults when the stored value is missing/invalid.
 */
export function resolveWeights(
  scoringWeights: Record<string, number> | null | undefined,
): Record<(typeof FACTOR_KEYS)[number], number> {
  const out = { ...DEFAULT_WEIGHTS };
  if (scoringWeights && typeof scoringWeights === "object") {
    let anyValid = false;
    for (const k of FACTOR_KEYS) {
      const v = scoringWeights[k];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        out[k] = v;
        anyValid = true;
      }
    }
    if (!anyValid) return { ...DEFAULT_WEIGHTS };
  }
  const total = FACTOR_KEYS.reduce((a, k) => a + out[k], 0);
  if (!(total > 0)) return { ...DEFAULT_WEIGHTS };
  for (const k of FACTOR_KEYS) out[k] = out[k] / total;
  return out;
}

/**
 * Compute the niche opportunity score from tracked-channel evidence.
 * Pure function — no I/O, no network, no randomness.
 */
export function scoreNicheOpportunity(input: ScoreInput): NicheScore {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const channels = input.channels;
  const weights = resolveWeights(input.niche.scoringWeights);

  // ── demand: keyword video-volume proxy ─────────────────────────────
  const vol = Math.max(0, Math.floor(input.videosPublished7d));
  const demandValue = clamp01to100((100 * Math.log10(1 + vol)) / Math.log10(1 + 2000));
  const demand: ScoreFactor = {
    key: "demand",
    label: "Demand",
    weight: weights.demand,
    value: Math.round(demandValue * 10) / 10,
    detail:
      `ESTIMATE — ${vol} video${vol === 1 ? "" : "s"} published by tracked channels ` +
      `in the last 7 days (tracked-output volume proxy, not market-wide demand).`,
    evidenceCount: vol,
  };

  // ── competition: channel density in the subs band (inverse) ─────────
  const density = channels.length;
  const competitionValue =
    density === 0 ? 100 : clamp01to100(100 * (1 - Math.min(1, density / 60)));
  const competition: ScoreFactor = {
    key: "competition",
    label: "Competition",
    weight: weights.competition,
    value: Math.round(competitionValue * 10) / 10,
    detail:
      density === 0
        ? "No tracked channels in this niche yet — low competition, but also low evidence."
        : `${density} tracked channel${density === 1 ? "" : "s"} in the subs band; ` +
          `fewer competitors scores higher (scored against 60 channels = saturated).`,
    evidenceCount: density,
  };

  // ── velocity: median 7-day subscriber growth ────────────────────────
  const growths = channels
    .map((c) => c.growth7dPct)
    .filter((g): g is number => typeof g === "number" && Number.isFinite(g));
  const med = median(growths);
  const velocityValue = med == null ? 0 : clamp01to100(med * 8); // 12.5% weekly growth → 100
  const velocity: ScoreFactor = {
    key: "velocity",
    label: "Velocity",
    weight: weights.velocity,
    value: Math.round(velocityValue * 10) / 10,
    detail:
      med == null
        ? "No 7-day growth data yet — needs snapshots ≥ 7 days apart."
        : `Median 7-day subscriber growth across ${growths.length} tracked channel${growths.length === 1 ? "" : "s"}: ` +
          `${med >= 0 ? "+" : ""}${med.toFixed(1)}%.`,
    evidenceCount: growths.length,
  };

  // ── freshness: share of channels with a recent snapshot ─────────────
  const withSnapshot = channels.filter((c) => c.lastSnapshotAt);
  const freshCount = withSnapshot.filter((c) => {
    const ageMs = nowMs - new Date(c.lastSnapshotAt!).getTime();
    return ageMs >= 0 && ageMs <= FRESHNESS_HOURS * 3_600_000;
  }).length;
  const freshnessValue =
    withSnapshot.length === 0 ? 0 : clamp01to100((100 * freshCount) / withSnapshot.length);
  const freshness: ScoreFactor = {
    key: "freshness",
    label: "Freshness",
    weight: weights.freshness,
    value: Math.round(freshnessValue * 10) / 10,
    detail:
      withSnapshot.length === 0
        ? `No channel snapshots yet — capture snapshots to improve freshness.`
        : `${freshCount} of ${withSnapshot.length} tracked channels have a snapshot ` +
          `within the last ${FRESHNESS_HOURS}h.`,
    evidenceCount: withSnapshot.length,
  };

  const factors = [demand, competition, velocity, freshness];
  const score0to100 = Math.round(factors.reduce((a, f) => a + f.value * f.weight, 0) * 10) / 10;

  // Confidence: base rule, then one level down per zero-evidence factor.
  let confidence: Confidence = confidenceFor(channels.length);
  const downgrade = (c: Confidence): Confidence =>
    c === "high" ? "medium" : c === "medium" ? "low" : "low";
  for (const f of factors) {
    if (f.evidenceCount === 0) confidence = downgrade(confidence);
  }

  return {
    score0to100,
    factors,
    confidence,
    capturedAt: now.toISOString(),
    source: "youtube-data-api",
    channelCount: channels.length,
  };
}

/** Median helper exposed for the blueprint builder (same deterministic math). */
export const scoringInternals = { median, clamp01to100, resolveWeights };
