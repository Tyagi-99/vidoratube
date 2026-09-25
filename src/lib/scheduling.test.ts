import { describe, expect, it } from "vitest";
import {
  canHumanExecuteNow,
  isScheduledDue,
  msUntilDue,
  PUBLISH_PLATFORMS,
} from "./scheduling";

/**
 * Scheduling calendar + no-auto-publish tests (pure logic).
 *
 * The hard rule, mirrored from publish.functions.ts and the DB CHECK on
 * publish_jobs.status: a publish job reaches `scheduled` ONLY through the
 * human approval gate (approvePublishJob: draft -> approved/scheduled), and
 * leaves `scheduled` ONLY through an explicit human invocation of
 * executePublishJob (or cancelPublishJob). There is no background worker,
 * cron, or queue consumer that auto-executes due scheduled jobs.
 */

describe("isScheduledDue", () => {
  const now = new Date("2026-09-26T12:00:00Z");
  const past = new Date("2026-09-26T11:00:00Z").toISOString();
  const future = new Date("2026-09-26T13:00:00Z").toISOString();

  it("is due when the scheduled time has passed", () => {
    expect(isScheduledDue({ status: "scheduled", scheduled_for: past }, now)).toBe(true);
  });

  it("is not due before the scheduled time", () => {
    expect(isScheduledDue({ status: "scheduled", scheduled_for: future }, now)).toBe(false);
  });

  it("treats an approved job with no scheduled time as due immediately", () => {
    expect(isScheduledDue({ status: "approved", scheduled_for: null }, now)).toBe(true);
  });

  it("is never due for non-schedulable statuses", () => {
    for (const status of ["draft", "uploading", "published", "failed", "canceled"]) {
      expect(isScheduledDue({ status, scheduled_for: past }, now)).toBe(false);
    }
  });
});

describe("canHumanExecuteNow (no auto-publish rule)", () => {
  const now = new Date("2026-09-26T12:00:00Z");
  const past = new Date("2026-09-26T11:00:00Z").toISOString();
  const future = new Date("2026-09-26T13:00:00Z").toISOString();

  it("allows human execution of a due scheduled job", () => {
    expect(canHumanExecuteNow({ status: "scheduled", scheduled_for: past }, now)).toBe(true);
  });

  it("blocks execution of a scheduled job before its time", () => {
    expect(canHumanExecuteNow({ status: "scheduled", scheduled_for: future }, now)).toBe(false);
  });

  it("allows human execution of an approved (immediate) job", () => {
    expect(canHumanExecuteNow({ status: "approved", scheduled_for: null }, now)).toBe(true);
  });

  it("NEVER allows execution of a draft — approval gate required", () => {
    for (const scheduled_for of [null, past, future]) {
      expect(canHumanExecuteNow({ status: "draft", scheduled_for }, now)).toBe(false);
    }
  });

  it("NEVER allows execution of terminal/in-flight statuses", () => {
    for (const status of ["uploading", "published", "failed", "canceled"]) {
      expect(canHumanExecuteNow({ status, scheduled_for: past }, now)).toBe(false);
    }
  });
});

describe("msUntilDue", () => {
  const now = new Date("2026-09-26T12:00:00Z");

  it("returns 0 for approved jobs (publish now)", () => {
    expect(msUntilDue({ status: "approved", scheduled_for: null }, now)).toBe(0);
  });

  it("returns positive ms for a future scheduled job", () => {
    const ms = msUntilDue(
      { status: "scheduled", scheduled_for: new Date("2026-09-26T13:00:00Z").toISOString() },
      now,
    );
    expect(ms).toBe(3600000);
  });

  it("returns negative ms for an overdue scheduled job", () => {
    const ms = msUntilDue(
      { status: "scheduled", scheduled_for: new Date("2026-09-26T11:00:00Z").toISOString() },
      now,
    );
    expect(ms).toBe(-3600000);
  });

  it("returns null when there is no scheduled time", () => {
    expect(msUntilDue({ status: "scheduled", scheduled_for: null }, now)).toBeNull();
  });
});

describe("scheduling contract", () => {
  it("only YouTube is a publish platform today", () => {
    expect(PUBLISH_PLATFORMS).toEqual(["youtube"]);
  });
});
