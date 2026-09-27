/**
 * F11 Evidence Desk — claim review surface.
 *
 * Lists every claim linked to the project's sources with its verdict,
 * human review state, and supporting sources. The reviewer explicitly
 * CONFIRMs or WAIVEs each claim (with an optional note); nothing is ever
 * auto-approved. Strict-mode toggle + gate banner show whether publishing
 * and package export are currently blocked (D99: only CONFIRMED satisfies
 * strict mode — waived still blocks).
 *
 * "Extract claims" runs the deterministic extractor over the current
 * script draft and shows CANDIDATES — the reviewer adds the real ones.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Check,
  ExternalLink,
  Loader2,
  Minus,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import {
  extractScriptClaims,
  getEvidenceDesk,
  saveEvidenceClaims,
  setClaimReview,
  setResearchStrictMode,
} from "@/lib/creation/claims/evidence.functions";
import {
  REVIEW_STATE_COPY,
  VERDICT_COPY,
  type ClaimVerdict,
  type ClaimWithSources,
  type ExtractedClaim,
} from "@/lib/creation/claims/types";
import type { ClaimExtraction } from "@/lib/creation/claims/evidence.functions";

const REVIEW_BADGE: Record<string, string> = {
  unreviewed: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  confirmed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  waived: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

function ClaimRow({
  claim,
  onReview,
  reviewing,
}: {
  claim: ClaimWithSources;
  onReview: (claimId: string, state: "confirmed" | "waived", note: string) => void;
  reviewing: boolean;
}) {
  const { t } = useI18n();
  const [note, setNote] = useState("");
  const review = REVIEW_STATE_COPY[claim.review_state];
  const verdict = VERDICT_COPY[claim.verdict];
  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm font-medium text-foreground">{claim.claim}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge className={REVIEW_BADGE[claim.review_state]} title={review.hint}>
          {review.label}
        </Badge>
        <Badge variant="outline" title={verdict.hint}>
          {t("desk_verdict")}: {verdict.label}
        </Badge>
        {claim.sources.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            {t("desk_source")}:{" "}
            {s.url ? (
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 hover:underline"
              >
                {s.title}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              s.title
            )}
          </span>
        ))}
      </div>
      {claim.reviewed_at && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("desk_reviewed")}: {new Date(claim.reviewed_at).toLocaleString()}
          {claim.review_note ? ` — ${claim.review_note}` : ""}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder={t("desk_note_placeholder")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={300}
          disabled={reviewing}
        />
        <Button
          size="sm"
          className="gap-1.5"
          disabled={reviewing || claim.review_state === "confirmed"}
          onClick={() => onReview(claim.id, "confirmed", note.trim())}
        >
          <Check className="h-3.5 w-3.5" />
          {t("desk_confirm")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={reviewing || claim.review_state === "waived"}
          onClick={() => onReview(claim.id, "waived", note.trim())}
        >
          <Minus className="h-3.5 w-3.5" />
          {t("desk_waive")}
        </Button>
      </div>
    </div>
  );
}

function CandidateCard({
  candidate,
  onAdd,
  adding,
}: {
  candidate: ExtractedClaim;
  onAdd: (sourceId: string, verdict: ClaimVerdict) => void;
  adding: boolean;
}) {
  const { t } = useI18n();
  const [sourceId, setSourceId] = useState(candidate.matches[0]?.sourceId ?? "");
  const [verdict, setVerdict] = useState<ClaimVerdict>("unsupported");
  return (
    <div className="rounded-lg border border-dashed p-4">
      <p className="text-sm text-foreground">{candidate.text}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("desk_flagged_because")}: {candidate.reasons.join(", ")}
      </p>
      {candidate.matches.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          <Label className="text-xs">{t("desk_pick_source")}</Label>
          <Select value={sourceId} onValueChange={setSourceId}>
            <SelectTrigger className="max-w-md">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {candidate.matches.map((m) => (
                <SelectItem key={m.sourceId} value={m.sourceId}>
                  {m.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">{t("desk_no_source_match")}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Select value={verdict} onValueChange={(v) => setVerdict(v as ClaimVerdict)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(VERDICT_COPY) as ClaimVerdict[]).map((v) => (
              <SelectItem key={v} value={v} title={VERDICT_COPY[v].hint}>
                {VERDICT_COPY[v].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          disabled={adding || !sourceId}
          onClick={() => onAdd(sourceId, verdict)}
          className="gap-1.5"
        >
          {adding && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t("desk_add_claim")}
        </Button>
      </div>
    </div>
  );
}

export function EvidenceDesk({ projectId, scriptId }: { projectId: string; scriptId?: string }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const deskFn = useServerFn(getEvidenceDesk);
  const extractFn = useServerFn(extractScriptClaims);
  const saveFn = useServerFn(saveEvidenceClaims);
  const reviewFn = useServerFn(setClaimReview);
  const strictFn = useServerFn(setResearchStrictMode);

  const [extraction, setExtraction] = useState<ClaimExtraction | null>(null);
  const [addedTexts, setAddedTexts] = useState<Set<string>>(new Set());

  const desk = useQuery({
    queryKey: ["evidence-desk", projectId],
    queryFn: () => deskFn({ data: { projectId } }),
  });
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["evidence-desk", projectId] });

  const extractMut = useMutation({
    mutationFn: () => extractFn({ data: { scriptId: scriptId! } }),
    onSuccess: (res) => {
      setExtraction(res);
      setAddedTexts(new Set());
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("desk_error")),
  });

  const saveMut = useMutation({
    mutationFn: ({
      claim,
      sourceId,
      verdict,
    }: {
      claim: string;
      sourceId: string;
      verdict: ClaimVerdict;
    }) => saveFn({ data: { projectId, claims: [{ claim, sourceId, verdict }] } }),
    onSuccess: (_, vars) => {
      setAddedTexts((prev) => new Set(prev).add(vars.claim));
      invalidate();
      // The gate state on the project page also changes.
      queryClient.invalidateQueries({ queryKey: ["project-gate", projectId] });
      toast.success(t("desk_claim_added"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("desk_error")),
  });

  const reviewMut = useMutation({
    mutationFn: ({
      claimId,
      state,
      note,
    }: {
      claimId: string;
      state: "confirmed" | "waived";
      note: string;
    }) => reviewFn({ data: { claimId, reviewState: state, note } }),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["project-gate", projectId] });
      toast.success(t("desk_review_saved"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("desk_error")),
  });

  const strictMut = useMutation({
    mutationFn: (enabled: boolean) => strictFn({ data: { projectId, enabled } }),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["project-gate", projectId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("desk_error")),
  });

  const state = desk.data;
  const gate = state?.gate;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("desk_title")}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t("desk_subtitle")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {desk.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("desk_loading")}
          </div>
        )}
        {desk.isError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <p className="text-destructive">{t("desk_error")}</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => desk.refetch()}>
              {t("desk_retry")}
            </Button>
          </div>
        )}
        {state && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ShieldAlert className="h-4 w-4" />
                  {t("desk_strict")}
                </div>
                <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">
                  {t("desk_strict_hint")}
                </p>
              </div>
              <Switch
                checked={state.strictMode}
                disabled={strictMut.isPending}
                onCheckedChange={(v) => strictMut.mutate(v)}
                aria-label={t("desk_strict")}
              />
            </div>

            {gate && state.strictMode && (
              <div
                className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
                  gate.blocked
                    ? "border-destructive/40 bg-destructive/5"
                    : "border-green-600/30 bg-green-50/50 dark:bg-green-950/20"
                }`}
              >
                {gate.blocked ? (
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                ) : (
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-700 dark:text-green-300" />
                )}
                <p className={gate.blocked ? "text-destructive" : ""}>{gate.message}</p>
              </div>
            )}

            {scriptId && (
              <div>
                <Button
                  variant="outline"
                  className="gap-1.5"
                  disabled={extractMut.isPending}
                  onClick={() => extractMut.mutate()}
                >
                  {extractMut.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ScanSearch className="h-4 w-4" />
                  )}
                  {extractMut.isPending ? t("desk_extracting") : t("desk_extract")}
                </Button>
                {extraction && (
                  <div className="mt-3 space-y-3">
                    <p className="text-sm font-medium">
                      {t("desk_candidates_title")} ({extraction.candidates.length})
                    </p>
                    <p className="text-xs text-muted-foreground">{t("desk_candidate_hint")}</p>
                    {extraction.candidates.length === 0 && (
                      <p className="text-sm text-muted-foreground">{t("desk_no_candidates")}</p>
                    )}
                    {extraction.candidates
                      .filter((c) => !addedTexts.has(c.text))
                      .map((c) => (
                        <CandidateCard
                          key={c.text}
                          candidate={c}
                          adding={saveMut.isPending}
                          onAdd={(sourceId, verdict) =>
                            saveMut.mutate({ claim: c.text, sourceId, verdict })
                          }
                        />
                      ))}
                  </div>
                )}
              </div>
            )}

            {state.claims.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center">
                <p className="font-medium text-foreground">{t("desk_no_claims_title")}</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  {t("desk_no_claims_body")}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {state.claims.map((c) => (
                  <ClaimRow
                    key={c.id}
                    claim={c}
                    reviewing={reviewMut.isPending}
                    onReview={(claimId, reviewState, note) =>
                      reviewMut.mutate({ claimId, state: reviewState, note })
                    }
                  />
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
