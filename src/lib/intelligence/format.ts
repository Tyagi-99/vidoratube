/**
 * Phase 2 Intelligence — pure formatting helpers (no components).
 *
 * Kept separate from ui-states.tsx so that module stays component-only
 * (react-refresh/only-export-components).
 */

/** Compact relative time ("5m ago", "3d ago"). Null-safe. */
export function timeAgo(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

/** Compact number ("1.2K", "3.4M"). Null renders as an em dash. */
export function formatNumber(v: number | null): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v);
}
