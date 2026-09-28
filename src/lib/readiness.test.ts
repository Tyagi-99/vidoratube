/**
 * Unit tests for the /admin/readiness banner rule (Stream C, Phase 6).
 *
 * The core invariant: the banner NEVER reports READY while any blocking
 * check is not "pass". UNCONFIGURED is honest — it means the probe could
 * not run, never "tested and fine".
 */
import { describe, expect, it } from "vitest";
import {
  computeReadinessBanner,
  failed,
  passed,
  readinessBannerCopy,
  unconfigured,
  type ReadinessCheck,
  type ReadinessReport,
} from "./readiness";

function report(checks: ReadinessCheck[]): ReadinessReport {
  return { checks, paidProbesRan: false, at: new Date().toISOString() };
}

const OK_BLOCKING: ReadinessCheck = passed("db", "Database", true, "reachable", "fix db");
const OK_NONBLOCKING: ReadinessCheck = passed("yt", "YouTube OAuth", false, "configured", "fix yt");

describe("readiness banner rule", () => {
  it("reports READY only when every blocking check passes", () => {
    const banner = computeReadinessBanner(report([OK_BLOCKING, OK_NONBLOCKING]));
    expect(banner.ready).toBe(true);
    expect(banner.failingBlocking).toHaveLength(0);
    expect(readinessBannerCopy(banner).title).toBe("READY");
  });

  it("reports NOT READY with the failing list when a blocking check is UNCONFIGURED", () => {
    const banner = computeReadinessBanner(
      report([
        unconfigured("tts", "TTS (narration)", true, "ELEVENLABS_API_KEY", "set the key"),
        OK_NONBLOCKING,
      ]),
    );
    expect(banner.ready).toBe(false);
    expect(banner.failingBlocking).toEqual(["TTS (narration)"]);
    const copy = readinessBannerCopy(banner);
    expect(copy.title).toBe("NOT READY");
    expect(copy.body).toContain("TTS (narration)");
    expect(copy.title).not.toBe("READY");
  });

  it("reports NOT READY when a blocking check FAILS", () => {
    const banner = computeReadinessBanner(
      report([failed("db", "Database", true, "connection refused", "fix db"), OK_NONBLOCKING]),
    );
    expect(banner.ready).toBe(false);
    expect(banner.failingBlocking).toEqual(["Database"]);
  });

  it("lists every failing blocking check, not just the first", () => {
    const banner = computeReadinessBanner(
      report([
        failed("db", "Database", true, "down", "fix"),
        unconfigured("billing", "Billing", true, "DODO_API_KEY", "fix"),
        OK_NONBLOCKING,
      ]),
    );
    expect(banner.ready).toBe(false);
    expect(banner.failingBlocking).toEqual(["Database", "Billing"]);
  });

  it("non-blocking failures warn but do not block READY", () => {
    const banner = computeReadinessBanner(
      report([
        OK_BLOCKING,
        unconfigured("yt", "YouTube OAuth", false, "GOOGLE_OAUTH_CLIENT_ID", "fix"),
      ]),
    );
    expect(banner.ready).toBe(true);
    expect(banner.warnings).toEqual(["YouTube OAuth"]);
    const copy = readinessBannerCopy(banner);
    expect(copy.title).toBe("READY");
    expect(copy.body).toContain("YouTube OAuth");
  });

  it("UNCONFIGURED is never presented as healthy", () => {
    const c = unconfigured("x", "X", true, "SOME_KEY", "set it");
    expect(c.status).toBe("unconfigured");
    expect(c.detail).toContain("not set");
    expect(c.detail).toContain("probe not run");
  });
});
