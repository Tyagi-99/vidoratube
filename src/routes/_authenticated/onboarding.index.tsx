/**
 * Phase 6 Stream B — onboarding wizard.
 * Route: /onboarding
 *
 * Nine steps: welcome -> connect -> creator-type -> niche -> goal ->
 * brand -> scan -> idea -> video. Progress is persisted server-side
 * (`public.onboarding_progress`) so the wizard resumes after tab closes or
 * OAuth round-trips; completed users are redirected to /studio (D221), while
 * users with no progress row start the wizard at "welcome" (D306 — D221's
 * original no-row redirect bounced brand-new signups straight to /studio,
 * so nobody ever saw the wizard). Deliberately NOT in the main nav (D223) — entry points
 * are post-signup (auth.tsx) and the studio empty state.
 *
 * Honesty rules: scan results carry an "AI analysis" badge and a
 * no-guarantees note; the scan costs a research credit and is skippable
 * (D220); every button performs a real action.
 */
import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Sparkles,
  TriangleAlert,
  Youtube,
} from "lucide-react";
import {
  completeOnboarding,
  getOnboardingState,
  saveOnboardingProgress,
} from "@/lib/onboarding/onboarding.functions";
import {
  ONBOARDING_STEPS,
  isSkippable,
  nextStep,
  prevStep,
  resolveOnboardingEntry,
  stepAnswersValid,
  stepIndex,
  type OnboardingStep,
} from "@/lib/onboarding/onboarding";
import { getYouTubeConnection, startYouTubeConnect } from "@/lib/youtube.functions";
import { createResearchProject } from "@/lib/research.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n, type I18nKey } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/onboarding/")({
  head: () => ({ meta: [{ title: "Get set up — Vidora", name: "robots", content: "noindex" }] }),
  component: OnboardingPage,
});

type Answers = Record<string, unknown>;

interface NicheResult {
  name?: string;
  description?: string;
  audience?: string;
  competition?: string;
  advertiser_safety?: string;
}

function AiAnalysisBadge() {
  return (
    <Badge
      className="bg-violet-500/15 text-violet-600 dark:text-violet-400"
      variant="secondary"
    >
      <Sparkles className="mr-1 size-3" aria-hidden="true" /> AI analysis
    </Badge>
  );
}

function StepError({ message, onRetry, t }: { message: string; onRetry: () => void; t: (k: I18nKey) => string }) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
        <span>{message}</span>
      </p>
      <Button size="sm" variant="outline" className="mt-2" onClick={onRetry}>
        {t("ob_retry")}
      </Button>
    </div>
  );
}

