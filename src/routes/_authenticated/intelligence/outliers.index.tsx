/**
 * Stream C — /intelligence/outliers
 * Outlier ideation cards (F4). Each card carries a one-click "Draft script"
 * handoff into Stream A's draftIdeaFromVideo.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { listOutliers, type OutlierEntry } from "@/lib/intelligence/outliers.functions";
import { draftIdeaFromVideo } from "@/lib/intelligence/videos.functions";
import { listNiches } from "@/lib/intelligence/niches.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ConfidenceBadge,
  EmptyState,
  ErrorState,
  FactorDetails,
  InsufficientDataPanel,
  PageSkeleton,
  ScoreBadge,
  UnconfiguredPanel,
  formatNumber,
} from "@/lib/intelligence/ui-states";

export const Route = createFileRoute("/_authenticated/intelligence/outliers/")({
  component: OutliersIndex,
});

type SortKey = "score" | "velocity" | "recent";

function OutlierCard({ entry }: { entry: OutlierEntry }) {
  const navigate = useNavigate();
  const draftFn = useServerFn(draftIdeaFromVideo);
  const [drafting, setDrafting] = useState(false);

  const draft = async () => {
    setDrafting(true);
    try {
      const res = await draftFn({ data: { videoId: entry.id } });
      if (res.status === "ok") {
        toast.success("Draft idea created from outlier", {
          action: {
            label: "View idea",
            onClick: () =>
              navigate({
                to: "/research/$projectId",
                params: { projectId: res.researchProjectId },
              }),
          },
        });
      } else {
        toast.error(res.reason);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to draft idea");
    } finally {
      setDrafting(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      {entry.thumbnailUrl ? (
        <img
          src={entry.thumbnailUrl}
          alt=""
          className="aspect-video w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="aspect-video w-full bg-muted" />
      )}
      <CardContent className="space-y-3 pt-4">
        <div>
          <p className="font-medium leading-snug">{entry.title}</p>
          {entry.channelTitle && (
            <p className="text-xs text-muted-foreground">{entry.channelTitle}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ScoreBadge score={entry.outlier.score} />
          <ConfidenceBadge confidence={entry.outlier.confidence} />
        </div>
        <div className="flex gap-4 text-sm">
          <span>
            <span className="font-semibold">{formatNumber(entry.viewCount)}</span>{" "}
            <span className="text-muted-foreground">views</span>
          </span>
          <span>
            <span className="font-semibold">
              {entry.outlier.velocityPerDay == null
                ? "—"
                : `${formatNumber(Math.round(entry.outlier.velocityPerDay))}/day`}
            </span>{" "}
            <span className="text-muted-foreground">velocity</span>
          </span>
        </div>
        <FactorDetails factors={entry.outlier.factors} />
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void draft()} disabled={drafting}>
            {drafting ? "Drafting…" : "Draft script"}
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link to="/intelligence/videos/$videoId" params={{ videoId: entry.id }}>
              Analyze
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function OutliersIndex() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listOutliers);
  const nichesFn = useServerFn(listNiches);

  const [nicheId, setNicheId] = useState("all");
  const [minScore, setMinScore] = useState("2");
  const [sort, setSort] = useState<SortKey>("score");

  const nichesQuery = useQuery({
    queryKey: ["intel-niches"],
    queryFn: () => nichesFn({ data: {} }),
  });
  const niches = nichesQuery.data?.status === "ok" ? nichesQuery.data.niches : [];

  const parsedMinScore = Number(minScore);
  const outliersQuery = useQuery({
    queryKey: ["intel-outliers", nicheId, minScore, sort],
    queryFn: () =>
      listFn({
        data: {
          nicheId: nicheId === "all" ? undefined : nicheId,
          minScore: Number.isFinite(parsedMinScore) && parsedMinScore >= 1 ? parsedMinScore : 2,
          sort,
        },
      }),
  });

  const res = outliersQuery.data;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-1">
        <h1 className="text-2xl font-bold">Outliers</h1>
        <p className="text-muted-foreground">
          Videos outperforming their channel's median, scored from metric snapshots. Scores are
          descriptive multiples — not predictions of future performance.
        </p>
      </div>

      <div className="mb-6 mt-4 flex flex-wrap items-center gap-3">
        <Select value={nicheId} onValueChange={setNicheId}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All niches" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All niches</SelectItem>
            {niches.map((n) => (
              <SelectItem key={n.id} value={n.id}>
                {n.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Min score
          <Input
            className="w-20"
            type="number"
            min={1}
            step={0.5}
            value={minScore}
            onChange={(e) => setMinScore(e.target.value)}
          />
          ×
        </label>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="score">Outlier score</SelectItem>
            <SelectItem value="velocity">Velocity</SelectItem>
            <SelectItem value="recent">Most recent</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ["intel-outliers"] })}>
          Refresh
        </Button>
      </div>

      {outliersQuery.isLoading ? (
        <PageSkeleton />
      ) : outliersQuery.isError ? (
        <ErrorState
          message={
            outliersQuery.error instanceof Error
              ? outliersQuery.error.message
              : "Failed to load outliers"
          }
          onRetry={() => outliersQuery.refetch()}
        />
      ) : res?.status === "unconfigured" ? (
        <UnconfiguredPanel reason={res.reason} />
      ) : res?.status === "insufficient_data" ? (
        <InsufficientDataPanel reason={res.reason} />
      ) : res?.status === "ok" && res.outliers.length === 0 ? (
        <EmptyState
          title="No outliers above the threshold"
          description="No tracked video currently beats its channel median by the minimum score. Lower the threshold, or wait for more snapshots to accumulate."
        />
      ) : res?.status === "ok" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {res.outliers.map((o) => (
            <OutlierCard key={o.id} entry={o} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
