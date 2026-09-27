/**
 * F12 Script Studio — section-based script editor.
 *
 * One screen for: writing sections (heading + narration), per-section and
 * total timing (labeled ESTIMATE — 150 wpm rule of thumb), append-only
 * version history with diff + restore, draft → review → approve → lock
 * status flow (locked is read-only, server-enforced), brand-voice binding,
 * and AI draft generation (1 credit, preflight-gated, honest envelope).
 *
 * States: loading, error (+retry), empty (no script yet), editing,
 * locked-read-only. Nothing here fabricates data: timings are estimates,
 * AI output is labeled, costs are shown before spending.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, History, Loader2, Lock, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import {
  ALLOWED_TRANSITIONS,
  STATUS_COPY,
  type ScriptSection,
  type ScriptStatus,
} from "@/lib/creation/scripts/types";
import {
  estimateSectionSeconds,
  estimateScriptTiming,
  formatClock,
} from "@/lib/creation/scripts/timing";
import {
  bindScriptBrandProfile,
  createProjectScript,
  diffScriptVersionPair,
  generateScriptDraftFn,
  getScriptDetail,
  listBrandVoiceProfiles,
  listProjectScripts,
  listScriptVersions,
  restoreScriptVersionFn,
  saveScript,
  setScriptStatusFn,
} from "@/lib/creation/scripts/scripts.functions";
import { getProjectGateState } from "@/lib/creation/claims/evidence.functions";

const TO_KEY: Record<
  ScriptStatus,
  "studio_to_draft" | "studio_to_in_review" | "studio_to_approved" | "studio_to_locked"
> = {
  draft: "studio_to_draft",
  in_review: "studio_to_in_review",
  approved: "studio_to_approved",
  locked: "studio_to_locked",
};

function newSection(): ScriptSection {
  return { id: crypto.randomUUID(), heading: "", body: "" };
}

function SectionEditor({
  sections,
  readOnly,
  onChange,
}: {
  sections: ScriptSection[];
  readOnly: boolean;
  onChange: (s: ScriptSection[]) => void;
}) {
  const { t } = useI18n();
  const update = (id: string, patch: Partial<ScriptSection>) =>
    onChange(sections.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= sections.length) return;
    const next = [...sections];
    const [moved] = next.splice(i, 1);
    next.splice(j, 0, moved!);
    onChange(next);
  };
  return (
    <div className="space-y-3">
      {sections.map((s, i) => (
        <div key={s.id} className="rounded-lg border p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {t("studio_section")} {i + 1}
            </span>
            <span className="flex items-center gap-2">
              <Badge variant="outline" title={t("studio_timing_hint")}>
                ≈ {formatClock(estimateSectionSeconds(s.body))} {t("studio_estimate")}
              </Badge>
              {!readOnly && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    aria-label={t("studio_move_up")}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={i === sections.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label={t("studio_move_down")}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={sections.length <= 1}
                    onClick={() => onChange(sections.filter((x) => x.id !== s.id))}
                    aria-label={t("studio_delete_section")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )}
            </span>
          </div>
          <div className="mt-2 space-y-2">
            <Input
              value={s.heading}
              disabled={readOnly}
              maxLength={120}
              placeholder={t("studio_heading")}
              onChange={(e) => update(s.id, { heading: e.target.value })}
            />
            <Textarea
              value={s.body}
              disabled={readOnly}
              rows={5}
              maxLength={20000}
              placeholder={t("studio_body")}
              onChange={(e) => update(s.id, { body: e.target.value })}
            />
          </div>
        </div>
      ))}
      {!readOnly && (
        <Button
          variant="outline"
          className="gap-1.5"
          onClick={() => onChange([...sections, newSection()])}
        >
          <Plus className="h-4 w-4" />
          {t("studio_add_section")}
        </Button>
      )}
    </div>
  );
}

export function ScriptStudio({
  projectId,
  scriptId: controlledScriptId,
  onScriptIdChange,
}: {
  projectId: string;
  /** Controlled selected script. When omitted the studio manages its own
   * selection; pass both props to share the selection (e.g. with the
   * Evidence Desk's claim extractor). */
  scriptId?: string | null;
  onScriptIdChange?: (id: string | null) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const listScriptsFn = useServerFn(listProjectScripts);
  const createFn = useServerFn(createProjectScript);
  const detailFn = useServerFn(getScriptDetail);
  const saveFn = useServerFn(saveScript);
  const versionsFn = useServerFn(listScriptVersions);
  const diffFn = useServerFn(diffScriptVersionPair);
  const restoreFn = useServerFn(restoreScriptVersionFn);
  const statusFn = useServerFn(setScriptStatusFn);
  const brandListFn = useServerFn(listBrandVoiceProfiles);
  const bindBrandFn = useServerFn(bindScriptBrandProfile);
  const draftFn = useServerFn(generateScriptDraftFn);
  const gateFn = useServerFn(getProjectGateState);

  const [internalScriptId, setInternalScriptId] = useState<string | null>(null);
  // Controlled when the parent passes scriptId (shared with Evidence Desk);
  // otherwise the studio owns its selection.
  const scriptId = controlledScriptId !== undefined ? controlledScriptId : internalScriptId;
  const setScriptId = useCallback(
    (id: string | null) => {
      if (onScriptIdChange) onScriptIdChange(id);
      else setInternalScriptId(id);
    },
    [onScriptIdChange],
  );
  const [sections, setSections] = useState<ScriptSection[]>([]);
  const [changeNote, setChangeNote] = useState("");
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);
  const [diffVersionId, setDiffVersionId] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [sectionCount, setSectionCount] = useState(5);
  const [draftError, setDraftError] = useState<string | null>(null);

  const scriptsQ = useQuery({
    queryKey: ["project-scripts", projectId],
    queryFn: () => listScriptsFn({ data: { projectId } }),
  });
  const detailQ = useQuery({
    queryKey: ["script-detail", scriptId],
    queryFn: () => detailFn({ data: { scriptId: scriptId! } }),
    enabled: !!scriptId,
  });
  const versionsQ = useQuery({
    queryKey: ["script-versions", scriptId],
    queryFn: () => versionsFn({ data: { scriptId: scriptId! } }),
    enabled: !!scriptId,
  });
  const brandsQ = useQuery({
    queryKey: ["brand-voices"],
    queryFn: () => brandListFn({}),
  });
  const gateQ = useQuery({
    queryKey: ["project-gate", projectId],
    queryFn: () => gateFn({ data: { projectId } }),
  });
  const diffQ = useQuery({
    queryKey: ["script-diff", diffVersionId, detailQ.data?.version?.id],
    queryFn: () =>
      diffFn({
        data: { fromVersionId: diffVersionId!, toVersionId: detailQ.data!.version!.id },
      }),
    enabled: !!diffVersionId && !!detailQ.data?.version?.id,
  });

  // Default-select the newest script; reset the editor when it changes.
  useEffect(() => {
    if (!scriptId && scriptsQ.data && scriptsQ.data.length > 0) {
      setScriptId(scriptsQ.data[0]!.id);
    }
  }, [scriptsQ.data, scriptId, setScriptId]);
  // Reset the editor when the loaded version changes. The ref guard keeps
  // background refetches (same version id, new array identity) from wiping
  // in-progress edits.
  const versionId = detailQ.data?.version?.id;
  const versionSections = detailQ.data?.version?.sections;
  const appliedVersionRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (versionId !== appliedVersionRef.current) {
      appliedVersionRef.current = versionId;
      setSections(versionSections ?? []);
      setChangeNote("");
      setDiffVersionId(null);
      setConfirmRestoreId(null);
    }
  }, [versionId, versionSections]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["project-scripts", projectId] });
    queryClient.invalidateQueries({ queryKey: ["script-detail", scriptId] });
    queryClient.invalidateQueries({ queryKey: ["script-versions", scriptId] });
  };

  const createMut = useMutation({
    mutationFn: () => createFn({ data: { projectId, title: "Untitled script" } }),
    onSuccess: (s) => {
      setScriptId(s.id);
      invalidateAll();
      toast.success(t("studio_created"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("studio_error")),
  });

  const saveMut = useMutation({
    mutationFn: () =>
      saveFn({ data: { scriptId: scriptId!, sections, changeNote: changeNote.trim() } }),
    onSuccess: (r) => {
      setChangeNote("");
      invalidateAll();
      toast.success(`${t("studio_saved")} (v${r.versionNumber})`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("studio_error")),
  });

  const restoreMut = useMutation({
    mutationFn: (versionId: string) => restoreFn({ data: { versionId } }),
    onSuccess: (r) => {
      setConfirmRestoreId(null);
      invalidateAll();
      toast.success(`${t("studio_restored")} (v${r.versionNumber})`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("studio_error")),
  });

  const statusMut = useMutation({
    mutationFn: (status: ScriptStatus) => statusFn({ data: { scriptId: scriptId!, status } }),
    onSuccess: () => {
      invalidateAll();
      toast.success(t("studio_status_saved"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("studio_error")),
  });

  const brandMut = useMutation({
    mutationFn: (brandProfileId: string | null) =>
      bindBrandFn({ data: { scriptId: scriptId!, brandProfileId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["script-detail", scriptId] });
      toast.success(t("studio_brand_saved"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("studio_error")),
  });

  const draftMut = useMutation({
    mutationFn: () => {
      setDraftError(null);
      return draftFn({
        data: {
          projectId,
          topic: topic.trim(),
          sectionCount,
          brandProfileId: detailQ.data?.script.brand_profile_id ?? undefined,
        },
      });
    },
    onSuccess: (out) => {
      if (out.ok && out.output) {
        setScriptId(out.output.scriptId);
        invalidateAll();
        toast.success(t("studio_draft_ready"));
      } else {
        // Honest envelope: unconfigured / denied / provider errors land here.
        setDraftError(out.error?.message ?? t("studio_error"));
      }
    },
    onError: (e) => setDraftError(e instanceof Error ? e.message : t("studio_error")),
  });

  const detail = detailQ.data;
  const script = detail?.script;
  const locked = script?.status === "locked";
  const timing = estimateScriptTiming(sections);
  const nextStatuses = script ? ALLOWED_TRANSITIONS[script.status] : [];
  const gate = gateQ.data;
  const approveBlockedByGate = script?.status === "in_review" && gate?.strictMode && gate.blocked;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t("studio_title")}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{t("studio_subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            {scriptsQ.data && scriptsQ.data.length > 0 && (
              <Select value={scriptId ?? ""} onValueChange={setScriptId}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder={t("studio_pick_script")} />
                </SelectTrigger>
                <SelectContent>
                  {scriptsQ.data.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.title} ({STATUS_COPY[s.status].label})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              variant="outline"
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending}
            >
              {createMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {t("studio_new_script")}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {scriptsQ.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("studio_loading")}
          </div>
        )}
        {scriptsQ.isError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <p className="text-destructive">{t("studio_error")}</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => scriptsQ.refetch()}>
              {t("studio_retry")}
            </Button>
          </div>
        )}

        {scriptsQ.isSuccess && scriptsQ.data.length === 0 && (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <p className="font-medium text-foreground">{t("studio_empty_title")}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {t("studio_empty_body")}
            </p>
          </div>
        )}

        {script && (
          <>
            {locked && (
              <div className="flex items-start gap-2 rounded-lg border p-3 text-sm">
                <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{t("studio_locked")}</p>
              </div>
            )}

            {/* Status flow */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge title={STATUS_COPY[script.status].hint}>
                {STATUS_COPY[script.status].label}
              </Badge>
              {nextStatuses.map((ns) => (
                <Button
                  key={ns}
                  size="sm"
                  variant={ns === "approved" || ns === "locked" ? "default" : "outline"}
                  disabled={statusMut.isPending || (ns === "approved" && approveBlockedByGate)}
                  title={
                    ns === "approved" && approveBlockedByGate
                      ? t("studio_strict_block")
                      : STATUS_COPY[ns].hint
                  }
                  onClick={() => statusMut.mutate(ns)}
                >
                  {statusMut.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  {t(TO_KEY[ns])}
                </Button>
              ))}
            </div>
            {approveBlockedByGate && (
              <p className="text-sm text-destructive">{t("studio_strict_block")}</p>
            )}

            {/* Brand voice */}
            <div className="flex flex-wrap items-center gap-2">
              <Label className="text-sm">{t("studio_brand_voice")}</Label>
              <Select
                value={script.brand_profile_id ?? "none"}
                disabled={locked || brandMut.isPending}
                onValueChange={(v) => brandMut.mutate(v === "none" ? null : v)}
              >
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("studio_brand_none")}</SelectItem>
                  {(brandsQ.data ?? []).map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Timing summary — always labeled ESTIMATE */}
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium">
                {t("studio_total")}: ≈ {formatClock(timing.totalSeconds)}
              </span>
              <Badge variant="outline" title={t("studio_timing_hint")}>
                {t("studio_estimate")}
              </Badge>
              <span className="text-muted-foreground">
                {timing.totalWords} {t("studio_words")} · {sections.length} {t("studio_sections")}
              </span>
            </div>

            <SectionEditor sections={sections} readOnly={locked} onChange={setSections} />

            {!locked && (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="max-w-xs"
                  placeholder={t("studio_change_note")}
                  value={changeNote}
                  maxLength={300}
                  onChange={(e) => setChangeNote(e.target.value)}
                />
                <Button
                  onClick={() => saveMut.mutate()}
                  disabled={saveMut.isPending || sections.length === 0}
                >
                  {saveMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {saveMut.isPending ? t("studio_saving") : t("studio_save")}
                </Button>
              </div>
            )}

            {/* AI draft */}
            {!locked && (
              <div className="rounded-lg border p-4">
                <h4 className="flex items-center gap-1.5 text-sm font-semibold">
                  <Sparkles className="h-4 w-4" />
                  {t("studio_generate")}
                </h4>
                <p className="mt-1 text-xs text-muted-foreground">{t("studio_cost_note")}</p>
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <div className="min-w-52 flex-1 space-y-1.5">
                    <Label>{t("studio_topic")}</Label>
                    <Input
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      placeholder={t("studio_topic_placeholder")}
                      maxLength={300}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("studio_section_count")}</Label>
                    <Input
                      type="number"
                      className="w-24"
                      min={2}
                      max={12}
                      value={sectionCount}
                      onChange={(e) => setSectionCount(Number(e.target.value))}
                    />
                  </div>
                  <Button
                    onClick={() => draftMut.mutate()}
                    disabled={draftMut.isPending || topic.trim().length < 3}
                  >
                    {draftMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {draftMut.isPending ? t("studio_generating") : t("studio_generate_cta")}
                  </Button>
                </div>
                {draftError && <p className="mt-2 text-sm text-destructive">{draftError}</p>}
              </div>
            )}

            {/* Version history */}
            <div>
              <h4 className="flex items-center gap-1.5 text-sm font-semibold">
                <History className="h-4 w-4" />
                {t("studio_history")}
              </h4>
              {versionsQ.isLoading && (
                <p className="mt-2 text-sm text-muted-foreground">{t("studio_loading")}</p>
              )}
              <div className="mt-2 space-y-2">
                {(versionsQ.data ?? []).map((v) => (
                  <div key={v.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        v{v.version_number}
                        {v.id === script.current_version_id && (
                          <Badge variant="secondary" className="ml-2">
                            {t("studio_current")}
                          </Badge>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(v.created_at).toLocaleString()} · {v.word_count}{" "}
                        {t("studio_words")} · ≈ {formatClock(v.timing.totalSeconds)}
                        {v.change_note ? ` · ${v.change_note}` : ""}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {v.id !== script.current_version_id && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDiffVersionId(diffVersionId === v.id ? null : v.id)}
                        >
                          {diffVersionId === v.id ? t("studio_hide_diff") : t("studio_show_diff")}
                        </Button>
                      )}
                      {!locked &&
                        v.id !== script.current_version_id &&
                        confirmRestoreId !== v.id && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setConfirmRestoreId(v.id)}
                          >
                            {t("studio_restore")}
                          </Button>
                        )}
                      {confirmRestoreId === v.id && (
                        <>
                          <Button
                            size="sm"
                            disabled={restoreMut.isPending}
                            onClick={() => restoreMut.mutate(v.id)}
                          >
                            {restoreMut.isPending && (
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            )}
                            {t("studio_confirm_restore")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setConfirmRestoreId(null)}
                          >
                            {t("studio_cancel")}
                          </Button>
                        </>
                      )}
                    </div>
                    {diffVersionId === v.id && (
                      <div className="mt-2 rounded border bg-muted/30 p-3 text-xs">
                        {diffQ.isLoading && t("studio_loading")}
                        {diffQ.data && diffQ.data.length === 0 && <p>{t("studio_diff_empty")}</p>}
                        {diffQ.data?.map((d) => (
                          <div key={d.sectionId} className="mb-2 last:mb-0">
                            <Badge variant="outline" className="mb-1">
                              {d.type}
                            </Badge>
                            <p className="font-medium">{d.after?.heading ?? d.before?.heading}</p>
                            {d.before && d.type !== "added" && (
                              <p className="text-muted-foreground line-through">
                                {d.before.body.slice(0, 200)}
                              </p>
                            )}
                            {d.after && d.type !== "removed" && <p>{d.after.body.slice(0, 200)}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
