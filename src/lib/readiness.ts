/**
 * Production-readiness check model (Stream C, Phase 6).
 *
 * Pure, UI-free logic behind the /admin/readiness page. Statuses are
 * deliberately tri-state:
 *   - "pass":         the check ran and the dependency is healthy
 *   - "fail":         the check ran and the dependency is broken
 *   - "unconfigured": the dependency's key/secret/deploy is missing
 *
 * UNCONFIGURED is honest: it never means "tested and fine", it means the
 * probe could not run. The overall banner rule lives in
 * `computeReadinessBanner`: READY is reported ONLY when every blocking
 * check passes. Paid (credit-spending) probes are never part of the default
 * run — they require the admin to opt in explicitly on the page.
 */

export type ReadinessStatus = "pass" | "fail" | "unconfigured";

export type ReadinessCheck = {
  /** Stable id, e.g. "ai-text". */
  id: string;
  /** Human label, e.g. "AI text provider". */
  label: string;
  /** A blocking check failing/unconfigured keeps the banner NOT READY. */
  blocking: boolean;
  status: ReadinessStatus;
  /** What the check observed (free metadata only unless a paid probe ran). */
  detail: string;
  /** Exact remediation: which key/secret/deploy is missing and where to set it. */
  remediation: string;
  /** Shown when a paid probe ran for this check. */
  paidProbeNote?: string | undefined;
};

export type ReadinessReport = {
  checks: ReadinessCheck[];
  /** True only when the admin explicitly opted into paid probes for this run. */
  paidProbesRan: boolean;
  at: string;
};

export type ReadinessBanner = {
  /** NEVER true while any blocking check is not "pass". */
  ready: boolean;
  /** Labels of blocking checks that are failing or unconfigured. */
  failingBlocking: string[];
  /** Labels of non-blocking checks that are failing or unconfigured. */
  warnings: string[];
};

/** Overall banner rule: fail-closed on every blocking check. */
export function computeReadinessBanner(report: ReadinessReport): ReadinessBanner {
  const failingBlocking: string[] = [];
  const warnings: string[] = [];
  for (const check of report.checks) {
    if (check.status !== "pass") {
      if (check.blocking) failingBlocking.push(check.label);
      else warnings.push(check.label);
    }
  }
  return { ready: failingBlocking.length === 0, failingBlocking, warnings };
}

/** Banner headline copy — the page must never render READY while failingBlocking is non-empty. */
export function readinessBannerCopy(banner: ReadinessBanner): { title: string; body: string } {
  if (banner.ready) {
    return {
      title: "READY",
      body:
        banner.warnings.length > 0
          ? `All blocking checks pass. ${banner.warnings.length} non-blocking check(s) need attention: ${banner.warnings.join(", ")}.`
          : "All blocking checks pass.",
    };
  }
  return {
    title: "NOT READY",
    body: `Blocking checks not passing: ${banner.failingBlocking.join(", ")}.`,
  };
}

function check(
  id: string,
  label: string,
  blocking: boolean,
  status: ReadinessStatus,
  detail: string,
  remediation: string,
  paidProbeNote?: string,
): ReadinessCheck {
  return { id, label, blocking, status, detail, remediation, paidProbeNote };
}

/** UNCONFIGURED factory — used when the key/secret/deploy is missing. */
export function unconfigured(
  id: string,
  label: string,
  blocking: boolean,
  missing: string,
  remediation: string,
): ReadinessCheck {
  return check(
    id,
    label,
    blocking,
    "unconfigured",
    `${missing} is not set — probe not run.`,
    remediation,
  );
}

/** PASS factory. */
export function passed(
  id: string,
  label: string,
  blocking: boolean,
  detail: string,
  remediation: string,
  paidProbeNote?: string,
): ReadinessCheck {
  return check(id, label, blocking, "pass", detail, remediation, paidProbeNote);
}

/** FAIL factory. */
export function failed(
  id: string,
  label: string,
  blocking: boolean,
  detail: string,
  remediation: string,
  paidProbeNote?: string,
): ReadinessCheck {
  return check(id, label, blocking, "fail", detail, remediation, paidProbeNote);
}
