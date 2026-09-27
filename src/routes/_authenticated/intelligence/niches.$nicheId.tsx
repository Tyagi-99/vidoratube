/**
 * Stream B — /intelligence/niches/$nicheId (F1 detail + F2 blueprint).
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { generateBlueprint, getBlueprint } from "@/lib/intelligence/blueprints.functions";
import { getNicheDetail, scoreNiche } from "@/lib/intelligence/niches.functions";
import { getTrendRadar } from "@/lib/intelligence/trends.functions";
import {
  ErrorPanel,
  FreshnessLabel,
  InsufficientPanel,
  LoadingGrid,
  ScoreWithFactors,
} from "@/components/intelligence";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/intelligence/niches/$nicheId")({
  component: NicheDetail,
});

function NicheDetail() {
  const { nicheId } = Route.useParams();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const detailFn = useServerFn(getNicheDetail);
  const scoreFn = useServerFn(scoreNiche);
  const genBpFn = useServerFn(generateBlueprint);
  const bpFn = useServerFn(getBlueprint);
  const radarFn = useServerFn(getTrendRadar);

  const detailQ = useQuery({
    queryKey: ["niche-detail", nicheId],
    queryFn: () => detailFn({ data: { nicheId } }),
  });
  const blueprintQ = useQuery({
    queryKey: ["blueprint", nicheId],
    queryFn: () => bpFn({ data: { nicheId } }),
  });
  const trendsQ = useQuery({
    queryKey: ["trend-radar", nicheId],
    queryFn: () => radarFn({ data: { nicheId, max: 5 } }),
  });

  const rescore = useMutation({
    mutationFn: () => scoreFn({ data: { nicheId } }),
    onSuccess: (res) => {
      if (res.status === "ok") {
        toast.success(`${t("intel_score")}: ${Math.round(res.score.score0to100)}`);
        queryClient.invalidateQueries({ queryKey: ["niche-detail", nicheId] });
      } else {
        toast.message(res.reason);
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("intel_error_title")),
  });

  const genBlueprint = useMutation({
    mutationFn: () => genBpFn({ data: { nicheId } }),
    onSuccess: (res) => {
      if (res.status === "ok") {
        toast.success(t("saved"));
        queryClient.invalidateQueries({ queryKey: ["blueprint", nicheId] });
      } else {
        toast.message(res.reason);
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("intel_error_title")),
  });

  if (detailQ.isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <Skeleton className="mb-4 h-8 w-64" />
        <LoadingGrid count={2} />
      </div>
    );
  }
  if (detailQ.isError) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <ErrorPanel
          message={detailQ.error instanceof Error ? detailQ.error.message : t("intel_error_title")}
          onRetry={() => detailQ.refetch()}
        />
      </div>
    );
  }
  const detail = detailQ.data;
  if (!detail || detail.status !== "ok") {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <InsufficientPanel
          reason={detail?.status === "insufficient_data" ? detail.reason : t("intel_error_title")}
        />
      </div>
    );
  }
  const { niche, score, channels, snapshots } = detail;
  const blueprint = blueprintQ.data?.status === "ok" ? blueprintQ.data.blueprint : null;
  const trends = trendsQ.data?.status === "ok" ? trendsQ.data.trends : [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Link to="/intelligence/niches" className="text-sm text-muted-foreground hover:underline">
        ← {t("intel_niches_title")}
      </Link>
      <div className="mb-6 mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{niche.name}</h1>
          <div className="mt-1 flex flex-wrap gap-1">
            {niche.keywords.map((k) => (
              <Badge key={k} variant="secondary">
                {k}
              </Badge>
            ))}
            <Badge variant="outline">{niche.preferred_language}</Badge>
            <Badge variant="outline">{niche.preferred_format}</Badge>
            {niche.min_subs != null && (
              <Badge variant="outline">≥{niche.min_subs.toLocaleString()}</Badge>
            )}
            {niche.max_subs != null && (
              <Badge variant="outline">≤{niche.max_subs.toLocaleString()}</Badge>
            )}
            {niche.active_only && <Badge variant="outline">{t("intel_active_only")}</Badge>}
          </div>
        </div>
        <Button disabled={rescore.isPending} onClick={() => rescore.mutate()}>
          {rescore.isPending ? t("intel_scoring") : t("intel_rescore")}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Score detail */}
        <Card>
          <CardHeader>
            <CardTitle>{t("intel_score")}</CardTitle>
          </CardHeader>
          <CardContent>
            {score ? (
              <ScoreWithFactors score={score} />
            ) : (
              <InsufficientPanel reason={t("intel_never_scored")} />
            )}
          </CardContent>
        </Card>

        {/* Blueprint */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{t("intel_blueprint")}</CardTitle>
              <Button
                size="sm"
                variant="secondary"
                disabled={genBlueprint.isPending}
                onClick={() => genBlueprint.mutate()}
              >
                {genBlueprint.isPending ? t("intel_generating") : t("intel_generate_blueprint")}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {blueprint ? (
              <div className="space-y-4 text-sm">
                <div>
                  <h3 className="font-semibold">{t("intel_positioning")}</h3>
                  <p className="text-muted-foreground">{blueprint.positioning}</p>
                </div>
                <div>
                  <h3 className="font-semibold">{t("intel_audience")}</h3>
                  <p className="text-muted-foreground">{blueprint.audience}</p>
                </div>
                <div>
                  <h3 className="font-semibold">{t("intel_pillars")}</h3>
                  <ul className="mt-1 space-y-2">
                    {blueprint.pillars.map((p) => (
                      <li key={p.name} className="rounded-md border p-2">
                        <div className="font-medium">{p.name}</div>
                        <p className="text-muted-foreground">{p.description}</p>
                        <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                          {p.exampleTitles.map((ex) => (
                            <li key={ex}>{ex}</li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="font-semibold">{t("intel_formats")}</h3>
                  <ul className="list-disc pl-5 text-muted-foreground">
                    {blueprint.formats.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="font-semibold">
                    {t("intel_cadence")} — {blueprint.cadence.videosPerWeek}/wk
                  </h3>
                  <p className="text-muted-foreground">{blueprint.cadence.rationale}</p>
                </div>
                <div>
                  <h3 className="font-semibold">{t("intel_differentiators")}</h3>
                  <ul className="list-disc pl-5 text-muted-foreground">
                    {blueprint.differentiators.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("intel_rule_based")} · {new Date(blueprint.generatedAt).toLocaleString()}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("intel_no_blueprint")}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tracked channels */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>
            {t("intel_tracked_channels")} ({channels.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {channels.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("intel_no_channels")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">Channel</th>
                    <th className="py-2 pr-4">{t("intel_subs")}</th>
                    <th className="py-2 pr-4">{t("intel_growth_7d")}</th>
                    <th className="py-2 pr-4">{t("intel_freshness")}</th>
                  </tr>
                </thead>
                <tbody>
                  {channels.map((c) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">
                        <div className="font-medium">
                          {c.title ?? c.handle ?? c.externalChannelId}
                        </div>
                        {c.handle && (
                          <div className="text-xs text-muted-foreground">{c.handle}</div>
                        )}
                      </td>
                      <td className="py-2 pr-4 tabular-nums">
                        {c.subscriberCount != null ? c.subscriberCount.toLocaleString() : "—"}
                      </td>
                      <td className="py-2 pr-4 tabular-nums">
                        {c.growth7dPct != null
                          ? `${c.growth7dPct >= 0 ? "+" : ""}${c.growth7dPct.toFixed(1)}%`
                          : "—"}
                      </td>
                      <td className="py-2 pr-4">
                        <FreshnessLabel
                          capturedAt={c.freshness.capturedAt}
                          staleAfterHours={c.freshness.staleAfterHours}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Trends for this niche */}
        <Card>
          <CardHeader>
            <CardTitle>{t("intel_trends_title")}</CardTitle>
          </CardHeader>
          <CardContent>
            {trendsQ.isLoading ? (
              <Skeleton className="h-24" />
            ) : trends.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("intel_no_trends")}</p>
            ) : (
              <ul className="space-y-2">
                {trends.map((tr) => (
                  <li key={tr.id} className="rounded-md border p-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{tr.topic}</span>
                      <Badge>{Math.round(tr.score0to100)}</Badge>
                    </div>
                    {tr.sources[0] && (
                      <a
                        href={tr.sources[0].url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-muted-foreground hover:underline"
                      >
                        {t("intel_sources")}: {tr.sources[0].title}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Score history */}
        <Card>
          <CardHeader>
            <CardTitle>{t("intel_score_history")}</CardTitle>
          </CardHeader>
          <CardContent>
            {snapshots.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("intel_no_history")}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {snapshots.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between rounded-md border p-2"
                  >
                    <span className="text-muted-foreground">
                      {new Date(s.captured_at).toLocaleString()}
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge variant="outline">{s.source}</Badge>
                      <span className="font-semibold tabular-nums">
                        {Math.round(s.score?.score0to100 ?? 0)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
