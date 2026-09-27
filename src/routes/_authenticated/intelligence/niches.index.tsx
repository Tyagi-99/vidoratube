/**
 * Stream B — /intelligence/niches (F1 Niche Finder).
 *
 * Filter bar: language, format, subs range, active-only, recent activity.
 * Every niche card shows the score WITH its expandable factors + freshness.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useI18n, type Lang } from "@/lib/i18n";
import {
  createNiche,
  deleteNiche,
  getIntelligenceStatus,
  listNiches,
  scoreNiche,
} from "@/lib/intelligence/niches.functions";
import {
  ConfidenceBadge,
  ErrorPanel,
  FreshnessLabel,
  InsufficientPanel,
  LoadingGrid,
  ScoreRing,
  ScoreWithFactors,
  UnconfiguredPanel,
} from "@/components/intelligence";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/intelligence/niches/")({
  component: NichesIndex,
});

type FormatFilter = "all" | "long" | "short" | "both";

function NichesIndex() {
  const { t, lang, setLang } = useI18n();
  const queryClient = useQueryClient();
  const listFn = useServerFn(listNiches);
  const statusFn = useServerFn(getIntelligenceStatus);
  const createFn = useServerFn(createNiche);
  const scoreFn = useServerFn(scoreNiche);
  const deleteFn = useServerFn(deleteNiche);

  // Filter bar state (client-side over the niche list).
  const [langFilter, setLangFilter] = useState("all");
  const [formatFilter, setFormatFilter] = useState<FormatFilter>("all");
  const [minSubs, setMinSubs] = useState("");
  const [maxSubs, setMaxSubs] = useState("");
  const [activeOnlyFilter, setActiveOnlyFilter] = useState(false);
  const [recentOnly, setRecentOnly] = useState(false);

  // New-niche dialog state.
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [language, setLanguage] = useState("en");
  const [format, setFormat] = useState<"long" | "short" | "both">("both");
  const [nMinSubs, setNMinSubs] = useState("");
  const [nMaxSubs, setNMaxSubs] = useState("");
  const [nActiveOnly, setNActiveOnly] = useState(false);

  const statusQ = useQuery({ queryKey: ["intel-status"], queryFn: () => statusFn() });
  const nichesQ = useQuery({ queryKey: ["niches"], queryFn: () => listFn() });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["niches"] });

  const create = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          name: name.trim(),
          keywords: keywords
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean),
          language,
          format,
          minSubs: nMinSubs ? Number(nMinSubs) : null,
          maxSubs: nMaxSubs ? Number(nMaxSubs) : null,
          activeOnly: nActiveOnly,
        },
      }),
    onSuccess: (res) => {
      if (res.status === "ok") {
        toast.success(t("saved"));
        setOpen(false);
        setName("");
        setKeywords("");
        invalidate();
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("intel_error_title")),
  });

  const rescore = useMutation({
    mutationFn: (nicheId: string) => scoreFn({ data: { nicheId } }),
    onSuccess: (res) => {
      if (res.status === "ok") {
        toast.success(`${t("intel_score")}: ${Math.round(res.score.score0to100)}`);
        invalidate();
      } else {
        toast.message(res.reason);
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("intel_error_title")),
  });

  const remove = useMutation({
    mutationFn: (nicheId: string) => deleteFn({ data: { nicheId } }),
    onSuccess: () => {
      toast.success(t("saved"));
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("intel_error_title")),
  });

  const niches = nichesQ.data?.status === "ok" ? nichesQ.data.niches : [];
  const filtered = niches.filter((n) => {
    if (langFilter !== "all" && n.preferred_language !== langFilter) return false;
    if (formatFilter !== "all" && n.preferred_format !== formatFilter) return false;
    if (activeOnlyFilter && !n.active_only) return false;
    if (minSubs && (n.max_subs ?? Infinity) < Number(minSubs)) return false;
    if (maxSubs && (n.min_subs ?? 0) > Number(maxSubs)) return false;
    if (recentOnly) {
      const cap = n.latestScore?.capturedAt;
      if (!cap || Date.now() - new Date(cap).getTime() > 7 * 86_400_000) return false;
    }
    return true;
  });

  const languages = [...new Set(niches.map((n) => n.preferred_language))];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("intel_niches_title")}</h1>
          <p className="text-muted-foreground">{t("intel_niches_subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <LangToggle lang={lang} setLang={setLang} />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>{t("intel_new_niche")}</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("intel_new_niche")}</DialogTitle>
                <DialogDescription>{t("intel_niches_subtitle")}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="niche-name">{t("intel_niche_name")}</Label>
                  <Input id="niche-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="niche-keywords">{t("intel_keywords")}</Label>
                  <Input
                    id="niche-keywords"
                    value={keywords}
                    onChange={(e) => setKeywords(e.target.value)}
                    placeholder="history, mysteries, unsolved"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="niche-language">{t("intel_language")}</Label>
                    <Input
                      id="niche-language"
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      maxLength={10}
                    />
                  </div>
                  <div>
                    <Label htmlFor="niche-format">{t("intel_format")}</Label>
                    <Select value={format} onValueChange={(v) => setFormat(v as typeof format)}>
                      <SelectTrigger id="niche-format">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="long">{t("intel_format_long")}</SelectItem>
                        <SelectItem value="short">{t("intel_format_short")}</SelectItem>
                        <SelectItem value="both">{t("intel_format_both")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="niche-min-subs">{t("intel_min_subs")}</Label>
                    <Input
                      id="niche-min-subs"
                      type="number"
                      min={0}
                      value={nMinSubs}
                      onChange={(e) => setNMinSubs(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="niche-max-subs">{t("intel_max_subs")}</Label>
                    <Input
                      id="niche-max-subs"
                      type="number"
                      min={0}
                      value={nMaxSubs}
                      onChange={(e) => setNMaxSubs(e.target.value)}
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={nActiveOnly}
                    onCheckedChange={(v) => setNActiveOnly(Boolean(v))}
                  />
                  {t("intel_active_only")}
                </label>
                <Button
                  onClick={() => create.mutate()}
                  disabled={
                    create.isPending || name.trim().length < 2 || keywords.trim().length === 0
                  }
                >
                  {create.isPending ? t("intel_creating") : t("intel_create_niche")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {statusQ.data && !statusQ.data.youtubeConfigured ? (
        <UnconfiguredPanel />
      ) : nichesQ.isLoading || statusQ.isLoading ? (
        <LoadingGrid />
      ) : nichesQ.isError ? (
        <ErrorPanel
          message={nichesQ.error instanceof Error ? nichesQ.error.message : t("intel_error_title")}
          onRetry={() => nichesQ.refetch()}
        />
      ) : niches.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground">
            {t("intel_no_niches")}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Filter bar */}
          <Card className="mb-4">
            <CardContent className="flex flex-wrap items-end gap-3 py-4">
              <div>
                <Label htmlFor="filter-language" className="text-xs">
                  {t("intel_language")}
                </Label>
                <Select value={langFilter} onValueChange={setLangFilter}>
                  <SelectTrigger id="filter-language" className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {languages.map((l) => (
                      <SelectItem key={l} value={l}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="filter-format" className="text-xs">
                  {t("intel_format")}
                </Label>
                <Select
                  value={formatFilter}
                  onValueChange={(v) => setFormatFilter(v as FormatFilter)}
                >
                  <SelectTrigger id="filter-format" className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="long">{t("intel_format_long")}</SelectItem>
                    <SelectItem value="short">{t("intel_format_short")}</SelectItem>
                    <SelectItem value="both">{t("intel_format_both")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="filter-min-subs" className="text-xs">
                  {t("intel_min_subs")}
                </Label>
                <Input
                  id="filter-min-subs"
                  type="number"
                  min={0}
                  className="w-28"
                  value={minSubs}
                  onChange={(e) => setMinSubs(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="filter-max-subs" className="text-xs">
                  {t("intel_max_subs")}
                </Label>
                <Input
                  id="filter-max-subs"
                  type="number"
                  min={0}
                  className="w-28"
                  value={maxSubs}
                  onChange={(e) => setMaxSubs(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={activeOnlyFilter}
                  onCheckedChange={(v) => setActiveOnlyFilter(Boolean(v))}
                />
                {t("intel_active_only")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={recentOnly} onCheckedChange={(v) => setRecentOnly(Boolean(v))} />
                Recent activity (7d)
              </label>
            </CardContent>
          </Card>

          {filtered.length === 0 ? (
            <InsufficientPanel reason="No niches match these filters. Loosen the filter bar." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {filtered.map((n) => (
                <Card key={n.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-lg">
                          <Link
                            to="/intelligence/niches/$nicheId"
                            params={{ nicheId: n.id }}
                            className="hover:underline"
                          >
                            {n.name}
                          </Link>
                        </CardTitle>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {n.keywords.slice(0, 5).map((k) => (
                            <Badge key={k} variant="secondary">
                              {k}
                            </Badge>
                          ))}
                          <Badge variant="outline">{n.preferred_language}</Badge>
                          <Badge variant="outline">{n.preferred_format}</Badge>
                        </div>
                      </div>
                      {n.latestScore && (
                        <div className="flex flex-col items-end gap-1">
                          <ScoreRing score={n.latestScore.score0to100} />
                          <FreshnessLabel
                            capturedAt={n.latestScore.capturedAt}
                            staleAfterHours={72}
                          />
                        </div>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {n.latestScore ? (
                      <>
                        <div className="flex items-center gap-2">
                          <ConfidenceBadge confidence={n.latestScore.confidence} />
                        </div>
                        <ScoreWithFactors score={n.latestScore} />
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">{t("intel_never_scored")}</p>
                    )}
                    <div className="flex flex-wrap gap-2 border-t pt-3">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={rescore.isPending}
                        onClick={() => rescore.mutate(n.id)}
                      >
                        {rescore.isPending ? t("intel_scoring") : t("intel_rescore")}
                      </Button>
                      <Button size="sm" variant="outline" asChild>
                        <Link to="/intelligence/niches/$nicheId" params={{ nicheId: n.id }}>
                          {t("intel_view_detail")}
                        </Link>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={remove.isPending}
                        onClick={() => {
                          if (window.confirm(t("intel_delete_confirm"))) remove.mutate(n.id);
                        }}
                      >
                        {t("intel_delete")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function LangToggle({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div className="flex overflow-hidden rounded-md border text-sm">
      {(["en", "hi"] as Lang[]).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className={`px-2.5 py-1.5 ${lang === l ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
        >
          {l === "en" ? "EN" : "हिं"}
        </button>
      ))}
    </div>
  );
}
