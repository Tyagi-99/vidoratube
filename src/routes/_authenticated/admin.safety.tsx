import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, AlertTriangle } from "lucide-react";
import { adminSafetyRules } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/safety")({
  component: AdminSafetyPage,
});

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function AdminSafetyPage() {
  const listFn = useServerFn(adminSafetyRules);
  const rules = useQuery({ queryKey: ["admin", "safety-rules"], queryFn: () => listFn({}) });

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Safety rules</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        The versioned rules behind the monetization safety score. Scoring reads the
        active rule version from data — nothing is hardcoded. Rules should be
        reviewed quarterly; overdue reviews are flagged.
      </p>

      <div className="mt-4 flex flex-wrap gap-3" aria-live="polite">
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-2.5">
          <div className="text-xl font-bold tabular-nums text-foreground">
            {rules.isLoading ? "—" : `v${rules.data?.activeVersion ?? "?"}`}
          </div>
          <div className="text-xs text-muted-foreground">Active rule version</div>
        </div>
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-2.5">
          <div className="text-xl font-bold tabular-nums text-foreground">
            {rules.isLoading ? "—" : (rules.data?.rules.length ?? 0)}
          </div>
          <div className="text-xs text-muted-foreground">Rules</div>
        </div>
        <div
          className={`rounded-xl border px-4 py-2.5 ${
            (rules.data?.overdueCount ?? 0) > 0
              ? "border-red-300 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20"
              : "border-border bg-muted/40"
          }`}
        >
          <div className="flex items-center gap-2 text-xl font-bold tabular-nums text-foreground">
            {(rules.data?.overdueCount ?? 0) > 0 && (
              <AlertTriangle className="h-5 w-5 text-red-600" />
            )}
            {rules.isLoading ? "—" : (rules.data?.overdueCount ?? 0)}
          </div>
          <div className="text-xs text-muted-foreground">Reviews overdue (90+ days)</div>
        </div>
      </div>

      {rules.isLoading ? (
        <Skeleton className="mt-6 h-64 w-full rounded-2xl" />
      ) : rules.isError ? (
        <p className="mt-6 text-sm text-destructive">
          {(rules.error as Error)?.message ?? "Couldn't load safety rules."}
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-semibold">Rule</th>
                <th className="px-4 py-3 font-semibold">Description</th>
                <th className="px-4 py-3 font-semibold">Params</th>
                <th className="px-4 py-3 font-semibold">Version</th>
                <th className="px-4 py-3 font-semibold">Last reviewed</th>
              </tr>
            </thead>
            <tbody>
              {(rules.data?.rules ?? []).map((rule) => (
                <tr key={`${rule.version}:${rule.ruleKey}`} className="border-t border-border">
                  <td className="px-4 py-3 font-mono text-xs text-foreground">{rule.ruleKey}</td>
                  <td className="max-w-[320px] px-4 py-3 text-muted-foreground">{rule.description}</td>
                  <td className="max-w-[220px] truncate px-4 py-3 font-mono text-xs text-muted-foreground">
                    {JSON.stringify(rule.params)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <Badge variant={rule.active ? "default" : "outline"}>v{rule.version}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      {rule.reviewOverdue && rule.active ? (
                        <ShieldCheck className="h-4 w-4 text-red-600" />
                      ) : null}
                      {formatDate(rule.lastReviewedAt)}
                      {rule.reviewOverdue && rule.active && (
                        <Badge variant="destructive" className="ml-1">
                          Overdue
                        </Badge>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
              {(rules.data?.rules ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    No safety rules found. Run the Sprint 7-8 migration to seed v1.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
