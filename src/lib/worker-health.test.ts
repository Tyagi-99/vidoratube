import { describe, expect, it } from "vitest";
import {
  HEARTBEAT_DEGRADED_MS,
  HEARTBEAT_OK_MS,
  formatRelativeTime,
  workerHealthStatus,
} from "./worker-health";

const NOW = new Date("2026-09-25T12:00:00.000Z").getTime();
const iso = (ms: number) => new Date(ms).toISOString();

describe("workerHealthStatus", () => {
  it("is ok when the beat is fresher than 15 minutes", () => {
    expect(workerHealthStatus(iso(NOW - 60_000), NOW)).toBe("ok");
    expect(workerHealthStatus(iso(NOW - (HEARTBEAT_OK_MS - 1000)), NOW)).toBe("ok");
  });

  it("is degraded between 15 and 60 minutes", () => {
    expect(workerHealthStatus(iso(NOW - HEARTBEAT_OK_MS), NOW)).toBe("degraded");
    expect(workerHealthStatus(iso(NOW - (HEARTBEAT_DEGRADED_MS - 1000)), NOW)).toBe("degraded");
  });

  it("is down past 60 minutes", () => {
    expect(workerHealthStatus(iso(NOW - HEARTBEAT_DEGRADED_MS), NOW)).toBe("down");
    expect(workerHealthStatus(iso(NOW - 24 * 3600_000), NOW)).toBe("down");
  });

  it("is down when there is no heartbeat", () => {
    expect(workerHealthStatus(null, NOW)).toBe("down");
    expect(workerHealthStatus(undefined, NOW)).toBe("down");
    expect(workerHealthStatus("not-a-date", NOW)).toBe("down");
  });

  it("treats a future heartbeat (clock skew) as ok", () => {
    expect(workerHealthStatus(iso(NOW + 60_000), NOW)).toBe("ok");
  });
});

describe("formatRelativeTime", () => {
  it("formats sub-minute as just now", () => {
    expect(formatRelativeTime(iso(NOW - 30_000), NOW)).toBe("just now");
  });

  it("formats minutes", () => {
    expect(formatRelativeTime(iso(NOW - 3 * 60_000), NOW)).toBe("3 min ago");
    expect(formatRelativeTime(iso(NOW - 59 * 60_000), NOW)).toBe("59 min ago");
  });

  it("formats hours and days", () => {
    expect(formatRelativeTime(iso(NOW - 2 * 3600_000), NOW)).toBe("2 h ago");
    expect(formatRelativeTime(iso(NOW - 5 * 24 * 3600_000), NOW)).toBe("5 d ago");
  });

  it("returns unknown for unparseable input", () => {
    expect(formatRelativeTime("nope", NOW)).toBe("unknown");
  });
});
