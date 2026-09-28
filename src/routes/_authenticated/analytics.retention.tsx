import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getRetentionDiagnoses } from "@/lib/analytics/functions";
import { sourceLabel } from "@/lib/analytics/types";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/analytics/retention")({
  component: RetentionPage,
});

function RetentionPage() {
  const { t } = useI18n();
  const fn = useServerFn(getRetentionDiagnoses);
  const { data, isLoading } = useQuery({ queryKey: ["analytics-retention"], queryFn: () => fn({ data: {} }) });

  return (
    <div>
      <p className="mb-6 max-w-3xl text-sm text-muted-foreground">{t("analytics_retention_explainer")}</p>
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : !data || data.videos.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">{t("analytics_retention_no_data")}</CardContent></Card>
      ) : (
        <div className="space-y-4">
          {data.videos.map((v, i) => {
            const d = v.diagnosis;
            const src = sourceLabel(v.source === "youtube_analytics" || v.source === "meta_insights" ? v.source : "fixture");
            return (
              <Card key={i}>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base">{v.title}</CardTitle>
                  <Badge variant={src.isDemo ? "destructive" : "secondary"}>{src.label}</Badge>
                </CardHeader>
                <CardContent>
                  {d.status === "insufficient_data" ? (
                    <p className="text-sm text-muted-foreground">
                      {t("analytics_retention_no_data")} ({d.pointCount} points)
                    </p>
                  ) : d.weakestScene ? (
                    <div className="space-y-2 text-sm">
                      <p>
                        <strong>{t("analytics_weakest_scene")}:</strong>{" "}
                        {d.weakestScene.scene_number != null ? `Scene ${d.weakestScene.scene_number}` : "Unknown scene"}{" "}
                        <span className="text-muted-foreground">
                          ({t("analytics_hook_baseline")} {d.hookBaseline?.toFixed(0)}% → {d.weakestScene.weakestRetention.toFixed(0)}% @ {d.weakestScene.atSeconds}s, −{d.weakestScene.dropPoints.toFixed(1)}pts)
                        </span>
                      </p>
                      <p className="text-muted-foreground">{d.weakestScene.diagnosis}</p>
                      {d.unattributedPoints > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {d.unattributedPoints} {t("analytics_unattributed_points")}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Retention holds at or above the hook baseline ({d.hookBaseline?.toFixed(0)}%) — no weak scene to diagnose.
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
