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
import {
  getAnalyticsDashboard,
  ingestAnalyticsSnapshot,
} from "@/lib/analytics/functions";
import { formatCompact, formatDelta } from "@/lib/analytics/deltas";
import { sourceLabel } from "@/lib/analytics/types";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { VideoInsights } from "@/components/vidora/VideoInsights";

export const Route = createFileRoute("/_authenticated/analytics/")({
  component: AnalyticsIndex,
});

function fmt(n: number): string {
  return formatCompact(n);
}

function SourceBadge({ source }: { source: "youtube_analytics" | "meta_insights" | "fixture" }) {
  const { label, isDemo } = sourceLabel(source);
  return (
    <Badge variant={isDemo ? "destructive" : "secondary"} title={isDemo ? "Fixture data — not platform-measured" : label}>
      {label}
    </Badge>
  );
}

function AnalyticsIndex() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const overviewFn = useServerFn(getChannelOverview);
  const syncFn = useServerFn(snapshotAnalytics);
  const learningFn = useServerFn(runLearningLoop);
  const insightsFn = useServerFn(getLearningInsights);
  const digestFn = useServerFn(getWeeklyDigest);
  const csvFn = useServerFn(exportAnalyticsCsv);
  const dashboardFn = useServerFn(getAnalyticsDashboard);
  const ingestFn = useServerFn(ingestAnalyticsSnapshot);

  const dashboard = useQuery({ queryKey: ["analytics-dashboard"], queryFn: () => dashboardFn({ data: {} }) });
  const overview = useQuery({ queryKey: ["analytics-overview"], queryFn: () => overviewFn({ data: {} }) });
  const insights = useQuery({ queryKey: ["analytics-insights"], queryFn: () => insightsFn({ data: { limit: 20 } }) });
  const digest = useQuery({ queryKey: ["analytics-digest"], queryFn: () => digestFn({ data: {} }) });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["analytics-dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["analytics-overview"] });
    queryClient.invalidateQueries({ queryKey: ["analytics-digest"] });
  };

  const sync = useMutation({
    mutationFn: () => syncFn({ data: {} }),
    onSuccess: (r) => {
      toast.success(`${t("analytics_synced")} — ${r.videos} videos`);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Sync failed"),
  });

  const ingest = useMutation({
    mutationFn: () => ingestFn({ data: {} }),
    onSuccess: (r) => {
      if (r.ok) {
        toast.success(t("analytics_ingested"));
        invalidate();
      } else {
        toast.info(r.message ?? t("analytics_ingest_unavailable"));
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Ingestion failed"),
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
  const dash = dashboard.data;
  const deltaByKey = new Map((dash?.deltas ?? []).map((d) => [d.key, d]));
  const avgCtr =
    (dash?.perVideo.length ?? 0) > 0
      ? dash!.perVideo.reduce((a, v) => a + v.ctr, 0) / dash!.perVideo.length
      : 0;

  const metricCards = [
    { key: "views", title: t("analytics_total_views"), format: (n: number) => fmt(n) },
    { key: "watch_time_minutes", title: t("analytics_watch_time"), format: (n: number) => `${fmt(n)}m` },
    { key: "subscribers_gained", title: t("analytics_subs_gained"), format: (n: number) => fmt(n) },
  ] as const;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => exportCsv.mutate()} disabled={!data?.hasData || exportCsv.isPending}>
          {t("analytics_export_csv")}
        </Button>
        <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
          {sync.isPending ? t("analytics_syncing") : t("analytics_sync")}
        </Button>
        <Button onClick={() => ingest.mutate()} disabled={ingest.isPending}>
          {ingest.isPending ? t("analytics_ingesting") : t("analytics_ingest")}
        </Button>
        {dash?.current && <SourceBadge source={dash.current.source} />}
      </div>

      {dash?.ingestion.connected === false && (
        <Card className="mb-6 border-dashed">
          <CardContent className="py-6">
            <p className="text-sm text-muted-foreground">{t("analytics_ingest_unavailable")}</p>
          </CardContent>
        </Card>
      )}

      {dashboard.isLoading ? (
        <div className="grid gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : !dash?.hasData ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {t("analytics_no_data")}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            {metricCards.map((c) => {
              const d = deltaByKey.get(c.key);
              const up = (d?.pct ?? 0) >= 0;
              return (
                <Card key={c.key}>
                  <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">{c.title}</CardTitle></CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">{c.format(d?.current ?? 0)}</p>
                    <p className={`mt-1 text-xs ${d?.hasBaseline ? (up ? "text-green-600" : "text-red-500") : "text-muted-foreground"}`}>
                      {d ? formatDelta(d) : "—"} <span className="text-muted-foreground">{d?.baselineLabel ?? t("analytics_insufficient_history")}</span>
                    </p>
                  </CardContent>
                </Card>
              );
            })}
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">{t("analytics_avg_ctr")}</CardTitle></CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{avgCtr.toFixed(1)}%</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("analytics_videos")}: {dash.perVideo.length}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-8">
            <CardHeader><CardTitle>{t("analytics_per_video")}</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">{t("analytics_top_videos")}</th>
                      <th className="py-2 pr-4 font-medium">{t("analytics_published")}</th>
                      <th className="py-2 pr-4 text-right font-medium">{t("analytics_views")}</th>
                      <th className="py-2 pr-4 text-right font-medium">{t("analytics_ctr")}</th>
                      <th className="py-2 pr-4 text-right font-medium">{t("analytics_retention")}</th>
                      <th className="py-2 text-right font-medium">{t("analytics_watch_time")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dash.perVideo.map((v) => (
                      <tr key={v.youtubeVideoId} className="border-b last:border-0">
                        <td className="py-2 pr-4">
                          <a href={`https://youtu.be/${v.youtubeVideoId}`} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                            {v.title}
                          </a>
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {v.publishedAt ? new Date(v.publishedAt).toLocaleDateString() : "—"}
                        </td>
                        <td className="py-2 pr-4 text-right">{fmt(v.views)}</td>
                        <td className="py-2 pr-4 text-right">{v.ctr.toFixed(1)}%</td>
                        <td className="py-2 pr-4 text-right">
                          {v.avgViewDurationS > 0 ? `${v.avgViewDurationS.toFixed(0)}s` : "—"}
                        </td>
                        <td className="py-2 text-right">{fmt(v.watchTimeMinutes)}m</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="mt-8 grid gap-6 lg:grid-cols-2">
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
          {data?.hasData && (
            <VideoInsights videos={data.videos.map((v) => ({ youtubeVideoId: v.youtubeVideoId, title: v.title }))} />
          )}
        </>
      )}
    </div>
  );
}
