import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { adminOverview, adminUnitEconomics, adminWorkerStatus } from "@/lib/admin.functions";
import { formatRelativeTime } from "@/lib/worker-health";
import { captureError, sentryEnabled, sentryTestError } from "@/lib/sentry";
import { analyticsEnabled } from "@/lib/analytics";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminOverviewPage,
});

function AdminOverviewPage() {
  const fn = useServerFn(adminOverview);
  const { data, isLoading } = useQuery({ queryKey: ["admin", "overview"], queryFn: () => fn({}) });

  const stats = [
    { label: "Users", value: data?.users },
    { label: "Renders", value: data?.jobs },
    { label: "Completed", value: data?.completed },
    { label: "Open messages", value: data?.openMessages },
    { label: "Active plans", value: data?.activePlans },
    { label: "Live integrations", value: data?.liveIntegrations },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Overview</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Everything happening across Vidora right now.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="surface-card p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {stat.label}
            </p>
            {isLoading ? (
              <Skeleton className="mt-3 h-8 w-16" />
            ) : (
              <p className="mt-2 text-3xl font-bold tracking-tight text-foreground">
                {stat.value ?? 0}
              </p>
            )}
          </div>
        ))}
      </div>

      <WorkerPanel />
      <UnitEconomicsPanel />

      <h2 className="mt-10 text-lg font-bold tracking-tight text-foreground">Latest renders</h2>      <div className="mt-4 overflow-hidden rounded-2xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-semibold">Title</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Created</th>
            </tr>
          </thead>
          <tbody>
            {(data?.recentJobs ?? []).map((job) => (
              <tr key={job.id} className="border-t border-border">
                <td className="max-w-[280px] truncate px-4 py-3 text-foreground">{job.title}</td>
                <td className="px-4 py-3 capitalize text-muted-foreground">{job.status}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(job.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
            {!isLoading && (data?.recentJobs ?? []).length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                  No renders yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <DiagnosticsSection />
    </div>
  );
}

/**
 * Render-worker health: heartbeat, worker id, and queue depth broken into
 * queued / running / stale. Lives on the overview dashboard (not the Renders
 * page) because it is infrastructure health, next to Diagnostics.
 */
function WorkerPanel() {
  const fn = useServerFn(adminWorkerStatus);
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "worker"],
    queryFn: () => fn({}),
    refetchInterval: 30_000,
  });

  const status = data?.status;
  const badge =
    status === "ok" ? (
      <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15">Operational</Badge>
    ) : status === "degraded" ? (
      <Badge className="bg-amber-500/15 text-amber-600 hover:bg-amber-500/15">Degraded</Badge>
    ) : (
      <Badge variant="destructive">Down</Badge>
    );

  return (
    <div className="mt-10">
      <h2 className="text-lg font-bold tracking-tight text-foreground">Render worker</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Heartbeat and queue depth for the native-FFmpeg server worker. Refreshes every 30 seconds.
      </p>
      <div className="surface-card mt-4 p-5">
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : !data ? (
          <p className="text-sm text-muted-foreground">Couldn&apos;t load worker status.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <div className="flex items-center gap-3">
              {badge}
              <div className="text-sm">
                <p className="font-medium text-foreground">
                  {data.lastSeenAt
                    ? `Last beat ${formatRelativeTime(data.lastSeenAt)}`
                    : "No heartbeat recorded yet"}
                </p>
                <p className="text-muted-foreground">
                  {data.workerId ? `Worker ${data.workerId}` : "The worker hasn't reported in"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-6 text-sm">
              <div>
                <p className="text-2xl font-bold text-foreground">{data.queued}</p>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">queued</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{data.running}</p>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">running</p>
              </div>
              <div>
                <p className={`text-2xl font-bold ${data.stale > 0 ? "text-amber-600" : "text-foreground"}`}>
                  {data.stale}
                </p>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">stale</p>
              </div>
            </div>
            {data.stale > 0 && (
              <p className="w-full text-sm text-amber-600">
                {data.stale} job{data.stale === 1 ? " has" : "s have"} been queued for over an hour
                or running for over two hours — check the worker logs.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Unit economics: measured provider cost per finished minute (overall and
 * per cost mode) plus per-plan gross margin vs measured cost per credit.
 * Every number comes from recorded data (api_usage, renders,
 * credit_ledger) — when there is no real data yet, the honest empty state
 * shows instead of zeros dressed up as measurements.
 */
function UnitEconomicsPanel() {
  const fn = useServerFn(adminUnitEconomics);
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "unit-economics"],
    queryFn: () => fn({}),
  });

  const money = (n: number | null, digits = 4) =>
    n == null ? "—" : `$${n.toFixed(digits)}`;

  return (
    <div className="mt-10">
      <h2 className="text-lg font-bold tracking-tight text-foreground">Unit economics</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Measured provider cost per finished minute and per-plan gross margin. Costs in USD.
      </p>
      <div className="surface-card mt-4 p-5">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !data ? (
          <p className="text-sm text-muted-foreground">Couldn&apos;t load unit economics.</p>
        ) : !data.hasData ? (
          <p className="text-sm text-muted-foreground">
            No measured data yet — costs are recorded from{" "}
            {data.costsSince ? new Date(data.costsSince).toLocaleDateString() : "the day cost tracking started"}.
            Per-minute costs and plan margins will appear here once renders complete.
          </p>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Cost / finished minute
                </p>
                <p className="mt-1 text-2xl font-bold text-foreground">
                  {money(data.costPerMinuteUsd)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {data.totalFinishedMinutes} finished min · ${data.totalCostUsd.toFixed(2)} total
                  provider cost
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Cost / credit charged
                </p>
                <p className="mt-1 text-2xl font-bold text-foreground">
                  {money(data.costPerCreditUsd)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {data.renderCreditsCharged} credits charged for renders
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Cost by provider
                </p>
                <div className="mt-1 space-y-1">
                  {Object.entries(data.costByProvider)
                    .sort((a, b) => b[1] - a[1])
                    .map(([provider, cost]) => (
                      <p key={provider} className="text-sm text-foreground">
                        {provider} <span className="text-muted-foreground">${cost.toFixed(2)}</span>
                      </p>
                    ))}
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Finished minutes by mode
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {Object.entries(data.minutesByMode).map(([mode, mins]) => (
                  <span
                    key={mode}
                    className="rounded-full border border-border px-3 py-1 text-sm text-foreground"
                  >
                    {mode}: {mins} min
                  </span>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Per-plan gross margin
              </p>
              <div className="mt-2 overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-semibold">Plan</th>
                      <th className="px-4 py-2 font-semibold">Price</th>
                      <th className="px-4 py-2 font-semibold">Credits</th>
                      <th className="px-4 py-2 font-semibold">Revenue / credit</th>
                      <th className="px-4 py-2 font-semibold">Gross margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.plans.map((p) => (
                      <tr key={p.slug} className="border-t border-border">
                        <td className="px-4 py-2 font-medium text-foreground">{p.name}</td>
                        <td className="px-4 py-2 text-muted-foreground">${p.priceUsd.toFixed(2)}</td>
                        <td className="px-4 py-2 text-muted-foreground">{p.credits}</td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {p.revenuePerCredit != null ? `$${p.revenuePerCredit.toFixed(3)}` : "—"}
                        </td>
                        <td
                          className={`px-4 py-2 font-medium ${
                            p.grossMargin == null
                              ? "text-muted-foreground"
                              : p.grossMargin >= 0
                                ? "text-emerald-600"
                                : "text-destructive"
                          }`}
                        >
                          {p.grossMargin == null ? "—" : `${(p.grossMargin * 100).toFixed(1)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Margin = (revenue per credit − measured cost per credit) ÷ revenue per credit,
                using USD plan prices. Costs recorded from{" "}
                {data.costsSince ? new Date(data.costsSince).toLocaleDateString() : "—"} across{" "}
                {data.usageCalls} provider calls.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Observability health + Sentry test button. Everything here degrades
 * gracefully: without DSNs/keys it reports "not configured" instead of failing.
 */
function DiagnosticsSection() {
  const [sent, setSent] = useState(false);

  const sendTestError = () => {
    captureError(sentryTestError(), { extra: { where: "admin_diagnostics" } });
    setSent(true);
  };

  const rows = [
    {
      name: "Sentry (client)",
      status: sentryEnabled() ? "active" : "not configured",
      hint: sentryEnabled()
        ? "Errors are being reported."
        : "Set VITE_SENTRY_DSN to enable browser error tracking.",
    },
    {
      name: "PostHog",
      status: analyticsEnabled() ? "active" : "not configured",
      hint: analyticsEnabled()
        ? "Product events are being captured."
        : "Set VITE_POSTHOG_KEY to enable product analytics.",
    },
  ];

  return (
    <div className="mt-10">
      <h2 className="text-lg font-bold tracking-tight text-foreground">Diagnostics</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Observability status. Server-side Sentry needs SENTRY_DSN_SERVER in the server environment.
      </p>
      <div className="mt-4 overflow-hidden rounded-2xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-semibold">Service</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} className="border-t border-border">
                <td className="px-4 py-3 font-medium text-foreground">{row.name}</td>
                <td className="px-4 py-3">
                  <span
                    className={
                      row.status === "active" ? "text-emerald-500" : "text-muted-foreground"
                    }
                  >
                    {row.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{row.hint}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={sendTestError} disabled={!sentryEnabled()}>
          Send Sentry test error
        </Button>
        {sent && (
          <p className="text-sm text-muted-foreground">
            Test error sent — check your Sentry project&apos;s Issues.
          </p>
        )}
        {!sentryEnabled() && (
          <p className="text-sm text-muted-foreground">
            The button enables once VITE_SENTRY_DSN is set.
          </p>
        )}
      </div>
    </div>
  );
}
