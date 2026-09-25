/**
 * Worker-liveness helpers (pure, tested).
 *
 * One set of thresholds shared by every surface that reports on the
 * native-FFmpeg server worker:
 *   - the public /status page (getSystemStatus "Render worker" check)
 *   - the admin worker panel (adminWorkerStatus)
 *   - the RenderPanel engine fallback (getServerWorkerStatus uses the same
 *     15-minute online window so "server selected + worker offline" falls
 *     back to the browser engine consistently everywhere)
 */

/** Heartbeat fresher than this → worker "ok". */
export const HEARTBEAT_OK_MS = 15 * 60 * 1000;
/** Heartbeat older than OK but fresher than this → "degraded". */
export const HEARTBEAT_DEGRADED_MS = 60 * 60 * 1000;

/** A queued server render older than this counts as "stale" in the admin panel. */
export const STALE_QUEUED_MS = 60 * 60 * 1000;
/** A running server render older than this counts as "stale" in the admin panel. */
export const STALE_RUNNING_MS = 2 * 60 * 60 * 1000;

export type WorkerHealth = "ok" | "degraded" | "down";

/**
 * Classify worker liveness from its last heartbeat timestamp.
 * No heartbeat (or an unparseable one) → "down". A heartbeat from the
 * future (clock skew between worker and app) still means the worker is
 * alive → "ok".
 */
export function workerHealthStatus(
  lastSeenAt: string | null | undefined,
  nowMs: number = Date.now(),
): WorkerHealth {
  if (lastSeenAt == null) return "down";
  const seen = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(seen)) return "down";
  const ageMs = nowMs - seen;
  if (ageMs < HEARTBEAT_OK_MS) return "ok";
  if (ageMs < HEARTBEAT_DEGRADED_MS) return "degraded";
  return "down";
}

/** Short relative time for heartbeats: "just now" | "3 min ago" | "2 h ago" | "5 d ago". */
export function formatRelativeTime(iso: string, nowMs: number = Date.now()): string {
  const seen = new Date(iso).getTime();
  if (!Number.isFinite(seen)) return "unknown";
  const ageMs = Math.max(0, nowMs - seen);
  const mins = Math.floor(ageMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
