import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { adminOverview } from "@/lib/admin.functions";
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

      <h2 className="mt-10 text-lg font-bold tracking-tight text-foreground">Latest renders</h2>
      <div className="mt-4 overflow-hidden rounded-2xl border border-border">
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
