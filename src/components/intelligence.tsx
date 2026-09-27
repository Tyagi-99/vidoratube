/**
 * Stream B — shared presentational components for the intelligence pages.
 * No data fetching here; pages own their queries.
 */
import { useI18n } from "@/lib/i18n";
import type { Confidence, NicheScore, ScoreFactor } from "@/lib/intelligence/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

/* ------------------------------------------------------------------ */

export function ScoreRing({ score }: { score: number }) {
  const hue = Math.round((score / 100) * 120); // red → green
  return (
    <div
      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-bold"
      style={{
        background: `conic-gradient(hsl(${hue} 70% 45%) ${score * 3.6}deg, hsl(0 0% 88%) 0deg)`,
      }}
      aria-label={`Score ${score} of 100`}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-background">
        {Math.round(score)}
      </span>
    </div>
  );
}

const confidenceVariant: Record<Confidence, "default" | "secondary" | "outline"> = {
  high: "default",
  medium: "secondary",
  low: "outline",
};

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const { t } = useI18n();
  return (
    <Badge variant={confidenceVariant[confidence]}>
      {t("intel_confidence")}: {confidence}
    </Badge>
  );
}

/** "Fresh" when capturedAt is within staleAfterHours, else "Stale". */
export function FreshnessLabel({
  capturedAt,
  staleAfterHours,
}: {
  capturedAt: string | null;
  staleAfterHours: number;
}) {
  const { t } = useI18n();
  if (!capturedAt) return <Badge variant="outline">{t("intel_never_scored")}</Badge>;
  const ageH = (Date.now() - new Date(capturedAt).getTime()) / 3_600_000;
  const fresh = ageH <= staleAfterHours;
  return (
    <Badge variant={fresh ? "default" : "outline"} title={new Date(capturedAt).toLocaleString()}>
      {fresh ? t("intel_fresh") : t("intel_stale")} · {Math.max(0, Math.round(ageH))}h
    </Badge>
  );
}

/**
 * Score is NEVER rendered without its factors — this component enforces it:
 * the expandable factor list always accompanies the score.
 */
export function ScoreWithFactors({ score }: { score: NicheScore }) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <ScoreRing score={score.score0to100} />
        <div className="space-y-1">
          <ConfidenceBadge confidence={score.confidence} />
          <div className="text-xs text-muted-foreground">
            {score.channelCount} {t("intel_channels")} · {t("intel_last_scored")}:{" "}
            {new Date(score.capturedAt).toLocaleString()}
          </div>
        </div>
      </div>
      <Accordion type="single" collapsible>
        <AccordionItem value="factors">
          <AccordionTrigger className="py-2 text-sm">{t("intel_factors")}</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-3">
              {score.factors.map((f: ScoreFactor) => (
                <div key={f.key} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">
                      {f.label}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {Math.round(f.weight * 100)}%
                      </span>
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
              <p className="border-t pt-2 text-xs text-muted-foreground">
                <span className="font-medium">{t("intel_rule_based")}</span> —{" "}
                {t("intel_rule_based_desc")}
              </p>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page states                                                         */
/* ------------------------------------------------------------------ */

export function LoadingGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-40" />
      ))}
    </div>
  );
}

export function UnconfiguredPanel() {
  const { t } = useI18n();
  return (
    <Card className="border-dashed">
      <CardContent className="py-12 text-center">
        <h2 className="mb-2 text-lg font-semibold">{t("intel_unconfigured_title")}</h2>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          {t("intel_unconfigured_desc")}
        </p>
      </CardContent>
    </Card>
  );
}

export function InsufficientPanel({ reason }: { reason: string }) {
  const { t } = useI18n();
  return (
    <Card className="border-dashed">
      <CardContent className="py-12 text-center">
        <h2 className="mb-2 text-lg font-semibold">{t("intel_insufficient_title")}</h2>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">{reason}</p>
      </CardContent>
    </Card>
  );
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <Card className="border-destructive/40">
      <CardContent className="py-12 text-center">
        <h2 className="mb-2 text-lg font-semibold">{t("intel_error_title")}</h2>
        <p className="mx-auto mb-4 max-w-md text-sm text-muted-foreground">{message}</p>
        <Button variant="outline" onClick={onRetry}>
          {t("intel_retry")}
        </Button>
      </CardContent>
    </Card>
  );
}
