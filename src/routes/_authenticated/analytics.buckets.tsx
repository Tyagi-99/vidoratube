import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getContentBuckets } from "@/lib/analytics/functions";
import { rankBuckets } from "@/lib/analytics/buckets";
import { formatCompact } from "@/lib/analytics/deltas";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/analytics/buckets")({
  component: BucketsPage,
});

const RANK_OPTIONS = [
  { value: "totalViews", label: "Views" },
  { value: "avgCtr", label: "CTR" },
  { value: "totalWatchTimeMinutes", label: "Watch time" },
] as const;

function BucketsPage() {
  const { t } = useI18n();
  const fn = useServerFn(getContentBuckets);
  const { data, isLoading } = useQuery({ queryKey: ["analytics-buckets"], queryFn: () => fn({ data: {} }) });
  const [rankBy, setRankBy] = useState<(typeof RANK_OPTIONS)[number]["value"]>("totalViews");

  const buckets = data ? rankBuckets(data.buckets, rankBy) : [];

  return (
    <div>
      <p className="mb-6 max-w-3xl text-sm text-muted-foreground">{t("analytics_bucket_explainer")}</p>
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : buckets.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">{t("analytics_no_buckets")}</CardContent></Card>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("analytics_bucket_rank_by")}:</span>
            {RANK_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setRankBy(o.value)}
                className={`rounded-full border px-3 py-1 ${rankBy === o.value ? "border-primary bg-primary/10" : "text-muted-foreground"}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {buckets.map((b, i) => (
              <Card key={b.bucket}>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base">
                    <span className="mr-2 text-muted-foreground">#{i + 1}</span>
                    {b.bucket}
                  </CardTitle>
                  {b.thinData && <Badge variant="outline">{t("analytics_thin_data")}</Badge>}
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><p className="text-muted-foreground">{t("analytics_videos")}</p><p className="text-lg font-semibold">{b.videoCount}</p></div>
                    <div><p className="text-muted-foreground">{t("analytics_views")}</p><p className="text-lg font-semibold">{formatCompact(b.totalViews)}</p></div>
                    <div><p className="text-muted-foreground">{t("analytics_ctr")}</p><p className="text-lg font-semibold">{b.avgCtr.toFixed(1)}%</p></div>
                    <div><p className="text-muted-foreground">{t("analytics_watch_time")}</p><p className="text-lg font-semibold">{formatCompact(b.totalWatchTimeMinutes)}m</p></div>
                  </div>
                  {b.topVideoTitle && (
                    <p className="mt-3 truncate text-xs text-muted-foreground">Top: {b.topVideoTitle}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
