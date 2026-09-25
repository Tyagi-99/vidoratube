import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  History,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import {
  BAND_LABEL,
  SAFETY_DISCLAIMER,
  type SafetyBand,
  type SafetyIssue,
} from "@/lib/safety";
import {
  getSafetyScore,
  requestDeepReview,
  rewriteFlaggedSpan,
  scoreProject,
  updateProjectScript,
} from "@/lib/safety.functions";

const BAND_STYLES: Record<SafetyBand, { badge: string; ring: string; icon: typeof ShieldCheck }> = {
  safe: { badge: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300", ring: "#16a34a", icon: ShieldCheck },
  minor: { badge: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300", ring: "#ca8a04", icon: ShieldCheck },
  "at-risk": { badge: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300", ring: "#ea580c", icon: AlertTriangle },
  "high-risk": { badge: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300", ring: "#dc2626", icon: ShieldAlert },
};

const DIMENSION_LABELS: Record<string, string> = {
  advertiser: "Advertiser-friendliness",
  copyright: "Copyright risk",
  originality: "Originality",
  metadata: "Metadata honesty",
  policy: "Policy compliance",
};

const SEVERITY_STYLES: Record<string, string> = {
  info: "border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20",
  warning: "border-yellow-200 bg-yellow-50/50 dark:border-yellow-900 dark:bg-yellow-950/20",
  critical: "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20",
};

function ScoreDial({ score, band }: { score: number; band: SafetyBand }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const filled = (score / 100) * c;
  const style = BAND_STYLES[band];
  return (
    <div className="relative h-28 w-28 shrink-0">
      <svg viewBox="0 0 104 104" className="h-full w-full -rotate-90">
        <circle cx="52" cy="52" r={r} fill="none" stroke="currentColor" strokeWidth="10" className="text-muted/40" />
        <circle
          cx="52"
          cy="52"
          r={r}
          fill="none"
          stroke={style.ring}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tabular-nums">{score}</span>
        <span className="text-xs text-muted-foreground">/ 100</span>
      </div>
    </div>
  );
}

export function SafetyPanel({ projectId, script }: { projectId: string; script: string }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const scoreFn = useServerFn(scoreProject);
  const getFn = useServerFn(getSafetyScore);
  const deepFn = useServerFn(requestDeepReview);
  const rewriteFn = useServerFn(rewriteFlaggedSpan);
  const saveScriptFn = useServerFn(updateProjectScript);
  const [showHistory, setShowHistory] = useState(false);
  const [fixingIdx, setFixingIdx] = useState<number | null>(null);

  const safety = useQuery({
    queryKey: ["safety", projectId],
    queryFn: () => getFn({ data: { project_id: projectId } }),
  });
  const latest = safety.data?.latest as {
    id: string;
    score: number;
    band: SafetyBand;
    dimensions: Record<string, { points: number; maxPoints: number }>;
    issues: SafetyIssue[];
    ai_review: { issues: { severity: string; message: string; suggestion: string }[]; label: string } | null;
    created_at: string;
  } | null;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["safety", projectId] });
    queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  };

  const runScore = useMutation({
    mutationFn: () => scoreFn({ data: { project_id: projectId } }),
    onSuccess: () => {
      invalidate();
      toast.success(t("safety_check_done"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deepReview = useMutation({
    mutationFn: () => deepFn({ data: { project_id: projectId } }),
    onSuccess: () => {
      invalidate();
      toast.success(t("safety_deep_done"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const fixWithAI = async (issue: SafetyIssue, idx: number) => {
    if (!issue.span) return;
    setFixingIdx(idx);
    try {
      const { rewritten, start, end } = await rewriteFn({
        data: {
          project_id: projectId,
          start: issue.span[0],
          end: issue.span[1],
        },
      });
      const next = script.slice(0, start) + rewritten + script.slice(end);
      await saveScriptFn({ data: { project_id: projectId, script: next } });
      invalidate();
      toast.success(t("safety_fix_applied"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fix failed");
    } finally {
      setFixingIdx(null);
    }
  };

  const band = latest?.band;
  const BandIcon = band ? BAND_STYLES[band].icon : ShieldCheck;

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-primary" />
          {t("safety_title")}
        </h3>
        <Button
          size="sm"
          variant={latest ? "outline" : "default"}
          disabled={runScore.isPending}
          onClick={() => runScore.mutate()}
        >
          {runScore.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
          {latest ? t("safety_recheck") : t("safety_run")}
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t("safety_subtitle")}</p>

      {safety.isLoading && (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}
        </div>
      )}

      {!safety.isLoading && !latest && (
        <p className="mt-4 text-sm text-muted-foreground">{t("safety_empty")}</p>
      )}

      {latest && band && (
        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-4">
            <ScoreDial score={latest.score} band={band} />
            <div className="min-w-0">
              <Badge className={BAND_STYLES[band].badge}>
                <BandIcon className="mr-1 h-3 w-3" />
                {BAND_LABEL[band]}
              </Badge>
              <p className="mt-2 text-xs text-muted-foreground">
                {t("safety_checked_at")}{" "}
                {new Date(latest.created_at).toLocaleString()}
              </p>
              {latest.score >= 50 && latest.score < 90 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  disabled={deepReview.isPending}
                  onClick={() => deepReview.mutate()}
                >
                  {deepReview.isPending ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Wand2 className="mr-1 h-4 w-4" />
                  )}
                  {t("safety_deep_review")}
                </Button>
              )}
            </div>
          </div>

          {/* Dimension bars */}
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(latest.dimensions ?? {}).map(([dim, d]) => {
              const pct = d.maxPoints > 0 ? Math.round((d.points / d.maxPoints) * 100) : 100;
              return (
                <div key={dim} className="text-xs">
                  <div className="mb-1 flex justify-between">
                    <span className="font-medium">{DIMENSION_LABELS[dim] ?? dim}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {d.points}/{d.maxPoints}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: pct >= 90 ? "#16a34a" : pct >= 70 ? "#ca8a04" : pct >= 50 ? "#ea580c" : "#dc2626",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Issues */}
          {(latest.issues ?? []).length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("safety_issues")} ({latest.issues.length})
              </h4>
              {latest.issues.map((issue, i) => (
                <div key={i} className={`rounded-lg border p-3 text-sm ${SEVERITY_STYLES[issue.severity] ?? ""}`}>
                  <p className="font-medium">{issue.message}</p>
                  {issue.suggestion && (
                    <p className="mt-1 text-xs text-muted-foreground">{issue.suggestion}</p>
                  )}
                  {issue.span && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      disabled={fixingIdx !== null}
                      onClick={() => fixWithAI(issue, i)}
                    >
                      {fixingIdx === i ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <Wand2 className="mr-1 h-3 w-3" />
                      )}
                      {t("safety_fix_with_ai")}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* AI deep review results */}
          {latest.ai_review && (
            <div className="space-y-2 rounded-lg border border-dashed p-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("safety_ai_review_title")}
              </h4>
              <p className="text-xs italic text-muted-foreground">{latest.ai_review.label}</p>
              {(latest.ai_review.issues ?? []).map((ai, i) => (
                <div key={i} className="text-sm">
                  <p className="font-medium">
                    <Badge variant="outline" className="mr-1">{ai.severity}</Badge>
                    {ai.message}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{ai.suggestion}</p>
                </div>
              ))}
            </div>
          )}

          {/* History */}
          {(safety.data?.history ?? []).length > 1 && (
            <div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowHistory((v) => !v)}
                className="gap-1"
              >
                <History className="h-3 w-3" />
                {t("safety_history")} ({(safety.data?.history ?? []).length})
              </Button>
              {showHistory && (
                <div className="mt-2 space-y-1">
                  {(safety.data?.history ?? []).map((h: { id: string; score: number; band: string; created_at: string }) => {
                    const hb = h.band as SafetyBand;
                    return (
                      <div key={h.id} className="flex items-center justify-between rounded border px-3 py-1.5 text-xs">
                        <span className="tabular-nums font-semibold">{h.score}/100</span>
                        <Badge className={BAND_STYLES[hb]?.badge}>{BAND_LABEL[hb]}</Badge>
                        <span className="text-muted-foreground">
                          {new Date(h.created_at).toLocaleString()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <p className="text-[11px] italic text-muted-foreground">{SAFETY_DISCLAIMER}</p>
        </div>
      )}
    </div>
  );
}
