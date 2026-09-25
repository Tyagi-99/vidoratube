/**
 * Thumbnail studio: variant specs, text overlay validation, and selection logic.
 * Pure functions — no I/O, fully unit-tested.
 */

export const THUMBNAIL_VARIANTS = 3 as const;
export type ThumbnailAspect = "16:9" | "9:16";

export interface TextOverlay {
  headline: string;
  /** Font family key from the allowed list (no arbitrary webfonts). */
  font: "bold-sans" | "condensed" | "serif-display" | "mono";
  /** Hex color, validated. */
  color: string;
  /** Vertical anchor for the text block. */
  position: "top" | "center" | "bottom";
  fontSize: "sm" | "md" | "lg";
}

export const THUMBNAIL_FONTS = ["bold-sans", "condensed", "serif-display", "mono"] as const;
export const THUMBNAIL_POSITIONS = ["top", "center", "bottom"] as const;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Validates a text overlay spec. Returns an error message or null if valid. */
export function validateTextOverlay(overlay: Partial<TextOverlay>): string | null {
  if (!overlay.headline || !overlay.headline.trim()) return "Headline is required";
  if (overlay.headline.length > 60) return "Headline must be 60 characters or fewer";
  if (overlay.font && !(THUMBNAIL_FONTS as readonly string[]).includes(overlay.font)) {
    return "Unknown font";
  }
  if (overlay.color && !HEX_COLOR.test(overlay.color)) return "Color must be a #RRGGBB hex value";
  if (overlay.position && !(THUMBNAIL_POSITIONS as readonly string[]).includes(overlay.position)) {
    return "Unknown position";
  }
  return null;
}

/** Builds the image-generation prompt for a thumbnail variant. */
export function buildThumbnailPrompt(args: {
  videoTitle: string;
  videoTopic: string;
  styleHint?: string;
  variant: number;
  aspect: ThumbnailAspect;
  focus?: "face" | "object" | "scene";
}): string {
  const anglePhrases = [
    "dramatic close-up composition with strong focal point",
    "wide establishing composition with bold negative space for text",
    "dynamic action composition with leading lines toward the subject",
  ];
  const angle = anglePhrases[(args.variant - 1) % anglePhrases.length];
  const dims = args.aspect === "16:9" ? "1280x720 landscape" : "720x1280 portrait";
  const focus = args.focus ? `, emphasizing ${args.focus}` : "";
  const style = args.styleHint ? ` Style: ${args.styleHint}.` : "";
  return (
    `YouTube thumbnail, ${dims}: ${angle}${focus}, for a video titled "${args.videoTitle}" ` +
    `about ${args.videoTopic}. High contrast, saturated colors, readable at small sizes, ` +
    `no text baked into the image (text is overlaid separately).${style}`
  ).trim();
}

/**
 * Picks the selected variant for publishing. Prefers an explicitly selected
 * variant; falls back to variant 1. Returns null when there are no variants.
 */
export function selectThumbnailVariant<T extends { variant: number; selected: boolean }>(
  variants: T[],
): T | null {
  if (variants.length === 0) return null;
  return variants.find((v) => v.selected) ?? variants.find((v) => v.variant === 1) ?? variants[0] ?? null;
}
