/**
 * Stream C — /intelligence/channels/$channelId
 * Channel detail: snapshot-derived stats, subscriber sparkline, videos
 * ranked by outlier score, and ESTIMATE-labeled similar channels.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getChannelDetail, type ChannelSnapshot } from "@/lib/intelligence/channels.functions";
import { listVideos, type VideoCard } from "@/lib/intelligence/videos.functions";
import { getSimilarChannels } from "@/lib/intelligence/outliers.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  EmptyState,
  ErrorState,
  EstimateBadge,
  FreshnessLabel,
  InsufficientDataPanel,
  PageSkeleton,
  ScoreBadge,
  Stat,
  UnconfiguredPanel,
} from "@/lib/intelligence/ui-states";
import { formatNumber, timeAgo } from "@/lib/intelligence/format";

export const Route = createFileRoute("/_authenticated/intelligence/channels/$channelId")({
  component: ChannelDetail,
});

function Sparkline({ snapshots }: { snapshots: ChannelSnapshot[] }) {
  const points = snapshots
    .filter((s) => s.subscriber_count != null)
    .sort((a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime());
  if (points.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">
        Not enough snapshots yet for a growth chart (needs at least 2 with subscriber counts).
      </p>
    );
  }
  const values = points.map((p) => p.subscriber_count as number);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const W = 320;
  const H = 90;
  const coords = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = H - 8 - ((v - min) / span) * (H - 16);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-24 w-full"
        role="img"
        aria-label={`Subscriber growth chart, ${formatNumber(min)} to ${formatNumber(max)} subscribers across ${points.length} snapshots`}
      >
        <polyline
          points={coords.join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-primary"
        />
      </svg>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{timeAgo(points[0]?.captured_at ?? null)}</span>
        <span>
          {formatNumber(min)} → {formatNumber(max)} subs
        </span>
      </div>
    </div>
  );
}

function VideoRow({ video }: { video: VideoCard }) {
  return (
    <Link to="/intelligence/videos/$videoId" params={{ videoId: video.id }} data-testid="video-row">
      <Card className="transition-colors hover:border-primary">
        <CardContent className="flex gap-4 py-4">
          {video.thumbnailUrl ? (
            <img
              src={video.thumbnailUrl}
              alt=""
              className="aspect-video w-36 shrink-0 rounded object-cover"
              loading="lazy"
            />
          ) : (
            <div className="aspect-video w-36 shrink-0 rounded bg-muted" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{video.title}</p>
            <p className="text-xs text-muted-foreground">
              {formatNumber(video.viewCount)} views
              {video.publishedAt
                ? ` · published ${new Date(video.publishedAt).toLocaleDateString()}`
                : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {video.outlierScore != null ? (
                <ScoreBadge score={video.outlierScore} />
              ) : (
                <span className="text-xs text-muted-foreground">outlier: n/a</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function ChannelDetail() {
  const { channelId } = Route.useParams();
  const detailFn = useServerFn(getChannelDetail);
  const videosFn = useServerFn(listVideos);
  const similarFn = useServerFn(getSimilarChannels);

  const detailQuery = useQuery({
    queryKey: ["intel-channel-detail", channelId],
    queryFn: () => detailFn({ data: { channelId } }),
  });
  const videosQuery = useQuery({
    queryKey: ["intel-channel-videos", channelId],
    queryFn: () => videosFn({ data: { channelId, sort: "outlier", max: 50 } }),
    enabled: detailQuery.data?.status === "ok",
  });
  const similarQuery = useQuery({
    queryKey: ["intel-similar-channels", channelId],
    queryFn: () => similarFn({ data: { channelId, max: 8 } }),
    enabled: detailQuery.data?.status === "ok",
  });

  const detail = detailQuery.data;

  if (detailQuery.isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <PageSkeleton rows={3} />
      </div>
    );
  }
  if (detailQuery.isError) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <ErrorState
          message={
            detailQuery.error instanceof Error
              ? detailQuery.error.message
              : "Failed to load channel"
          }
          onRetry={() => detailQuery.refetch()}
        />
      </div>
    );
  }
  if (detail?.status === "unconfigured") return <UnconfiguredPanel reason={detail.reason} />;
  if (detail?.status === "insufficient_data" || !detail || detail.status !== "ok") {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <InsufficientDataPanel
          reason={
            detail?.status === "insufficient_data"
              ? detail.reason
              : "Channel data is not available."
          }
        />
      </div>
    );
  }

  const { channel, snapshots, freshness } = detail;
  const latest = [...snapshots].sort(
    (a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime(),
  )[0];

  const videosRes = videosQuery.data;
  const videos =
    videosRes?.status === "ok"
      ? [...videosRes.videos].sort((a, b) => (b.outlierScore ?? -1) - (a.outlierScore ?? -1))
      : [];

  const similarRes = similarQuery.data;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Link to="/intelligence/channels" className="text-sm text-muted-foreground hover:underline">
        ← All channels
      </Link>

      {/* Header */}
      <div className="mb-6 mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{channel.title ?? channel.handle ?? "Channel"}</h1>
          <p className="text-muted-foreground">{channel.handle}</p>
          <div className="mt-1">
            <FreshnessLabel
              capturedAt={freshness.capturedAt}
              staleAfterHours={freshness.staleAfterHours}
            />
          </div>
        </div>
      </div>

      <div className="mb-8 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Snapshot stats</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-4">
            <Stat label="Subscribers" value={formatNumber(latest?.subscriber_count ?? null)} />
            <Stat label="Videos" value={formatNumber(latest?.video_count ?? null)} />
            <Stat label="Total views" value={formatNumber(latest?.view_count ?? null)} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Subscriber growth</CardTitle>
          </CardHeader>
          <CardContent>
            <Sparkline snapshots={snapshots} />
          </CardContent>
        </Card>
      </div>

      {/* Videos by outlier score */}
      <h2 className="mb-3 text-lg font-semibold">Videos — ranked by outlier score</h2>
      {videosQuery.isLoading ? (
        <PageSkeleton rows={3} />
      ) : videosQuery.isError ? (
        <ErrorState message="Failed to load videos" onRetry={() => videosQuery.refetch()} />
      ) : videosRes?.status === "unconfigured" ? (
        <UnconfiguredPanel reason={videosRes.reason} />
      ) : videos.length === 0 ? (
        <EmptyState
          title="No scored videos yet"
          description="Videos appear here once metric snapshots have been captured for this channel."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {videos.map((v) => (
            <VideoRow key={v.id} video={v} />
          ))}
        </div>
      )}

      {/* Similar channels */}
      <div className="mt-10">
        <div className="mb-1 flex items-center gap-2">
          <h2 className="text-lg font-semibold">Similar channels</h2>
          <EstimateBadge />
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          Heuristic estimate: same niche watchlist + subscriber count within one order of magnitude
          (0.1×–10×). Not a measured similarity — treat as a starting point for research.
        </p>
        {similarQuery.isLoading ? (
          <PageSkeleton rows={3} />
        ) : similarQuery.isError ? (
          <ErrorState
            message="Failed to load similar channels"
            onRetry={() => similarQuery.refetch()}
          />
        ) : similarRes?.status === "unconfigured" ? (
          <UnconfiguredPanel reason={similarRes.reason} />
        ) : similarRes?.status === "insufficient_data" ? (
          <InsufficientDataPanel reason={similarRes.reason} />
        ) : !similarRes || similarRes.status !== "ok" || similarRes.channels.length === 0 ? (
          <EmptyState
            title="No similar channels found"
            description="No other tracked channel in the same niche falls inside the subscriber band yet."
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {similarRes.channels.map((c) => (
              <Link key={c.id} to="/intelligence/channels/$channelId" params={{ channelId: c.id }}>
                <Card className="h-full transition-colors hover:border-primary">
                  <CardHeader>
                    <CardTitle className="truncate text-base">
                      {c.title ?? c.handle ?? "—"}
                    </CardTitle>
                    <p className="truncate text-xs text-muted-foreground">{c.handle}</p>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p>
                      <span className="font-semibold">{formatNumber(c.subscriberCount)}</span>{" "}
                      <span className="text-muted-foreground">subs</span>
                    </p>
                    <FreshnessLabel
                      capturedAt={c.freshness.capturedAt}
                      staleAfterHours={c.freshness.staleAfterHours}
                    />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
