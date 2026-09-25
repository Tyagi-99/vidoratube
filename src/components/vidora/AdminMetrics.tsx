/**
 * Sprint 7-8: admin growth + NPS panels.
 *
 * Every metric is computed from real tables (see src/lib/growth-metrics.ts)
 * and degrades to an honest "No data yet" state — never a fabricated number.
 */

import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Skeleton } from "@/components/ui/skeleton";
import { adminGrowthMetrics, adminNpsResults } from "@/lib/admin.functions";
import { RENDER_SUCCESS_TARGET } from "@/lib/growth-metrics";

const NO_DATA = "No data yet";

function Metric(props: { label: string; value: string | null; hint?: string | undefined }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{props.label}</p>
      {props.value == null ? (
        <p className="mt-1 text-sm text-muted-foreground">{NO_DATA}</p>
      ) : (
        <p className="mt-1 text-2xl font-bold text-foreground">{props.value}</p>
      )}
      {props.hint && <p className="mt-1 text-xs text-muted-foreground">{props.hint}</p>}
    </div>
  );
}

const pct = (n: number | null, digits = 1) => (n == null ? null : `${(n * 100).toFixed(digits)}%`);

export function GrowthMetricsPanel() {
  const fn = useServerFn(adminGrowthMetrics);
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "growth-metrics"],
    queryFn: () => fn({}),
  });

  const latestMonth = data?.signups.hasData
    ? data.signups.byMonth[data.signups.byMonth.length - 1]
    : undefined;
  const storyCost = data?.costPerMode.find((c) => c.mode === "story");
  const cinemaCost = data?.costPerMode.find((c) => c.mode === "cinema");

  return (
    <div className="mt-10">
      <h2 className="text-lg font-bold tracking-tight text-foreground">Growth metrics</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Signups, activation, retention, revenue, render health, and publishing output — all from live tables.
      </p>
      <div className="surface-card mt-4 p-5">
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : !data ? (
          <p className="text-sm text-muted-foreground">Couldn&apos;t load growth metrics.</p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Signups / month"
              value={latestMonth ? `${latestMonth.count} (${latestMonth.month})` : null}
              hint={data.signups.hasData ? `${data.signups.total} total` : undefined}
            />
            <Metric
              label="Activation (24h)"
              value={pct(data.activation.rate)}
              hint="first render or publish within 24h of signup"
            />
            <Metric label="D7 retention" value={pct(data.retention.d7.rate)} />
            <Metric label="D30 retention" value={pct(data.retention.d30.rate)} />
            <Metric label="Free → paid" value={pct(data.conversion.rate)} />
            <Metric
              label="MRR"
              value={data.mrr.hasData ? `$${data.mrr.mrrUsd.toFixed(2)}` : null}
              hint={`${data.mrr.activeSubscriptions} active/trialing subs · packs excluded`}
            />
            <Metric
              label="Render success"
              value={pct(data.renderQuality.successRate, 2)}
              hint={`target ≥ ${(RENDER_SUCCESS_TARGET * 100).toFixed(0)}%`}
            />
            <Metric
              label="p95 render time / min"
              value={
                data.p95.p95MinutesPerOutputMinute != null
                  ? `${data.p95.p95MinutesPerOutputMinute.toFixed(1)} min`
                  : null
              }
              hint={`${data.p95.samples} samples`}
            />
            <Metric
              label="Cost / finished min"
              value={
                storyCost?.costPerMinuteUsd != null || cinemaCost?.costPerMinuteUsd != null
                  ? `story $${storyCost?.costPerMinuteUsd?.toFixed(4) ?? "—"} · cinema $${cinemaCost?.costPerMinuteUsd?.toFixed(4) ?? "—"}`
                  : null
              }
              hint="measured provider cost"
            />
            <Metric
              label="Videos published"
              value={data.publishing.hasData ? String(data.publishing.videosPublished) : null}
            />
            <Metric label="Localized" value={pct(data.publishing.localizedPct)} hint="share of published videos" />
            <Metric
              label="Avg languages"
              value={
                data.publishing.avgLanguagesPerPublishedVideo != null
                  ? data.publishing.avgLanguagesPerPublishedVideo.toFixed(1)
                  : null
              }
              hint="per localized published video"
            />
            <Metric
              label="Shorts / long video"
              value={data.publishing.shortsPerLongVideo != null ? data.publishing.shortsPerLongVideo.toFixed(1) : null}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function NpsPanel() {
  const fn = useServerFn(adminNpsResults);
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "nps"],
    queryFn: () => fn({}),
  });

  const summary = data?.summary;

  return (
    <div className="mt-10">
      <h2 className="text-lg font-bold tracking-tight text-foreground">NPS</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Net Promoter Score from in-app responses. Prompts go out only after a completed render, at most every 90 days.
      </p>
      <div className="surface-card mt-4 p-5">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !data || !summary ? (
          <p className="text-sm text-muted-foreground">Couldn&apos;t load NPS results.</p>
        ) : summary.nps == null ? (
          <p className="text-sm text-muted-foreground">{NO_DATA} — no NPS responses recorded yet.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-end gap-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">NPS</p>
                <p className="mt-1 text-4xl font-bold text-foreground">{summary.nps}</p>
              </div>
              <div className="flex gap-4 pb-1 text-sm text-muted-foreground">
                <span>{summary.promoters} promoters</span>
                <span>{summary.passives} passives</span>
                <span>{summary.detractors} detractors</span>
              </div>
            </div>
            {data.comments.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Recent comments
                </p>
                <ul className="mt-2 space-y-2">
                  {data.comments.map((c, i) => (
                    <li key={`${c.createdAt}-${i}`} className="rounded-xl border border-border p-3 text-sm">
                      <span className="mr-2 inline-block rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">
                        {c.score}
                      </span>
                      <span className="text-foreground">{c.comment}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
