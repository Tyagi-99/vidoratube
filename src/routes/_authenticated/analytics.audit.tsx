import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getChannelAudit } from "@/lib/analytics/functions";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/analytics/audit")({
  component: AuditPage,
});

const SEVERITY_VARIANT = { info: "secondary", watch: "outline", action: "destructive" } as const;

function AuditPage() {
  const { t } = useI18n();
  const fn = useServerFn(getChannelAudit);
  const { data, isLoading } = useQuery({ queryKey: ["analytics-audit"], queryFn: () => fn({ data: {} }) });

  return (
    <div>
      <p className="mb-6 max-w-3xl text-sm text-muted-foreground">{t("analytics_audit_explainer")}</p>
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : !data || (data.videoCount === 0 && data.snapshotCount === 0) ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">{t("analytics_audit_no_data")}</CardContent></Card>
      ) : data.findings.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">{t("analytics_audit_no_findings")}</CardContent></Card>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Audited {data.videoCount} videos + {data.snapshotCount} channel snapshots
            {data.channelName ? ` (${data.channelName})` : ""} · {new Date(data.generatedAt).toLocaleString()}
          </p>
          {data.findings.map((f, i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center gap-2">
                <Badge variant={SEVERITY_VARIANT[f.severity]}>{f.severity}</Badge>
                <CardTitle className="text-base">{f.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">{f.detail}</p>
                <details>
                  <summary className="cursor-pointer text-xs font-medium">{t("analytics_audit_evidence")} ({f.evidence.length})</summary>
                  <ul className="mt-2 space-y-1 pl-4 text-xs text-muted-foreground">
                    {f.evidence.map((e, j) => (
                      <li key={j} className="list-disc">
                        <span className="font-mono">{e.kind}:{e.ref}</span> — {e.detail}
                      </li>
                    ))}
                  </ul>
                </details>
                {f.guidance && (
                  <p className={`rounded-lg border p-3 text-xs ${f.guidanceKind === "ai_analysis" ? "border-dashed" : ""}`}>
                    {f.guidance}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
