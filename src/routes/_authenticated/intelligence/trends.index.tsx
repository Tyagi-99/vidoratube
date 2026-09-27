/**
 * Stream B — /intelligence/trends (F6 Trend Radar).
 * Trend cards with scores, confidence, and mandatory cited sources.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useI18n } from "@/lib/i18n";
import { getIntelligenceStatus, listNiches } from "@/lib/intelligence/niches.functions";
import { getTrendRadar, type TrendEnvelope } from "@/lib/intelligence/trends.functions";
import {
  ConfidenceBadge,
  ErrorPanel,
  InsufficientPanel,
  LoadingGrid,
  ScoreRing,
  UnconfiguredPanel,
} from "@/components/intelligence";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export const Route = createFileRoute("/_authenticated/intelligence/trends/")({
  component: TrendsIndex,
});

function TrendsIndex() {
  const { t } = useI18n();
  const statusFn = useServerFn(getIntelligenceStatus);
  const listFn = useServerFn(listNiches);
  const radarFn = useServerFn(getTrendRadar);
  const [nicheId, setNicheId] = useState<string>("all");

  const statusQ = useQuery({ queryKey: ["intel-status"], queryFn: () => statusFn() });
  const nichesQ = useQuery({ queryKey: ["niches"], queryFn: () => listFn() });
  const radarQ = useQuery<TrendEnvelope>({
    queryKey: ["trend-radar", nicheId],
    queryFn: () => radarFn({ data: { nicheId: nicheId === "all" ? undefined : nicheId, max: 20 } }),
  });

  const niches = nichesQ.data?.status === "ok" ? nichesQ.data.niches : [];
  const radar = radarQ.data;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("intel_trends_title")}</h1>
          <p className="text-muted-foreground">{t("intel_trends_subtitle")}</p>
        </div>
        <div>
          <Label className="text-xs">Niche</Label>
          <Select value={nicheId} onValueChange={setNicheId}>
            <SelectTrigger className="w-56">
              <SelectValue />
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
        </div>
      </div>

      {statusQ.data && !statusQ.data.youtubeConfigured ? (
        <UnconfiguredPanel />
      ) : radarQ.isLoading || statusQ.isLoading ? (
        <LoadingGrid />
      ) : radarQ.isError ? (
        <ErrorPanel
          message={radarQ.error instanceof Error ? radarQ.error.message : t("intel_error_title")}
          onRetry={() => radarQ.refetch()}
        />
      ) : !radar || radar.status !== "ok" ? (
        <InsufficientPanel reason={radar ? radar.reason : t("intel_no_trends")} />
      ) : (
        <>
          <p className="mb-3 text-xs text-muted-foreground">
            {t("intel_rule_based")} ·{" "}
            {radar.generatedAt ? new Date(radar.generatedAt).toLocaleString() : ""}
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {radar.trends.map((tr) => (
              <Card key={tr.id} data-testid="trend-row">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-base leading-snug">{tr.topic}</CardTitle>
                    <ScoreRing score={tr.score0to100} />
                  </div>
                  <div className="flex items-center gap-2">
                    <ConfidenceBadge confidence={tr.confidence} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Accordion type="single" collapsible>
                    <AccordionItem value="factors">
                      <AccordionTrigger className="py-2 text-sm">
                        {t("intel_factors")}
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2">
                          {tr.factors.map((f) => (
                            <div key={f.key} className="space-y-1">
                              <div className="flex items-center justify-between text-sm">
                                <span className="font-medium">
                                  {f.label}
                                  {f.evidenceCount === 0 && (
                                    <Badge variant="outline" className="ml-2">
                                      {t("intel_weak_evidence")}
                                    </Badge>
                                  )}
                                </span>
                                <span className="tabular-nums">{Math.round(f.value)}</span>
                              </div>
                              <Progress value={f.value} className="h-1.5" />
                              <p className="text-xs text-muted-foreground">{f.detail}</p>
                            </div>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                  <div className="border-t pt-2">
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("intel_sources")}
                    </h3>
                    <ul className="space-y-1">
                      {tr.sources.map((s) => (
                        <li key={s.url} className="text-sm">
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:underline"
                          >
                            {s.title}
                          </a>
                          {s.publishedAt && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {new Date(s.publishedAt).toLocaleDateString()}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
