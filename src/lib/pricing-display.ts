/** Feature bullets shown on the marketing site. DB copy can over-claim; this is the source of truth. */

const HONEST_FEATURES: Record<string, string[]> = {
  starter: [
    "20 video credits / month",
    "1080p MP4 exports",
    "AI narration",
    "Burned-in captions",
    "Email support",
  ],
  studio: [
    "70 video credits / month",
    "1080p MP4 exports",
    "More voices as we add them",
    "Burned-in captions",
    "Priority support",
  ],
  scale: [
    "250 video credits / month",
    "1080p landscape and 9:16 exports",
    "Burned-in captions",
    "Volume help via email",
  ],
};

const BANNED =
  /4k|voice cloning|brand kit|api access|team seats|custom integrations|dedicated manager/i;

export function sanitizeFeatureList(features: unknown): string[] {
  if (!Array.isArray(features)) return [];
  return features.filter((item): item is string => typeof item === "string" && !BANNED.test(item));
}

export function displayPlanFeatures(plan: { slug: string; features: unknown }): string[] {
  return HONEST_FEATURES[plan.slug] ?? sanitizeFeatureList(plan.features);
}

export const PRICING_FOOTNOTE =
  "Create a free account for 10 render credits — no card needed.";

export const PRICING_FOOTNOTE_SETUP =
  "Checkout is being set up. Create a free account for 10 render credits — no card needed.";
