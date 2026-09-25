import { describe, expect, it, vi } from "vitest";

// PostHog must never be initialized in tests (no key set), so importing the
// module must be side-effect free and every call must be a safe no-op.
vi.mock("posthog-js", () => ({
  default: {
    init: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn(),
  },
}));

import posthog from "posthog-js";
import { track, identifyUser, analyticsEnabled } from "./analytics";

describe("analytics", () => {
  it("is disabled without VITE_POSTHOG_KEY", () => {
    expect(analyticsEnabled()).toBe(false);
  });

  it("track() is a no-op without a key and never throws", () => {
    expect(() =>
      track("render_started", { job_id: "job-1", mode: "script" }),
    ).not.toThrow();
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("identifyUser() is a no-op without a key and never throws", () => {
    expect(() => identifyUser("user-1")).not.toThrow();
    expect(posthog.identify).not.toHaveBeenCalled();
  });

  it("accepts every catalogue event without throwing", () => {
    expect(() => {
      track("signup_started");
      track("signup_completed", { method: "email" });
      track("render_succeeded", { job_id: "j", mode: "script" });
      track("render_failed", { job_id: "j", mode: "script", error_code: "boom" });
      track("download_clicked", { job_id: "j" });
      track("publish_started", { job_id: "j" });
      track("publish_succeeded", { job_id: "j" });
      track("publish_failed", { job_id: "j" });
      track("checkout_started");
    }).not.toThrow();
  });
});
