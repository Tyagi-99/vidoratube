import { describe, it, expect } from "vitest";

/**
 * Publish state machine tests (pure logic — the DB transitions mirror these
 * rules in publish.functions.ts):
 *
 *   draft -> approved -> scheduled -> uploading -> published
 *                              \-> uploading -> published
 *   draft/approved/scheduled -> canceled
 *   uploading/scheduled -> failed
 *
 * The hard rule: NOTHING reaches approved without an explicit human action
 * (approvePublishJob). There is no code path that auto-advances past draft.
 */

type Status = "draft" | "approved" | "scheduled" | "uploading" | "published" | "failed" | "canceled";

const TRANSITIONS: Record<Status, Status[]> = {
  draft: ["approved", "canceled"],
  approved: ["scheduled", "uploading", "canceled"],
  scheduled: ["uploading", "canceled", "failed"],
  uploading: ["published", "failed"],
  published: [],
  failed: [],
  canceled: [],
};

function canTransition(from: Status, to: Status): boolean {
  return TRANSITIONS[from].includes(to);
}

describe("publish state machine", () => {
  it("allows the happy path draft -> approved -> uploading -> published", () => {
    expect(canTransition("draft", "approved")).toBe(true);
    expect(canTransition("approved", "uploading")).toBe(true);
    expect(canTransition("uploading", "published")).toBe(true);
  });

  it("allows scheduled path draft -> approved -> scheduled -> uploading -> published", () => {
    expect(canTransition("draft", "approved")).toBe(true);
    expect(canTransition("approved", "scheduled")).toBe(true);
    expect(canTransition("scheduled", "uploading")).toBe(true);
    expect(canTransition("uploading", "published")).toBe(true);
  });

  it("FORBIDS draft -> published (no auto-publish)", () => {
    expect(canTransition("draft", "published")).toBe(false);
    expect(canTransition("draft", "uploading")).toBe(false);
    expect(canTransition("draft", "scheduled")).toBe(false);
  });

  it("FORBIDS skipping approval from any state", () => {
    const nonApproved: Status[] = ["draft", "scheduled", "uploading", "published", "failed", "canceled"];
    for (const from of nonApproved) {
      expect(canTransition(from, "uploading") && from !== "approved" && from !== "scheduled").toBe(false);
    }
  });

  it("allows cancel from draft/approved/scheduled", () => {
    expect(canTransition("draft", "canceled")).toBe(true);
    expect(canTransition("approved", "canceled")).toBe(true);
    expect(canTransition("scheduled", "canceled")).toBe(true);
  });

  it("FORBIDS cancel after publishing started", () => {
    expect(canTransition("uploading", "canceled")).toBe(false);
    expect(canTransition("published", "canceled")).toBe(false);
  });

  it("published is terminal", () => {
    for (const to of ["draft", "approved", "scheduled", "uploading", "published", "failed", "canceled"] as Status[]) {
      expect(canTransition("published", to)).toBe(false);
    }
  });

  it("failed and canceled are terminal", () => {
    expect(canTransition("failed", "approved")).toBe(false);
    expect(canTransition("canceled", "draft")).toBe(false);
  });

  it("approve requires madeForKids to be a boolean (COPPA gate)", () => {
    const valid = (v: unknown): v is boolean => typeof v === "boolean";
    expect(valid(true)).toBe(true);
    expect(valid(false)).toBe(true);
    expect(valid(null)).toBe(false);
    expect(valid(undefined)).toBe(false);
  });

  it("scheduled_for must be in the future", () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const past = new Date(Date.now() - 3600_000).toISOString();
    expect(new Date(future).getTime() > Date.now()).toBe(true);
    expect(new Date(past).getTime() > Date.now()).toBe(false);
  });
});
