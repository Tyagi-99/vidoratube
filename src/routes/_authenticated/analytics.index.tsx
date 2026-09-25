import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getChannelOverview,
  getLearningInsights,
  getWeeklyDigest,
  runLearningLoop,
  snapshotAnalytics,
  exportAnalyticsCsv,
} from "@/lib/analytics.functions";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { LangToggle } from "./research.index";

export const Route = createFileRoute("/_authenticated/analytics/")({
  component: AnalyticsIndex,
});

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function AnalyticsIndex() {
  const { t, lang, setLang } = useI18n();
  const queryClient = useQueryClient();
  const overviewFn = useServerFn(getChannelOverview);
  const syncFn = useServerFn(snapshotAnalytics);
  const learningFn = useServerFn(runLearningLoop);
  const insightsFn = useServerFn(getLearningInsights);
  const digestFn = useServerFn(getWeeklyDigest);
  const csvFn = useServerFn(exportAnalyticsCsv);

  const overview = useQuery({ queryKey: ["analytics-overview"], queryFn: () => overviewFn({ data: {} }) });
  const insights = useQuery({ queryKey: ["analytics-insights"], queryFn: () => insightsFn({ data: { limit: 20 } }) });
  const digest = useQuery({ queryKey: ["analytics-digest"], queryFn: () => digestFn({ data: {} }) });

  const sync = useMutation({
    mutationFn: () => syncFn({ data: {} }),
    onSuccess: (r) => {
      toast.success(`${t("analytics_synced")} — ${r.videos} videos`);
      queryClient.invalidateQueries({ queryKey: ["analytics-overview"] });
      queryClient.invalidateQueries({ queryKey: ["analytics-digest"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Sync failed"),
  });

  const learn = useMutation({
    mutationFn: () => learningFn({ data: {} }),
    onSuccess: (r) => {
      if (r.ran) {
        toast.success(t("analytics_learning_ran"));
        queryClient.invalidateQueries({ queryKey: ["analytics-insights"] });
      } else {
        toast.info(t("analytics_not_enough"));
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Learning loop failed"),
  });

  const exportCsv = useMutation({
    mutationFn: () => csvFn({ data: {} }),
    onSuccess: (r) => {
      const blob = new Blob([r.csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "vidora-analytics.csv";
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Export failed"),
  });

  const data = overview.data;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("analytics_title")}</h1>
          <p className="text-muted-foreground">{t("analytics_subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <LangToggle lang={lang} setLang={setLang} />
          <Button variant="outline" onClick={() => exportCsv.mutate()} disabled={!data?.hasData || exportCsv.isPending}>
            {t("analytics_export_csv")}
          </Button>
          <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
            {sync.isPending ? t("analytics_syncing") : t("analytics_sync")}
          </Button>
        </div>
      </div>

      {overview.isLoading ? (
        <div className="grid gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : !data?.hasData ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {t("analytics_no_data")}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Card><CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">{t("analytics_total_views")}</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold">{fmt(data.videos.reduce((a, v) => a + v.metrics.views, 0))}</p></CardContent></Card>
            <Card><CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">{t("analytics_avg_ctr")}</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold">{data.averages.avgCtr.toFixed(1)}%</p></CardContent></Card>
            <Card><CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">{t("analytics_avg_retention")}</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold">{data.averages.avgRetention.toFixed(0)}%</p></CardContent></Card>
            <Card><CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">{t("analytics_videos")}</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold">{data.videos.length}</p></CardContent></Card>
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>{t("analytics_top_videos")}</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {data.videos.slice(0, 10).map((v) => (
                    <div key={v.youtubeVideoId} className="flex items-start justify-between gap-3 border-b pb-3 last:border-0">
                      <div className="min-w-0">
                        <a
                          href={`https://youtu.be/${v.youtubeVideoId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate font-medium hover:underline"
                        >
                          {v.title}
                        </a>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span>{t("analytics_views")}: {fmt(v.metrics.views)}</span>
                          <span>{t("analytics_ctr")}: {v.metrics.ctr.toFixed(1)}%</span>
                          <span>{t("analytics_retention")}: {v.retention.toFixed(0)}%</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {v.viewsVsAvg.pctAbove >= 100 && (
                          <Badge variant="default">{t("analytics_outlier_badge")}</Badge>
                        )}
                        <span className={`text-xs ${v.viewsVsAvg.pctAbove >= 0 ? "text-green-600" : "text-red-500"}`}>
                          {v.viewsVsAvg.pctAbove >= 0 ? "+" : ""}{v.viewsVsAvg.pctAbove.toFixed(0)}% {t("analytics_vs_avg")}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>{t("analytics_digest")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {digest.isLoading ? (
                    <Skeleton className="h-24" />
                  ) : digest.data?.hasEnoughData ? (
                    <div className="space-y-2">
                      <p className="text-sm">
                        <strong>{digest.data.topVideo?.title}</strong> — {fmt(digest.data.totalViews)} {t("analytics_views")}, {digest.data.avgCtr.toFixed(1)}% {t("analytics_ctr")}
                      </p>
                      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                        {digest.data.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t("analytics_not_enough")}</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>{t("analytics_learnings")}</CardTitle>
                  <Button size="sm" variant="outline" onClick={() => learn.mutate()} disabled={learn.isPending}>
                    {t("analytics_run_learning")}
                  </Button>
                </CardHeader>
                <CardContent>
                  {insights.isLoading ? (
                    <Skeleton className="h-24" />
                  ) : (insights.data?.insights.length ?? 0) === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("analytics_not_enough")}</p>
                  ) : (
                    <div className="space-y-3">
                      {insights.data!.insights.map((ins) => (
                        <div key={ins.id} className="rounded-lg border p-3 text-sm">
                          <div className="mb-1 flex items-center gap-2">
                            <Badge variant="secondary">{ins.kind}</Badge>
                            <span className="text-xs text-muted-foreground">
                              {new Date(ins.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          <pre className="whitespace-pre-wrap font-sans text-muted-foreground">
                            {JSON.stringify(ins.payload, null, 1).slice(0, 400)}
                          </pre>
                          {ins.kind === "pattern" && (
                            <p className="mt-1 text-xs italic text-muted-foreground">
                              {t("analytics_correlation_note")}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
