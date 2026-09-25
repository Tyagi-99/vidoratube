import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Circle, X, Youtube, Compass, Lightbulb, Clapperboard } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { listResearchProjects } from "@/lib/research.functions";
import { listMyJobs } from "@/lib/jobs.functions";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "vidora-onboarding-dismissed";

type Step = {
  key: string;
  titleKey: Parameters<ReturnType<typeof useI18n>["t"]>[0];
  descKey: Parameters<ReturnType<typeof useI18n>["t"]>[0];
  to: string;
  done: boolean;
  icon: typeof Youtube;
};

/**
 * First-run checklist shown on the studio page until dismissed.
 * Steps complete automatically as the user does them.
 */
export function OnboardingChecklist() {
  const { t } = useI18n();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const projectsFn = useServerFn(listMyJobs);
  const researchFn = useServerFn(listResearchProjects);
  const projects = useQuery({ queryKey: ["onboarding-projects"], queryFn: () => projectsFn() });
  const research = useQuery({ queryKey: ["onboarding-research"], queryFn: () => researchFn() });

  if (dismissed) return null;

  const hasProject = (projects.data?.length ?? 0) > 0;
  const hasResearch = (research.data?.length ?? 0) > 0;

  const steps: Step[] = [
    {
      key: "connect",
      titleKey: "onboarding_step_connect",
      descKey: "onboarding_step_connect_desc",
      to: "/studio",
      done: false, // can't detect YouTube connection client-side cheaply; manual
      icon: Youtube,
    },
    {
      key: "research",
      titleKey: "onboarding_step_research",
      descKey: "onboarding_step_research_desc",
      to: "/research",
      done: hasResearch,
      icon: Compass,
    },
    {
      key: "idea",
      titleKey: "onboarding_step_idea",
      descKey: "onboarding_step_idea_desc",
      to: "/research",
      done: hasResearch,
      icon: Lightbulb,
    },
    {
      key: "studio",
      titleKey: "onboarding_step_studio",
      descKey: "onboarding_step_studio_desc",
      to: "/studio",
      done: hasProject,
      icon: Clapperboard,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore
    }
    setDismissed(true);
  };

  return (
    <section
      aria-labelledby="onboarding-heading"
      className="rounded-2xl border border-border bg-card p-5"
    >
      <div className="flex items-center justify-between">
        <h2 id="onboarding-heading" className="text-lg font-semibold">
          {t("onboarding_title")}
        </h2>
        <Button variant="ghost" size="sm" onClick={dismiss} className="gap-1">
          <X className="size-4" aria-hidden="true" /> {t("onboarding_dismiss")}
        </Button>
      </div>
      <ol className="mt-4 grid gap-3 sm:grid-cols-2">
        {steps.map((step) => (
          <li key={step.key}>
            <Link
              to={step.to}
              className="flex h-full items-start gap-3 rounded-xl border border-border p-4 transition-colors hover:bg-muted/50"
            >
              {step.done ? (
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-green-500" aria-hidden="true" />
              ) : (
                <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <span>
                <span className="flex items-center gap-2 text-sm font-medium">
                  <step.icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  {t(step.titleKey)}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">{t(step.descKey)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
