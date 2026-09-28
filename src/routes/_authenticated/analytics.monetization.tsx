import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getMonetizationSummary, setMonetizationSettings } from "@/lib/analytics/functions";
import { formatRevenue } from "@/lib/analytics/monetization";
import { formatCompact } from "@/lib/analytics/deltas";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/analytics/monetization")({
  component: MonetizationPage,
});

function MonetizationPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const fn = useServerFn(getMonetizationSummary);
  const saveFn = useServerFn(setMonetizationSettings);
  const { data, isLoading } = useQuery({ queryKey: ["analytics-monetization"], queryFn: () => fn({ data: {} }) });

  const [rpm, setRpm] = useState("");
  const [cpm, setCpm] = useState("");

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          rpmEstimateUsd: rpm.trim() === "" ? null : Number(rpm),
          cpmEstimateUsd: cpm.trim() === "" ? null : Number(cpm),
        },
      }),
    onSuccess: () => {
      toast.success(t("analytics_rpm_saved"));
      setRpm("");
      setCpm("");
      queryClient.invalidateQueries({ queryKey: ["analytics-monetization"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  return (
    <div>
      <p className="mb-6 max-w-3xl text-sm text-muted-foreground">{t("analytics_monetization_explainer")}</p>
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : !data?.hasData ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">{t("analytics_no_data")}</CardContent></Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">{t("analytics_total_views")}</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold">{formatCompact(data.totalViews)}</p></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">{t("analytics_measured_revenue")}</CardTitle></CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {data.measuredRevenueUsd > 0 ? formatRevenue(data.measuredRevenueUsd, "measured") : "—"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Only from snapshots with a measured revenue source.</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">{t("analytics_estimated_revenue")}</CardTitle></CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {data.estimatedRevenueUsd != null ? formatRevenue(data.estimatedRevenueUsd, "estimate") : "—"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {data.settings.rpmEstimateUsd != null ? `RPM $${data.settings.rpmEstimateUsd.toFixed(2)} (assumed)` : t("analytics_rpm_unset")}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader><CardTitle className="text-base">Revenue assumptions</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-sm">
                  <span className="mb-1 block text-muted-foreground">{t("analytics_rpm_label")}</span>
                  <Input
                    type="number" min="0" max="1000" step="0.1" className="w-40"
                    placeholder={data.settings.rpmEstimateUsd != null ? String(data.settings.rpmEstimateUsd) : "e.g. 4.00"}
                    value={rpm} onChange={(e) => setRpm(e.target.value)}
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-muted-foreground">{t("analytics_cpm_label")}</span>
                  <Input
                    type="number" min="0" max="1000" step="0.1" className="w-40"
                    placeholder={data.settings.cpmEstimateUsd != null ? String(data.settings.cpmEstimateUsd) : "e.g. 12.00"}
                    value={cpm} onChange={(e) => setCpm(e.target.value)}
                  />
                </label>
                <Button onClick={() => save.mutate()} disabled={save.isPending}>{t("analytics_save_rpm")}</Button>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">{t("analytics_no_earnings_guarantee")}</p>
            </CardContent>
          </Card>

          {data.videoEstimates.length > 0 && (
            <Card className="mt-6">
              <CardHeader><CardTitle className="text-base">Per-video</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">Video</th>
                        <th className="py-2 pr-4 text-right font-medium">{t("analytics_views")}</th>
                        <th className="py-2 text-right font-medium">{t("analytics_estimated_revenue")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.videoEstimates.slice(0, 20).map((v) => (
                        <tr key={v.youtubeVideoId} className="border-b last:border-0">
                          <td className="py-2 pr-4 font-medium">{v.title}</td>
                          <td className="py-2 pr-4 text-right">{formatCompact(v.views)}</td>
                          <td className="py-2 text-right">
                            {v.estimatedRevenueUsd != null ? (
                              <>{formatRevenue(v.estimatedRevenueUsd, "estimate")}</>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="mt-6">
            <CardHeader><CardTitle className="text-base">Snapshots</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                {data.rows.map((r) => (
                  <div key={r.snapshotDate} className="flex items-center justify-between border-b pb-2 last:border-0">
                    <span className="text-muted-foreground">{r.snapshotDate} · {formatCompact(r.views)} views</span>
                    <span className="flex items-center gap-2">
                      {formatRevenue(r.revenueUsd, r.label)}
                      {r.source === "fixture" && <Badge variant="destructive">DEMO DATA</Badge>}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
