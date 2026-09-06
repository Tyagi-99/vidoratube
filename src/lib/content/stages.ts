export const PERMISSION_STATUSES = [
  "unknown",
  "permission_required",
  "permission_requested",
  "permission_granted",
  "permission_denied",
  "licensed",
  "owned",
  "public_domain",
  "do_not_use",
] as const;

export type PermissionStatus = (typeof PERMISSION_STATUSES)[number];

export const PIPELINE_STAGES = [
  "discovered",
  "shortlisted",
  "rights_check",
  "approved",
  "asset_acquired",
  "analyzed",
  "script_generated",
  "voiceover_generated",
  "captions_generated",
  "edited",
  "qa",
  "ready",
  "published",
  "failed",
  "rejected",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Stages that require an approved rights basis before entry. */
export const ASSET_OR_LATER: PipelineStage[] = [
  "asset_acquired",
  "analyzed",
  "script_generated",
  "voiceover_generated",
  "captions_generated",
  "edited",
  "qa",
  "ready",
  "published",
];

/** Explicit clearances that unlock final render / asset use. */
export const APPROVED_RIGHTS: PermissionStatus[] = [
  "permission_granted",
  "licensed",
  "owned",
  "public_domain",
];

export const BLOCKED_RIGHTS: PermissionStatus[] = ["do_not_use", "permission_denied"];

export function isApprovedRights(status: PermissionStatus): boolean {
  return APPROVED_RIGHTS.includes(status);
}

export function isBlockedRights(status: PermissionStatus): boolean {
  return BLOCKED_RIGHTS.includes(status);
}

/**
 * Final MP4 render gate for Mode 2.
 * Blocks do_not_use / permission_denied / unknown (and other non-approved) statuses.
 */
export function canRenderFinal(rightsStatus: PermissionStatus): {
  ok: true;
} | { ok: false; reason: string } {
  if (isBlockedRights(rightsStatus)) {
    return {
      ok: false,
      reason: `Cannot render final video while rights are "${rightsStatus}".`,
    };
  }
  if (!isApprovedRights(rightsStatus)) {
    return {
      ok: false,
      reason: `Cannot render final video without explicit rights clearance (got "${rightsStatus}"). Choose owned, licensed, permission_granted, or public_domain.`,
    };
  }
  return { ok: true };
}

export function canEnterStage(args: {
  target: PipelineStage;
  rightsStatus: PermissionStatus;
}): { ok: true } | { ok: false; reason: string } {
  if (ASSET_OR_LATER.includes(args.target) && !isApprovedRights(args.rightsStatus)) {
    return {
      ok: false,
      reason: `Cannot enter stage "${args.target}" without approved rights (got "${args.rightsStatus}").`,
    };
  }
  if (isBlockedRights(args.rightsStatus)) {
    if (args.target !== "rejected" && args.target !== "failed") {
      return {
        ok: false,
        reason: `Content marked "${args.rightsStatus}" cannot progress to "${args.target}".`,
      };
    }
  }
  return { ok: true };
}

/** Seed niche names for P1 — stored as data, not hard-coded app logic. */
export const DEFAULT_NICHE_SEEDS: { name: string; slug: string }[] = [
  { name: "Nature", slug: "nature" },
  { name: "Travel", slug: "travel" },
  { name: "Cooking", slug: "cooking" },
  { name: "Pets", slug: "pets" },
  { name: "Construction", slug: "construction" },
  { name: "Camping / Outdoor", slug: "camping-outdoor" },
  { name: "Car Cleaning / Detailing", slug: "car-cleaning-detailing" },
  { name: "Sports", slug: "sports" },
  { name: "Fishing", slug: "fishing" },
  { name: "Interesting products / gear", slug: "interesting-products-gear" },
  { name: "Viral / general-interest", slug: "viral-general-interest" },
  { name: "Emotional content", slug: "emotional-content" },
  { name: "Quotes / statements", slug: "quotes-statements" },
];
