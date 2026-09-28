/**
 * /admin/readiness — Production Readiness (Stream C, Phase 6).
 *
 * Admin-only page (shell gate via /_authenticated/admin + assertAdmin on the
 * server function). Runs the automated dependency checks from
 * src/lib/readiness.functions.ts and renders the fail-closed banner from
 * src/lib/readiness.ts.
 *
 * Rules honored here:
 * - Free metadata/config probes run by default; nothing spends credits.
 * - Paid probes (one tiny TTS synthesis, one test image) require the admin
 *   to deliberately check the opt-in box AND press the button. They are
 *   never part of an automatic run.
 * - The banner never says READY while any blocking check is not "pass";
 *   it says NOT READY and lists the failing blocking checks.
 * - UNCONFIGURED is honest: the probe could not run, not "fine".
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getReadinessReport } from "@/lib/readiness.functions";
import { computeReadinessBanner, readinessBannerCopy, type ReadinessStatus } from "@/lib/readiness";

export const Route = createFileRoute("/_authenticated/admin/readiness")({
  head: () => ({
    meta: [
      { title: "Production Readiness — Admin — Vidora AI" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminReadinessPage,
});

const STATUS_BADGE: Record<
  ReadinessStatus,
  { label: string; className: string; Icon: typeof CheckCircle2 }
> = {
  pass: {
    label: "PASS",
    className: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
    Icon: CheckCircle2,
  },
  fail: {
    label: "FAIL",
    className: "bg-destructive/12 text-destructive",
    Icon: XCircle,
  },
  unconfigured: {
    label: "UNCONFIGURED",
    className: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
    Icon: CircleDashed,
  },
};

function AdminReadinessPage() {
  const reportFn = useServerFn(getReadinessReport);
  const [paidOptIn, setPaidOptIn] = useState(false);
  const [runWithPaid, setRunWithPaid] = useState(false);

  const query = useQuery({
    queryKey: ["admin", "readiness", runWithPaid],
    queryFn: () => reportFn({ data: { includePaidProbes: runWithPaid } }),
  });

  const banner = query.data ? computeReadinessBanner(query.data) : null;
  const copy = banner ? readinessBannerCopy(banner) : null;

  const rerun = (withPaid: boolean) => {
    setRunWithPaid(withPaid);
    // queryKey change triggers the refetch; explicit call covers same-key re-runs.
    void query.refetch();
  };

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Production Readiness</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Automated dependency checks for a production deploy. Free probes only by default — nothing
        here spends provider credits unless you explicitly opt in below.
      </p>

      {/* Fail-closed banner: READY only when every blocking check passes. */}
      <div className="mt-6" aria-live="polite">
        {query.isLoading ? (
          <Skeleton className="h-24 w-full rounded-2xl" />
        ) : query.isError ? (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/8 p-5">
            <div className="flex items-center gap-2 font-semibold text-destructive">
              <ShieldAlert className="h-5 w-5" />
              Couldn&apos;t run the checks
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {(query.error as Error)?.message ?? "Something went wrong."}
            </p>
            <Button className="mt-4" size="sm" onClick={() => rerun(runWithPaid)}>
              <RefreshCw className="mr-2 h-4 w-4" /> Try again
            </Button>
          </div>
        ) : (
          banner &&
          copy && (
            <div
              className={
                banner.ready
                  ? "rounded-2xl border border-emerald-500/40 bg-emerald-500/8 p-5"
                  : "rounded-2xl border border-destructive/40 bg-destructive/8 p-5"
              }
            >
              <div
                className={
                  banner.ready
                    ? "flex items-center gap-2 text-lg font-bold text-emerald-600 dark:text-emerald-400"
                    : "flex items-center gap-2 text-lg font-bold text-destructive"
                }
              >
                {banner.ready ? (
                  <CheckCircle2 className="h-6 w-6" />
                ) : (
                  <AlertTriangle className="h-6 w-6" />
                )}
                {copy.title}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{copy.body}</p>
              {query.data?.at && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Checked at {new Date(query.data.at).toLocaleString()}
                  {query.data.paidProbesRan && " · paid probes ran (see PAID PROBE notes)"}
                </p>
              )}
            </div>
          )
        )}
      </div>

      {/* Controls */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          onClick={() => rerun(false)}
          disabled={query.isFetching}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Re-run checks (free)
        </Button>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={paidOptIn}
            onChange={(e) => setPaidOptIn(e.target.checked)}
          />
          Run paid probes too (spends real credits: one tiny TTS synthesis + one test image)
        </label>
        <Button
          size="sm"
          variant={paidOptIn ? "default" : "secondary"}
          disabled={!paidOptIn || query.isFetching}
          onClick={() => rerun(true)}
          title={
            paidOptIn
              ? "Runs the paid probes now — real provider spend"
              : "Check the box first to deliberately opt into paid probes"
          }
        >
          Run checks with paid probes
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Paid probes never run automatically — they require the checkbox above plus the button press.
        Estimated spend: TTS ≈ a few tenths of a cent, test image ≈ $0.03 via the Lovable AI
        gateway.
      </p>

      {/* Check cards */}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {query.isLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full rounded-2xl" />
            ))
          : (query.data?.checks ?? []).map((check) => {
              const badge = STATUS_BADGE[check.status];
              return (
                <section
                  key={check.id}
                  className="rounded-2xl border border-border bg-card p-5"
                  aria-label={`${check.label}: ${badge.label}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold text-foreground">{check.label}</h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {check.blocking ? "Blocking" : "Non-blocking"}
                      </p>
                    </div>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${badge.className}`}
                    >
                      <badge.Icon className="h-3.5 w-3.5" />
                      {badge.label}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">{check.detail}</p>
                  {check.status !== "pass" && (
                    <div className="mt-3 rounded-xl bg-muted/60 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Remediation
                      </p>
                      <p className="mt-1 text-sm text-foreground">{check.remediation}</p>
                    </div>
                  )}
                  {check.paidProbeNote && (
                    <p className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/8 p-3 text-sm text-amber-700 dark:text-amber-300">
                      {check.paidProbeNote}
                    </p>
                  )}
                </section>
              );
            })}
      </div>
    </div>
  );
}
