/**
 * Phase 6 Stream E (P4) — surface preview specs (competitor pattern TI-9).
 *
 * The observed pattern: preview a thumbnail inside faithful recreations of
 * the surfaces where CTR is won or lost (feed, search, suggested, channel,
 * mobile) — catching designs that fail at small sizes or next to real
 * content before publishing.
 *
 * HOW VIDORA'S IMPLEMENTATION DIFFERS (D303): Vidora's mocks are generic,
 * original surface sketches in Vidora's own design language — not copies of
 * YouTube's interface. Widths are the real display widths YouTube uses so
 * legibility checks are honest; the panel labels itself as a generic mock.
 *
 * Pure module — the component lives in SurfacePreview.tsx.
 */

/** A mock watch-surface with a size-accurate thumbnail slot. */
export interface SurfaceSpec {
  /** Stable id. */
  id: string;
  /** Human label. */
  label: string;
  /** Real display width of the thumbnail on this surface (px). */
  thumbWidthPx: number;
  /** Layout style of the mock. */
  layout: "card" | "row" | "stack" | "grid" | "mobile";
  /** Whether to show a title line under the thumbnail. */
  showTitle: boolean;
  /** Whether to show a channel avatar. */
  showAvatar: boolean;
}

const SIXTEEN_BY_NINE = 9 / 16;

/** Display widths mirror real YouTube surface sizes (rounded). */
export const SURFACE_SPECS: readonly SurfaceSpec[] = [
  {
    id: "home",
    label: "Home feed card",
    thumbWidthPx: 360,
    layout: "card",
    showTitle: true,
    showAvatar: true,
  },
  {
    id: "search",
    label: "Search result",
    thumbWidthPx: 240,
    layout: "row",
    showTitle: true,
    showAvatar: false,
  },
  {
    id: "suggested",
    label: "Suggested sidebar",
    thumbWidthPx: 168,
    layout: "stack",
    showTitle: true,
    showAvatar: false,
  },
  {
    id: "mobile",
    label: "Mobile feed",
    thumbWidthPx: 390,
    layout: "mobile",
    showTitle: true,
    showAvatar: true,
  },
  {
    id: "channel",
    label: "Channel grid",
    thumbWidthPx: 210,
    layout: "grid",
    showTitle: true,
    showAvatar: false,
  },
];

/** 16:9 height for a display width, rounded. */
export function thumbHeightPx(widthPx: number): number {
  return Math.round(widthPx * SIXTEEN_BY_NINE);
}

/** Longest title that fits `lines` at this width (approx. 8px/char heuristic). */
export function titleClampChars(widthPx: number, lines: number): number {
  return Math.max(12, Math.floor((widthPx / 8) * lines));
}