function OptionCard({
  selected,
  onSelect,
  title,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
        selected
          ? "border-primary bg-primary/5 text-foreground"
          : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
      }`}
    >
      <span className="font-medium">{title}</span>
      {selected && <CheckCircle2 className="size-5 text-primary" aria-hidden="true" />}
    </button>
  );
}

interface StepProps {
  answers: Answers;
  setAnswer: (key: string, value: unknown) => void;
  onAdvance: (delta?: Answers) => void;
  onPersist: (delta: Answers) => void;
  onBack: () => void;
  onSkip: () => void;
  onComplete: () => void;
  advancing: boolean;
  t: (k: I18nKey) => string;
  lang: string;
}

function WelcomeStep({ onAdvance, onComplete, advancing, t }: StepProps) {
  return (
    <div className="space-y-6">
      <div>
        <CardTitle className="font-display text-2xl">{t("ob_welcome_title")}</CardTitle>
        <CardDescription className="mt-2 text-sm leading-relaxed">
          {t("ob_welcome_body")}
        </CardDescription>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={() => onAdvance()} disabled={advancing}>
          {advancing && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
          {t("ob_start")}
        </Button>
        <Button variant="ghost" onClick={onComplete} disabled={advancing}>
          {t("ob_skip_setup")}
        </Button>
      </div>
    </div>
  );
}

function ConnectStep({ onAdvance, onSkip, advancing, t }: StepProps) {
  const readFn = useServerFn(getYouTubeConnection);
  const startFn = useServerFn(startYouTubeConnect);
  const connection = useQuery({
    queryKey: ["onboarding-youtube"],
    queryFn: () => readFn({}),
    refetchOnWindowFocus: true,
  });
  const start = useMutation({
    mutationFn: () => startFn({}),
    onSuccess: (res) => {
      // Real OAuth flow: the callback lands on /studio, where the toast
      // confirms; the user resumes the wizard from the studio empty state.
      window.location.href = res.url;
    },
    onError: (e) => toast.error(t("ob_connect_error"), { description: (e as Error).message }),
  });

  const connected = connection.data?.connection;

  return (
    <div className="space-y-6">
      <div>
        <CardTitle className="font-display text-2xl">{t("ob_connect_title")}</CardTitle>
        <CardDescription className="mt-2 text-sm leading-relaxed">
          {t("ob_connect_body")}
        </CardDescription>
      </div>

      {connection.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
        </div>
      ) : connection.isError ? (
        <StepError
          message={(connection.error as Error)?.message ?? t("ob_load_error")}
          onRetry={() => connection.refetch()}
          t={t}
        />
      ) : connected ? (
        <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
          <Youtube className="size-5 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">{connected.channel_title}</p>
            <Badge variant="secondary" className="mt-1">{t("ob_connected")}</Badge>
          </div>
        </div>
      ) : (
        <Button
          onClick={() => start.mutate()}
          disabled={start.isPending}
          className="gap-2"
        >
          {start.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Youtube className="size-4" aria-hidden="true" />
          )}
          {start.isPending ? t("ob_connecting") : t("ob_connect_btn")}
        </Button>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        {connected && (
          <Button onClick={() => onAdvance()} disabled={advancing}>
            {advancing && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
            {t("ob_continue")}
          </Button>
        )}
        <Button variant={connected ? "ghost" : "outline"} onClick={onSkip} disabled={advancing}>
          {t("ob_skip")}
        </Button>
      </div>
    </div>
  );
}

const CREATOR_TYPES: { value: string; labelKey: I18nKey }[] = [
  { value: "faceless", labelKey: "ob_type_faceless" },
  { value: "on-camera", labelKey: "ob_type_oncamera" },
  { value: "brand", labelKey: "ob_type_brand" },
  { value: "agency", labelKey: "ob_type_agency" },
  { value: "explorer", labelKey: "ob_type_explorer" },
];

function CreatorTypeStep({ answers, setAnswer, onAdvance, advancing, t }: StepProps) {
  const value = typeof answers["creator_type"] === "string" ? answers["creator_type"] : "";
  return (
    <div className="space-y-6">
      <CardTitle className="font-display text-2xl">{t("ob_type_title")}</CardTitle>
      <div className="grid gap-2">
        {CREATOR_TYPES.map((opt) => (
          <OptionCard
            key={opt.value}
            title={t(opt.labelKey)}
            selected={value === opt.value}
            onSelect={() => setAnswer("creator_type", opt.value)}
          />
        ))}
      </div>
      <Button
        onClick={() => onAdvance({ creator_type: value })}
        disabled={advancing || !stepAnswersValid("creator-type", { creator_type: value })}
      >
        {advancing && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
        {t("ob_continue")}
      </Button>
    </div>
  );
}

function NicheStep({ answers, setAnswer, onAdvance, advancing, t }: StepProps) {
  const value = typeof answers["niche"] === "string" ? answers["niche"] : "";
  return (
    <div className="space-y-6">
      <div>
        <CardTitle className="font-display text-2xl">{t("ob_niche_title")}</CardTitle>
        <CardDescription className="mt-2 text-sm leading-relaxed">
          {t("ob_niche_body")}
        </CardDescription>
      </div>
      <div className="space-y-2">
        <Label htmlFor="ob-niche">{t("ob_niche_title")}</Label>
        <Input
          id="ob-niche"
          value={value}
          onChange={(e) => setAnswer("niche", e.target.value)}
          placeholder={t("ob_niche_placeholder")}
          maxLength={200}
        />
      </div>
      <Button
        onClick={() => onAdvance({ niche: value.trim() })}
        disabled={advancing || !stepAnswersValid("niche", { niche: value })}
      >
        {advancing && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
        {t("ob_continue")}
      </Button>
    </div>
  );
}

const GOALS: { value: string; labelKey: I18nKey }[] = [
  { value: "subscribers", labelKey: "ob_goal_subs" },
  { value: "views", labelKey: "ob_goal_views" },
  { value: "sales", labelKey: "ob_goal_sales" },
  { value: "learn", labelKey: "ob_goal_learn" },
];

function GoalStep({ answers, setAnswer, onAdvance, advancing, t }: StepProps) {
  const value = typeof answers["goal"] === "string" ? answers["goal"] : "";
  return (
    <div className="space-y-6">
      <CardTitle className="font-display text-2xl">{t("ob_goal_title")}</CardTitle>
      <div className="grid gap-2">
        {GOALS.map((opt) => (
          <OptionCard
            key={opt.value}
            title={t(opt.labelKey)}
            selected={value === opt.value}
            onSelect={() => setAnswer("goal", opt.value)}
          />
        ))}
      </div>
      <Button
        onClick={() => onAdvance({ goal: value })}
        disabled={advancing || !stepAnswersValid("goal", { goal: value })}
      >
        {advancing && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
        {t("ob_continue")}
      </Button>
    </div>
  );
}

function BrandStep({ answers, setAnswer, onAdvance, advancing, t }: StepProps) {
  const name = typeof answers["channel_name"] === "string" ? answers["channel_name"] : "";
  const tone = typeof answers["tone"] === "string" ? answers["tone"] : "";
  return (
    <div className="space-y-6">
      <CardTitle className="font-display text-2xl">{t("ob_brand_title")}</CardTitle>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ob-brand-name">{t("ob_brand_name")}</Label>
          <Input
            id="ob-brand-name"
            value={name}
            onChange={(e) => setAnswer("channel_name", e.target.value)}
            placeholder={t("ob_brand_name_placeholder")}
            maxLength={120}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ob-brand-tone">{t("ob_brand_tone")}</Label>
          <Input
            id="ob-brand-tone"
            value={tone}
            onChange={(e) => setAnswer("tone", e.target.value)}
            placeholder={t("ob_brand_tone_placeholder")}
            maxLength={200}
          />
        </div>
      </div>
      <Button
        onClick={() => onAdvance({ channel_name: name.trim(), tone: tone.trim() })}
        disabled={advancing || !stepAnswersValid("brand", { channel_name: name })}
      >
        {advancing && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
        {t("ob_continue")}
      </Button>
    </div>
  );
}

function ScanStep({ answers, onAdvance, onPersist, onSkip, advancing, t, lang }: StepProps) {
  const scanFn = useServerFn(createResearchProject);
  const [ran, setRan] = useState(false);
  const niche = typeof answers["niche"] === "string" ? answers["niche"] : "";
  const saved = Array.isArray(answers["niches"]) ? (answers["niches"] as NicheResult[]) : null;

  const scan = useMutation({
    mutationFn: () =>
      scanFn({ data: { topic: niche, language: lang === "hi" ? "Hindi" : "English" } }),
    onSuccess: (row) => {
      const niches = (row as { niches?: unknown }).niches;
      const projectId = (row as { id?: string }).id;
      // Persist immediately — the scan spent a real research credit (D222).
      onPersist({ niches, research_project_id: projectId });
      setRan(true);
    },
    onError: (e) => {
      toast.error(t("ob_scan_error"), { description: (e as Error).message });
      setRan(true);
    },
  });

  const results = scan.data
    ? ((scan.data as { niches?: unknown }).niches as NicheResult[] | undefined)
    : (saved ?? undefined);

  return (
    <div className="space-y-6">
      <div>
        <CardTitle className="font-display text-2xl">{t("ob_scan_title")}</CardTitle>
        <CardDescription className="mt-2 text-sm leading-relaxed">
          {t("ob_scan_body")}
        </CardDescription>
      </div>

      {!results && !scan.isPending && (
        <Button onClick={() => scan.mutate()} className="gap-2">
          <Sparkles className="size-4" aria-hidden="true" />
          {t("ob_scan_run")}
        </Button>
      )}

      {scan.isPending && (
        <div className="space-y-2" aria-live="polite">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <p className="text-sm text-muted-foreground">{t("ob_scan_running")}</p>
        </div>
      )}

      {scan.isError && ran && (
        <StepError
          message={(scan.error as Error)?.message ?? t("ob_scan_error")}
          onRetry={() => scan.mutate()}
          t={t}
        />
      )}

      {results && results.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <AiAnalysisBadge />
            <p className="text-xs text-muted-foreground">{t("ob_scan_credit_note")}</p>
          </div>
          {results.map((n, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-foreground">{n.name ?? `Niche ${i + 1}`}</p>
                <div className="flex gap-1.5">
                  {n.competition && (
                    <Badge variant="secondary" className="text-[11px]">
                      {n.competition}
                    </Badge>
                  )}
                  {n.advertiser_safety && (
                    <Badge variant="outline" className="text-[11px]">
                      {n.advertiser_safety}
                    </Badge>
                  )}
                </div>
              </div>
              {n.description && (
                <p className="mt-1 text-sm text-muted-foreground">{n.description}</p>
              )}
              {n.audience && (
                <p className="mt-1 text-xs text-muted-foreground">{n.audience}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        {results && results.length > 0 && (
          <Button onClick={() => onAdvance()} disabled={advancing}>
            {advancing && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
            {t("ob_continue")}
          </Button>
        )}
        <Button variant={results ? "ghost" : "outline"} onClick={onSkip} disabled={advancing}>
          {t("ob_skip")}
        </Button>
      </div>
    </div>
  );
}

function IdeaStep({ answers, setAnswer, onAdvance, advancing, t }: StepProps) {
  const value = typeof answers["first_idea"] === "string" ? answers["first_idea"] : "";
  const valid = value.trim().length >= 3;
  return (
    <div className="space-y-6">
      <div>
        <CardTitle className="font-display text-2xl">{t("ob_idea_title")}</CardTitle>
        <CardDescription className="mt-2 text-sm leading-relaxed">
          {t("ob_idea_body")}
        </CardDescription>
      </div>
      <div className="space-y-2">
        <Label htmlFor="ob-idea">{t("ob_idea_title")}</Label>
        <Textarea
          id="ob-idea"
          value={value}
          onChange={(e) => setAnswer("first_idea", e.target.value)}
          placeholder={t("ob_idea_placeholder")}
          rows={4}
          maxLength={500}
        />
      </div>
      <Button
        onClick={() => onAdvance({ first_idea: value.trim() })}
        disabled={advancing || !valid}
      >
        {advancing && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
        {t("ob_continue")}
      </Button>
    </div>
  );
}

function VideoStep({ answers, onComplete, advancing, t }: StepProps) {
  const idea = typeof answers["first_idea"] === "string" ? answers["first_idea"] : "";
  const niche = typeof answers["niche"] === "string" ? answers["niche"] : "";
  return (
    <div className="space-y-6">
      <div>
        <CardTitle className="font-display text-2xl">{t("ob_video_title")}</CardTitle>
        <CardDescription className="mt-2 text-sm leading-relaxed">
          {t("ob_video_body")}
        </CardDescription>
      </div>
      {(idea || niche) && (
        <div className="rounded-xl border border-border bg-card p-4 text-sm">
          {niche && (
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">{t("ob_niche_title")}:</span> {niche}
            </p>
          )}
          {idea && (
            <p className="mt-1 text-muted-foreground">
              <span className="font-medium text-foreground">{t("ob_idea_title")}:</span> {idea}
            </p>
          )}
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button asChild>
          <Link to="/create/quick-create">{t("ob_open_quick_create")}</Link>
        </Button>
        <Button variant="outline" onClick={onComplete} disabled={advancing}>
          {advancing && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
          {t("ob_finish")}
        </Button>
      </div>
    </div>
  );
}

const STEP_COMPONENTS: Record<OnboardingStep, (p: StepProps) => React.ReactNode> = {
  welcome: WelcomeStep,
  connect: ConnectStep,
  "creator-type": CreatorTypeStep,
  niche: NicheStep,
  goal: GoalStep,
  brand: BrandStep,
  scan: ScanStep,
  idea: IdeaStep,
  video: VideoStep,
};

function Wizard({ resumeStep, initialAnswers }: { resumeStep: OnboardingStep; initialAnswers: Answers }) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState<OnboardingStep>(resumeStep);
  const [answers, setAnswers] = useState<Answers>(initialAnswers);

  const saveFn = useServerFn(saveOnboardingProgress);
  const completeFn = useServerFn(completeOnboarding);

  const save = useMutation({
    mutationFn: (input: { step: OnboardingStep; answers?: Answers }) =>
      saveFn({ data: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["onboarding-state"] }),
    onError: (e) => toast.error(t("ob_save_error"), { description: (e as Error).message }),
  });

  const complete = useMutation({
    mutationFn: () => completeFn({}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboarding-state"] });
      navigate({ to: "/studio" });
    },
    onError: (e) => toast.error(t("ob_save_error"), { description: (e as Error).message }),
  });

  const setAnswer = (key: string, value: unknown) =>
    setAnswers((prev) => ({ ...prev, [key]: value }));

  /** Save answers without moving (e.g. right after the credit-spending scan). */
  const persist = (delta: Answers) => {
    save.mutate(
      { step: current, answers: delta },
      { onSuccess: () => setAnswers((prev) => ({ ...prev, ...delta })) },
    );
  };

  /** Persist answers, then move to the next step (D221: current_step = where the user IS). */
  const advance = (delta?: Answers) => {
    const merged = { ...(delta ?? {}) };
    const nxt = nextStep(current);
    if (!nxt) return;
    save.mutate(
      { step: nxt, answers: { ...merged } },
      {
        onSuccess: () => {
          if (delta) setAnswers((prev) => ({ ...prev, ...merged }));
          setCurrent(nxt);
        },
      },
    );
  };

  const back = () => {
    const prv = prevStep(current);
    if (prv) setCurrent(prv);
  };

  const skip = () => {
    if (isSkippable(current)) advance();
  };

  const Step = STEP_COMPONENTS[current];
  const idx = stepIndex(current);

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-10 sm:px-6">
      <div className="mb-6">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Step {idx + 1} of {ONBOARDING_STEPS.length}
          </span>
          {idx > 0 && (
            <button
              type="button"
              onClick={back}
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              {t("ob_back")}
            </button>
          )}
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${((idx + 1) / ONBOARDING_STEPS.length) * 100}%` }}
          />
        </div>
      </div>
      <Card>
        <CardContent className="p-6 sm:p-8">
          <Step
            answers={answers}
            setAnswer={setAnswer}
            onAdvance={advance}
            onPersist={persist}
            onBack={back}
            onSkip={skip}
            onComplete={() => complete.mutate()}
            advancing={save.isPending || complete.isPending}
            t={t}
            lang={lang}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function OnboardingPage() {
  const { t } = useI18n();
  const stateFn = useServerFn(getOnboardingState);
  const onboarding = useQuery({
    queryKey: ["onboarding-state"],
    queryFn: () => stateFn({}),
    refetchOnWindowFocus: false,
  });

  if (onboarding.isLoading) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-10 sm:px-6" aria-live="polite">
        <p className="mb-4 text-sm text-muted-foreground">{t("ob_loading")}</p>
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="mt-4 h-40 w-full" />
      </div>
    );
  }

  if (onboarding.isError) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-10 sm:px-6">
        <Card>
          <CardHeader>
            <CardTitle>Get set up</CardTitle>
          </CardHeader>
          <CardContent>
            <StepError
              message={(onboarding.error as Error)?.message ?? t("ob_load_error")}
              onRetry={() => onboarding.refetch()}
              t={t}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const decision = resolveOnboardingEntry(onboarding.data ?? null);
  if (decision.action === "redirect") {
    return <Navigate to="/studio" />;
  }

  return <Wizard resumeStep={decision.step} initialAnswers={onboarding.data?.answers ?? {}} />;
}
