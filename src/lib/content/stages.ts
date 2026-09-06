export const PERMISSION_STATUSES = [
  "unknown",
  "permission_required",
  "permission_requested",
  "permission_granted",
  "permission_denied",
  "licensed",
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

export const APPROVED_RIGHTS: PermissionStatus[] = [
  "permission_granted",
  "licensed",
  "public_domain",
];

export function isApprovedRights(status: PermissionStatus): boolean {
  return APPROVED_RIGHTS.includes(status);
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
  if (args.rightsStatus === "do_not_use" || args.rightsStatus === "permission_denied") {
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
