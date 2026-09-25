/**
 * Sprint 7-8: per-video insights panel for the Analytics page.
 *
 * Real data only: 24h/7d view deltas from stored snapshots, the stored
 * audience-retention curve aligned to chapter titles, and deterministic
 * "what to make next" recommendations from existing P3 ideas.
 * Every section degrades to an honest empty state.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n";
import { RetentionCurve } from "@/components/vidora/RetentionCurve";
import {
  getNextVideoRecommendations,
  getPlatformStats,
  getRetentionCurve,
  snapshotRetentionCurve,
} from "@/lib/video-insights.functions";

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

export function VideoInsights(props: { videos: Array<{ youtubeVideoId: string; title: string }> }) {
  const { videos } = props;
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string>(videos[0]?.youtubeVideoId ?? "");

  const statsFn = useServerFn(getPlatformStats);
  const curveFn = useServerFn(getRetentionCurve);
  const syncFn = useServerFn(snapshotRetentionCurve);
  const nextFn = useServerFn(getNextVideoRecommendations);

  const stats = useQuery({
    queryKey: ["video-insights", "stats", selected],
    queryFn: () => statsFn({ data: { youtubeVideoId: selected } }),
    enabled: !!selected,
  });
  const curve = useQuery({
    queryKey: ["video-insights", "curve", selected],
    queryFn: () => curveFn({ data: { youtubeVideoId: selected } }),
    enabled: !!selected,
  });
  const next = useQuery({
    queryKey: ["video-insights", "next", selected],
    queryFn: () => nextFn({ data: { youtubeVideoId: selected, count: 5 } }),
    enabled: !!selected,
  });
  const sync = useMutation({
    mutationFn: () => syncFn({ data: { youtubeVideoId: selected } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["video-insights", "curve", selected] });
      queryClient.invalidateQueries({ queryKey: ["video-insights", "stats", selected] });
    },
  });

  if (videos.length === 0) return null;

  const windows = stats.data;

  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t("insights_title")}</CardTitle>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {t("insights_select")}
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="max-w-[240px] truncate rounded-xl border border-border bg-background px-2 py-1 text-foreground"
          >
            {videos.map((v) => (
              <option key={v.youtubeVideoId} value={v.youtubeVideoId}>
                {v.title}
              </option>
            ))}
          </select>
        </label>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 24h / 7d deltas */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border p-4">
            <p className="text-xs text-muted-foreground">{t("insights_24h")}</p>
            {stats.isLoading ? (
              <Skeleton className="mt-2 h-7 w-20" />
            ) : windows?.views24h != null ? (
              <p className={`mt-1 text-2xl font-bold ${windows.views24h.delta >= 0 ? "text-green-600" : "text-red-500"}`}>
                {windows.views24h.delta >= 0 ? "+" : ""}{fmt(windows.views24h.delta)}
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">{t("insights_no_baseline")}</p>
            )}
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-xs text-muted-foreground">{t("insights_7d")}</p>
            {stats.isLoading ? (
              <Skeleton className="mt-2 h-7 w-20" />
            ) : windows?.views7d != null ? (
              <p className={`mt-1 text-2xl font-bold ${windows.views7d.delta >= 0 ? "text-green-600" : "text-red-500"}`}>
                {windows.views7d.delta >= 0 ? "+" : ""}{fmt(windows.views7d.delta)}
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">{t("insights_no_baseline")}</p>
            )}
          </div>
        </div>

        {/* Retention curve */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t("insights_retention_title")}</h3>
            <Button size="sm" variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending || !selected}>
              {t("insights_retention_sync")}
            </Button>
          </div>
          {curve.isLoading ? (
            <Skeleton className="h-48" />
          ) : curve.data?.hasData ? (
            <RetentionCurve
              model={curve.data.model}
              points={curve.data.points}
              emptyText={t("insights_retention_no_data")}
              strongestLabel={t("insights_strongest")}
              weakestLabel={t("insights_weakest")}
            />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("insights_retention_no_data")}</p>
          )}
        </div>

        {/* Next 5 videos */}
        <div>
          <h3 className="mb-2 text-sm font-semibold">{t("insights_next_title")}</h3>
          {next.isLoading ? (
            <Skeleton className="h-24" />
          ) : next.data && next.data.hasData ? (
            <ol className="space-y-2">
              {next.data.recommendations.map((r, i) => (
                <li key={r.idea.id} className="rounded-xl border p-3">
                  <div className="flex items-start gap-3">
                    <span className="text-lg font-bold text-muted-foreground">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{r.idea.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("insights_next_reason")}: {r.reasons.join(" · ")}
                      </p>
                      <div className="mt-1 flex gap-2 text-xs text-muted-foreground">
                        {r.idea.angle && <span>{r.idea.angle}</span>}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">{t("insights_next_no_data")}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
