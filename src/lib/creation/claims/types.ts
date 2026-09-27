/**
 * F11 Deep Research hardening — claim-level provenance types.
 *
 * Competitor pattern #3: approval-first gates + claim-level provenance.
 * Every factual claim in a script must resolve to a verified/qualified
 * claim row with supporting sources; a human reviewer confirms or waives
 * each claim (never auto-approved). With per-project strict mode on,
 * packaging/publishing is BLOCKED while any claim is unreviewed.
 *
 * D89: local table-type declarations are `type` aliases (not interfaces).
 */
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import { jsonValueSchema } from "../json";

export const CLAIM_VERDICTS = ["verified", "qualified", "unsupported", "disputed"] as const;
export const ClaimVerdictSchema = z.enum(CLAIM_VERDICTS);
export type ClaimVerdict = z.infer<typeof ClaimVerdictSchema>;

export const CLAIM_REVIEW_STATES = ["unreviewed", "confirmed", "waived"] as const;
export const ClaimReviewStateSchema = z.enum(CLAIM_REVIEW_STATES);
export type ClaimReviewState = z.infer<typeof ClaimReviewStateSchema>;

/** Row shape mirroring public.research_claims (+ Phase-3 review columns). */
export type ResearchClaimRow = {
  id: string;
  user_id: string;
  source_id: string;
  claim: string;
  verdict: ClaimVerdict;
  evidence: Json;
  review_state: ClaimReviewState;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
};

/** Claim + the source row(s) backing it — what the Evidence Desk renders. */
export type ClaimWithSources = ResearchClaimRow & {
  sources: {
    id: string;
    title: string;
    url: string | null;
    source_type: string;
    published_at: string | null;
  }[];
};

/** A rule-based extraction candidate — NOT yet a stored claim. */
export const ClaimCandidateSchema = z.object({
  /** The candidate sentence, verbatim from the script. */
  text: z.string().min(1).max(2000),
  /** 0..1 heuristic score: why the extractor flagged this sentence. */
  score: z.number().min(0).max(1),
  /** Human-readable reasons, e.g. ["contains a number", "cites a study"]. */
  reasons: z.array(z.string()),
  /** Source ids (from the project's canvas) the linker matched. */
  matchedSourceIds: z.array(z.string().uuid()),
});
export type ClaimCandidate = z.infer<typeof ClaimCandidateSchema>;

export const SaveClaimsSchema = z.object({
  projectId: z.string().uuid(),
  claims: z
    .array(
      z.object({
        claim: z.string().trim().min(1).max(2000),
        verdict: ClaimVerdictSchema.default("unsupported"),
        /** The canvas source backing this claim (FK requires one). */
        sourceId: z.string().uuid(),
        evidence: jsonValueSchema.default({}),
      }),
    )
    .min(1)
    .max(200),
});
export type SaveClaimsInput = z.infer<typeof SaveClaimsSchema>;

export const SetReviewSchema = z.object({
  claimId: z.string().uuid(),
  /** Only explicit human decisions — "unreviewed" can never be set back by this fn. */
  reviewState: z.enum(["confirmed", "waived"]),
  note: z.string().max(500).default(""),
});
export type SetReviewInput = z.infer<typeof SetReviewSchema>;

export const REVIEW_STATE_COPY: Record<ClaimReviewState, { label: string; hint: string }> = {
  unreviewed: {
    label: "Unreviewed",
    hint: "No human has signed off on this claim yet.",
  },
  confirmed: {
    label: "Confirmed",
    hint: "A reviewer verified this claim against its sources.",
  },
  waived: {
    label: "Waived",
    hint: "A reviewer explicitly accepted this claim without full evidence.",
  },
};

export const VERDICT_COPY: Record<ClaimVerdict, { label: string; hint: string }> = {
  verified: { label: "Verified", hint: "Backed by a primary or strong source." },
  qualified: { label: "Qualified", hint: "Backed with caveats (date, scope, source quality)." },
  unsupported: { label: "Unsupported", hint: "No supporting evidence attached." },
  disputed: { label: "Disputed", hint: "Sources disagree on this claim." },
};

import type { ClaimSourceMatch } from "./linker";

/**
 * One extracted candidate claim with its candidate supporting sources.
 * Declared here (not in the server module) so client components can import
 * the type without pulling server code.
 */
export type ExtractedClaim = {
  text: string;
  /** 0..1 heuristic score (why the extractor flagged it). */
  score: number;
  reasons: string[];
  matches: ClaimSourceMatch[];
};
