/**
 * Stream C — /intelligence/videos/$videoId
 * Deep video analysis (F5): descriptive packaging/publishing/performance
 * facts + snapshot-derived outlier score, plus a 3-video comparison that
 * calls Stream A's compareVideos alongside analyzeVideo per video.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  analyzeVideo,
  type VideoAnalysis,
} from "@/lib/intelligence/video-analysis.functions";
import { compareVideos, listVideos } from "@/lib/intelligence/videos.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ConfidenceBadge,
  EmptyState,
  ErrorState,
  FactorDetails,
  InsufficientDataPanel,
  PageSkeleton,
  ScoreBadge,
  Stat,
  formatNumber,
} from "@/lib/intelligence/ui-states";

export const Route = createFileRoute("/_authenticated/intelligence/videos/$videoId")({
  component: VideoAnalysisPage,
});

function FactRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function AnalysisSections({ analysis }: { analysis: VideoAnalysis }) {
  const { packaging, publishing, performance, outlier } = analysis;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Packaging — descriptive facts</CardTitle>
        </CardHeader>
        <CardContent>
          <FactRow label="Title length" value={`${packaging.titleLength} characters`} />
          <FactRow label="Contains a number" value={packaging.hasNumber ? "Yes" : "No"} />
          <FactRow label="Asks a question" value={packaging.hasQuestion ? "Yes" : "No"} />
          <p className="mt-3 text-xs text-muted-foreground">
            These describe the title as written. They are not predictions of click-through or
            performance.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Publishing facts</CardTitle>
        </CardHeader>
        <CardContent>
          <FactRow
            label="Published"
            value={
              publishing.publishedAt
                ? new Date(publishing.publishedAt).toLocaleString()
                : "Unknown"
            }
          />
          <FactRow label="Day of week (UTC)" value={publishing.dayOfWeek ?? "Unknown"} />
          <FactRow
            label="Hour of day (UTC)"
            value={publishing.hourUTC == null ? "Unknown" : `${publishing.hourUTC}:00`}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Performance — observed</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-4">
          <Stat label="Views" value={formatNumber(performance.views)} />
          <Stat
            label="Views / day"
            value={
              performance.viewsPerDay == null
                ? "—"
                : formatNumber(Math.round(performance.viewsPerDay))
            }
          />
          <Stat label="Likes" value={formatNumber(performance.likeCount)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Outlier score</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {outlier ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <ScoreBadge score={outlier.score} />
                <ConfidenceBadge confidence={outlier.confidence} />
              </div>
              <FactorDetails factors={outlier.factors} />
              <p className="text-xs text-muted-foreground">
                Computed from {outlier.snapshotsUsed} snapshot
                {outlier.snapshotsUsed === 1 ? "" : "s"} against sibling videos on the same
                channel.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Not computable for this video — it needs a channel with sibling videos that have
              snapshots.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">AI analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            AI-generated notes aren't wired in Phase 2, so this section is intentionally empty —
            nothing here is machine-invented.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function ComparisonTable({ analyses }: { analyses: VideoAnalysis[] }) {
  const rows: { label: string; get: (a: VideoAnalysis) => React.ReactNode }[] = [
    { label: "Title", get: (a) => <span className="font-medium">{a.video.title}</span> },
    { label: "Views", get: (a) => formatNumber(a.performance.views) },
    {
      label: "Views / day",
      get: (a) =>
        a.performance.viewsPerDay == null ? "—" : formatNumber(Math.round(a.performance.viewsPerDay)),
    },
    { label: "Likes", get: (a) => formatNumber(a.performance.likeCount) },
    {
      label: "Outlier score",
      get: (a) => (a.outlier ? `${a.outlier.score.toFixed(1)}×` : "n/a"),
    },
    {
      label: "Confidence",
      get: (a) => (a.outlier ? <ConfidenceBadge confidence={a.outlier.confidence} /> : "—"),
    },
    { label: "Title length", get: (a) => `${a.packaging.titleLength} chars` },
    { label: "Has number", get: (a) => (a.packaging.hasNumber ? "Yes" : "No") },
    { label: "Asks question", get: (a) => (a.packaging.hasQuestion ? "Yes" : "No") },
    { label: "Day of week (UTC)", get: (a) => a.publishing.dayOfWeek ?? "—" },
    {
      label: "Hour (UTC)",
      get: (a) => (a.publishing.hourUTC == null ? "—" : `${a.publishing.hourUTC}:00`),
    },
    {
      label: "Published",
      get: (a) =>
        a.publishing.publishedAt ? new Date(a.publishing.publishedAt).toLocaleDateString() : "—",
    },
  ];
  return (
    <Card className="mt-4 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-40">Metric</TableHead>
            {analyses.map((a) => (
              <TableHead key={a.video.id} className="min-w-48">
                <Link
                  to="/intelligence/videos/$videoId"
                  params={{ videoId: a.video.id }}
                  className="hover:underline"
                >
                  <span className="line-clamp-2 font-medium normal-case">{a.video.title}</span>
                </Link>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.label}>
              <TableCell className="font-medium text-muted-foreground">{r.label}</TableCell>
              {analyses.map((a) => (
                <TableCell key={a.video.id}>{r.get(a)}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function VideoAnalysisPage() {
  const { videoId } = Route.useParams();
  const analyzeFn = useServerFn(analyzeVideo);
  const listFn = useServerFn(listVideos);
  const compareFn = useServerFn(compareVideos);

  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [compared, setCompared] = useState<VideoAnalysis[]>([]);

  const analysisQuery = useQuery({
    queryKey: ["intel-video-analysis", videoId],
    queryFn: () => analyzeFn({ data: { videoId } }),
  });

  const res = analysisQuery.data;
  let analysis: VideoAnalysis | undefined;
  let insufficientReason: string | undefined;
  if (res?.status === "ok") {
    analysis = res.analysis;
  } else if (res?.status === "insufficient_data") {
    insufficientReason = res.reason;
    analysis = "analysis" in res ? res.analysis : undefined;
  }
  const channelId = analysis?.channelId ?? null;

  const channelVideosQuery = useQuery({
    queryKey: ["intel-compare-pool", channelId],
    queryFn: () => listFn({ data: { channelId: channelId ?? "", sort: "views", max: 50 } }),
    enabled: channelId != null,
  });
  const poolRes = channelVideosQuery.data;
  const pool =
    poolRes?.status === "ok" ? poolRes.videos.filter((v) => v.id !== videoId) : [];

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 2 ? prev : [...prev, id],
    );
  };

  const runComparison = async () => {
    const [a, b] = selected;
    if (!a || !b) return;
    setComparing(true);
    try {
      const cmp = await compareFn({ data: { videoIds: [videoId, a, b] } });
      if (cmp.status !== "ok") {
        toast.error("Comparison failed");
        return;
      }
      const results = await Promise.all(
        [videoId, a, b].map((id) => analyzeFn({ data: { videoId: id } })),
      );
      const oks = results.filter(
        (r): r is { status: "ok"; analysis: VideoAnalysis } => r.status === "ok",
      );
      if (oks.length < 3) {
        toast.error("One of the videos lacks enough data to compare.");
        return;
      }
      setCompared(oks.map((r) => r.analysis));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Comparison failed");
    } finally {
      setComparing(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {analysisQuery.isLoading ? (
        <PageSkeleton rows={4} />
      ) : analysisQuery.isError ? (
        <ErrorState
          message={
            analysisQuery.error instanceof Error
              ? analysisQuery.error.message
              : "Failed to analyze video"
          }
          onRetry={() => analysisQuery.refetch()}
        />
      ) : !analysis ? (
        <InsufficientDataPanel reason={insufficientReason ?? "Video not found."} />
      ) : (
        <>
          {insufficientReason && <InsufficientDataPanel reason={insufficientReason} />}

          {/* Header */}
          <div className="mb-6 flex flex-wrap gap-6">
            {analysis.video.thumbnailUrl ? (
              <img
                src={analysis.video.thumbnailUrl}
                alt=""
                className="aspect-video w-72 rounded object-cover"
              />
            ) : (
              <div className="aspect-video w-72 rounded bg-muted" />
            )}
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold leading-snug">{analysis.video.title}</h1>
              {analysis.video.channelTitle && (
                <p className="mt-1 text-muted-foreground">{analysis.video.channelTitle}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {analysis.outlier && (
                  <>
                    <ScoreBadge score={analysis.outlier.score} />
                    <ConfidenceBadge confidence={analysis.outlier.confidence} />
                  </>
                )}
              </div>
            </div>
          </div>

          <div className={insufficientReason ? "mt-6" : ""}>
            <AnalysisSections analysis={analysis} />
          </div>

          {/* 3-video comparison */}
          <div className="mt-10">
            <h2 className="text-lg font-semibold">Compare with 2 more videos</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Pick two videos from the same channel. Comparison runs Stream A's{" "}
              <span className="font-mono">compareVideos</span> together with this page's{" "}
              <span className="font-mono">analyzeVideo</span> for each of the three.
            </p>
            {channelId == null ? (
              <EmptyState
                title="No channel linked"
                description="This video isn't linked to a channel, so there's no pool to compare against."
              />
            ) : channelVideosQuery.isLoading ? (
              <PageSkeleton rows={2} />
            ) : pool.length === 0 ? (
              <EmptyState
                title="No other videos to compare"
                description="The channel needs at least two more tracked videos with snapshots."
              />
            ) : (
              <>
                <div className="grid gap-2 md:grid-cols-2">
                  {pool.map((v) => (
                    <label
                      key={v.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm transition-colors ${
                        selected.includes(v.id) ? "border-primary bg-primary/5" : "hover:border-muted-foreground"
                      }`}
                    >
                      <Checkbox
                        checked={selected.includes(v.id)}
                        onCheckedChange={() => toggle(v.id)}
                        disabled={!selected.includes(v.id) && selected.length >= 2}
                      />
                      <span className="min-w-0 flex-1 truncate">{v.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatNumber(v.viewCount)} views
                      </span>
                    </label>
                  ))}
                </div>
                <Button
                  className="mt-4"
                  disabled={selected.length !== 2 || comparing}
                  onClick={() => void runComparison()}
                >
                  {comparing ? "Comparing…" : `Compare ${selected.length}/2 selected`}
                </Button>
                {compared.length === 3 && <ComparisonTable analyses={compared} />}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
