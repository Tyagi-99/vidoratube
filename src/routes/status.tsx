import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, CheckCircle2, AlertTriangle, XCircle, MinusCircle, Loader2 } from "lucide-react";
import { getSystemStatus, type CheckStatus } from "@/lib/status.functions";

export const Route = createFileRoute("/status")({
  head: () => ({
    meta: [
      { title: "System status — Vidora AI" },
      { name: "description", content: "Live status of Vidora AI's services." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: StatusPage,
});

const statusMeta: Record<CheckStatus, { icon: typeof CheckCircle2; label: string; className: string }> = {
  ok: { icon: CheckCircle2, label: "Operational", className: "text-emerald-500" },
  degraded: { icon: AlertTriangle, label: "Degraded", className: "text-amber-500" },
  down: { icon: XCircle, label: "Down", className: "text-destructive" },
  not_configured: { icon: MinusCircle, label: "Not configured", className: "text-muted-foreground" },
};

function StatusPage() {
  const fn = useServerFn(getSystemStatus);
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["system-status"],
    queryFn: () => fn({}),
    refetchInterval: 60_000,
  });

  const allOk = data?.checks.every((c) => c.status === "ok" || c.status === "not_configured");

  return (
    <main className="min-h-screen bg-background px-4 py-16 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
              System status
            </h1>
            <p className="text-sm text-muted-foreground">
              {data ? (
                <>
                  {allOk ? "All systems operational" : "Some services need attention"} · checked{" "}
                  {new Date(data.at).toLocaleTimeString()}
                </>
              ) : (
                "Checking services…"
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="ml-auto inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Refresh
          </button>
        </div>

        {isLoading ? (
          <div className="mt-8 space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-muted/60" />
            ))}
          </div>
        ) : isError ? (
          <div className="mt-8 rounded-xl border border-destructive/30 bg-destructive/5 p-6">
            <p className="font-semibold text-foreground">Couldn&apos;t load the status</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The status check itself failed. Try refreshing.
            </p>
          </div>
        ) : (
          <div className="mt-8 space-y-3">
            {(data?.checks ?? []).map((check) => {
              const meta = statusMeta[check.status];
              const Icon = meta.icon;
              return (
                <div
                  key={check.name}
                  className="flex items-center gap-4 rounded-xl border border-border bg-card p-5"
                >
                  <Icon className={`h-6 w-6 shrink-0 ${meta.className}`} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground">{check.name}</p>
                    <p className="truncate text-sm text-muted-foreground">{check.detail}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-semibold ${meta.className}`}>{meta.label}</p>
                    {check.latencyMs !== null && (
                      <p className="text-xs text-muted-foreground">{check.latencyMs} ms</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Vidora AI status · auto-refreshes every minute
        </p>
      </div>
    </main>
  );
}
