/**
 * Sprint 7-8: NPS (Net Promoter Score) — pure math + validation.
 *
 * Collection: a simple in-app prompt (NpsPrompt component) storing score
 * 0-10 + optional comment in `nps_responses`. Admin view: NPS summary +
 * recent verbatims, with an honest empty state when nobody has answered.
 */

export type NpsCategory = "promoter" | "passive" | "detractor";

export interface NpsResponse {
  score: number;
  comment?: string | null;
  createdAt: string;
}

export interface NpsSummary {
  hasData: boolean;
  total: number;
  promoters: number;
  passives: number;
  detractors: number;
  /** -100..100, null when no responses. */
  nps: number | null;
}

/** 0-10 integer. Throws on anything else — the DB CHECK mirrors this. */
export function validateNpsScore(score: unknown): number {
  if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 10) {
    throw new Error("NPS score must be an integer from 0 to 10.");
  }
  return score;
}

/** 9-10 promoter, 7-8 passive, 0-6 detractor. */
export function npsCategory(score: number): NpsCategory {
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

/**
 * Standard NPS: (% promoters − % detractors) × 100, rounded to an integer.
 * Empty input → hasData: false, never a fake 0 presented as a measurement.
 */
export function computeNps(responses: NpsResponse[]): NpsSummary {
  const total = responses.length;
  if (total === 0) {
    return {
      hasData: false,
      total: 0,
      promoters: 0,
      passives: 0,
      detractors: 0,
      nps: null,
    };
  }
  let promoters = 0;
  let passives = 0;
  let detractors = 0;
  for (const r of responses) {
    const c = npsCategory(r.score);
    if (c === "promoter") promoters++;
    else if (c === "passive") passives++;
    else detractors++;
  }
  const nps = Math.round(((promoters - detractors) / total) * 100);
  return { hasData: true, total, promoters, passives, detractors, nps };
}

/** Recent non-empty comments for the admin verbatim list. */
export function recentComments(
  responses: (NpsResponse & { userId?: string })[],
  limit = 20,
): { score: number; comment: string; createdAt: string }[] {
  return responses
    .filter((r) => r.comment && r.comment.trim().length > 0)
    .slice(0, limit)
    .map((r) => ({
      score: r.score,
      comment: r.comment!.trim(),
      createdAt: r.createdAt,
    }));
}
