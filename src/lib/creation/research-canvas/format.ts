/**
 * F9 — presentation helpers for the research canvas.
 *
 * Pure functions (client-safe): freshness timestamps and stale detection.
 * D94: dates shown are data (created_at / published_at); "stale" is a
 * rule-based label with its threshold named, never a quality verdict.
 */

/** Sources published longer ago than this are labeled "stale". */
export const STALE_AFTER_DAYS = 180;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Relative freshness label for a source timestamp.
 * `iso` null/blank → "date unknown" (honest, never invented).
 * Future timestamps clamp to "just now" (clock skew, not prophecy).
 */
export function formatFreshness(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return "date unknown";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "date unknown";
  const delta = nowMs - t;
  if (delta < 0) return "just now";
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) {
    const m = Math.floor(delta / MINUTE);
    return `${m} min ago`;
  }
  if (delta < DAY) {
    const h = Math.floor(delta / HOUR);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  if (delta < 30 * DAY) {
    const d = Math.floor(delta / DAY);
    return `${d} day${d === 1 ? "" : "s"} ago`;
  }
  return new Date(t).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Absolute date label, or "date unknown". */
export function formatSourceDate(iso: string | null | undefined): string {
  if (!iso) return "date unknown";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "date unknown";
  return new Date(t).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Rule-based freshness verdict: a source counts as stale when its
 * published_at is older than STALE_AFTER_DAYS. Sources with no published
 * date are NOT labeled stale — unknown is not old (D94).
 */
export function isSourceStale(publishedAt: string | null | undefined, nowMs = Date.now()): boolean {
  if (!publishedAt) return false;
  const t = new Date(publishedAt).getTime();
  if (!Number.isFinite(t)) return false;
  return nowMs - t > STALE_AFTER_DAYS * DAY;
}
