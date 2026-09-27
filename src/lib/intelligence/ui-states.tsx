/**
 * Stream C — shared presentational states for the Intelligence pages.
 *
 * Every page renders the same honest state vocabulary: loading skeleton,
 * empty, error, unconfigured (YouTube API not connected), and
 * insufficient-data. Estimates and weak evidence are always labeled.
 */
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Database, Info, PlugZap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Confidence, ScoreFactor } from "./types";

/* ------------------------------------------------------------------ */

export function timeAgo(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="space-y-3">
          <Skeleton className="aspect-video w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
        <Database className="h-8 w-8 text-muted-foreground" />
        <p className="font-medium">{title}</p>
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
        {action}
      </CardContent>
    </Card>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="border-destructive/50">
      <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <p className="font-medium">Something went wrong</p>
        <p className="max-w-md text-sm text-muted-foreground">{message}</p>
        {onRetry && (
          <Button variant="outline" onClick={onRetry}>
            Retry
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function UnconfiguredPanel({ reason }: { reason?: string }) {
  return (
    <Card className="border-amber-500/40">
      <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
        <PlugZap className="h-8 w-8 text-amber-500" />
        <p className="font-medium">YouTube Data API not connected</p>
        <p className="max-w-md text-sm text-muted-foreground">
          {reason ??
            "Connect your YouTube Data API key to enable channel tracking, snapshots, and outlier detection."}
        </p>
        <Button asChild>
          <Link to="/admin/integrations">Open Integrations</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function InsufficientDataPanel({ reason }: { reason: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
        <Info className="h-8 w-8 text-muted-foreground" />
        <Badge variant="outline" className="tracking-widest">
          INSUFFICIENT DATA
        </Badge>
        <p className="max-w-md text-sm text-muted-foreground">{reason}</p>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

const confidenceStyles: Record<Confidence, string> = {
  high: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  medium: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  low: "bg-slate-500/15 text-slate-500 border-slate-500/30",
};

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <Badge variant="outline" className={confidenceStyles[confidence]} title="Confidence in this score, based on how much snapshot evidence backs it">
      {confidence} confidence
    </Badge>
  );
}

export function ScoreBadge({ score }: { score: number }) {
  return (
    <Badge
      className="bg-primary text-primary-foreground"
      title="Multiple of the channel's median views — descriptive, not a prediction"
    >
      {score.toFixed(1)}× median
    </Badge>
  );
}

export function WeakEvidenceBadge() {
  return (
    <Badge
      variant="outline"
      className="border-amber-500/40 text-amber-600"
      title="This factor is based on little or no data"
    >
      weak evidence
    </Badge>
  );
}

export function EstimateBadge() {
  return (
    <Badge
      variant="outline"
      className="border-sky-500/40 text-sky-600"
      title="Derived from a heuristic, not measured directly"
    >
      ESTIMATE
    </Badge>
  );
}

export function FreshnessLabel({
  capturedAt,
  staleAfterHours,
}: {
  capturedAt: string | null;
  staleAfterHours: number;
}) {
  const ago = timeAgo(capturedAt);
  if (!ago) return <span className="text-xs text-muted-foreground">No data captured yet</span>;
  const stale =
    capturedAt != null &&
    Date.now() - new Date(capturedAt).getTime() > staleAfterHours * 3_600_000;
  return (
    <span className={`text-xs ${stale ? "font-medium text-amber-600" : "text-muted-foreground"}`}>
      {stale ? `STALE — updated ${ago}` : `Updated ${ago}`}
    </span>
  );
}

/* ------------------------------------------------------------------ */

export function FactorDetails({ factors }: { factors: ScoreFactor[] }) {
  return (
    <details className="group rounded-md border p-3 text-sm">
      <summary className="cursor-pointer font-medium text-muted-foreground group-open:mb-2">
        Why this score? ({factors.length} factors)
      </summary>
      <ul className="space-y-2">
        {factors.map((f) => (
          <li key={f.key} className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{f.label}</span>
                {f.evidenceCount === 0 && <WeakEvidenceBadge />}
              </div>
              <p className="text-xs text-muted-foreground">{f.detail}</p>
            </div>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {f.value}/100 · w{f.weight}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

export function formatNumber(v: number | null): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v);
}
