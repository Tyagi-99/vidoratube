import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getRoiReport } from "@/lib/analytics/functions";
import { formatRevenue } from "@/lib/analytics/monetization";
import { formatCompact } from "@/lib/analytics/deltas";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/analytics/roi")({
  component: RoiPage,
});

function RoiPage() {
  const { t } = useI18n();
  const fn = useServerFn(getRoiReport);
  const { data, isLoading } = useQuery({ queryKey: ["analytics-roi"], queryFn: () => fn({ data: {} }) });

  return (
    <div>
      <p className="mb-6 max-w-3xl text-sm text-muted-foreground">{t("analytics_roi_explainer")}</p>
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : !data?.hasData ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">{t("analytics_no_roi")}</CardContent></Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">{t("analytics_cost_credits")}</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold">{formatCompact(data.totals.credits)}</p></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">{t("analytics_cost_usd")}</CardTitle></CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  ${data.totals.usdAtPlanRates.find((r) => r.planSlug === "studio")?.usd.toFixed(2) ?? "—"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">at Studio plan rates</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">{t("analytics_total_views")}</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold">{formatCompact(data.totals.views)}</p></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">{t("analytics_estimated_revenue")}</CardTitle></CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {data.totals.revenueEstimateUsd != null ? formatRevenue(data.totals.revenueEstimateUsd, "estimate") : "—"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {data.rpmEstimateUsd != null ? `RPM $${data.rpmEstimateUsd.toFixed(2)} assumed` : t("analytics_rpm_unset")}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader><CardTitle className="text-base">{t("analytics_plan_rates_note")}</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {data.totals.usdAtPlanRates.map((r) => (
                  <Badge key={r.planSlug} variant="secondary">
                    {r.planName}: ${r.usd.toFixed(2)}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader><CardTitle className="text-base">Per-video</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Video</th>
                      <th className="py-2 pr-4 text-right font-medium">{t("analytics_cost_credits")}</th>
                      <th className="py-2 pr-4 text-right font-medium">{t("analytics_cost_usd")}*</th>
                      <th className="py-2 pr-4 text-right font-medium">{t("analytics_views")}</th>
                      <th className="py-2 pr-4 text-right font-medium">{t("analytics_estimated_revenue")}</th>
                      <th className="py-2 text-right font-medium">{t("analytics_roi_multiple")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.videos.map((v, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-medium">{v.title}</td>
                        <td className="py-2 pr-4 text-right">{v.credits.toFixed(1)}</td>
                        <td className="py-2 pr-4 text-right">
                          ${v.usdAtPlanRates.find((r) => r.planSlug === "studio")?.usd.toFixed(2) ?? "—"}
                        </td>
                        <td className="py-2 pr-4 text-right">{formatCompact(v.views)}</td>
                        <td className="py-2 pr-4 text-right">
                          {v.revenueEstimateUsd != null ? formatRevenue(v.revenueEstimateUsd, "estimate") : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="py-2 text-right">
                          {v.roiMultipleEstimate != null ? `${v.roiMultipleEstimate.toFixed(1)}x` : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">* USD at Studio plan rates. ROI multiples are estimate-based.</p>
            </CardContent>
          </Card>

          {data.unattributed.entries > 0 && (
            <Card className="mt-6 border-dashed">
              <CardHeader><CardTitle className="text-base">{t("analytics_unattributed_cost")}</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm">
                  {formatCompact(data.unattributed.credits)} credits across {data.unattributed.entries} ledger rows.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{t("analytics_unattributed_explainer")}</p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
