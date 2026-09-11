import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { getPricingPlans } from "@/lib/public.functions";
import { displayPlanFeatures, PRICING_FOOTNOTE } from "@/lib/pricing-display";

export function PricingSection({ compact = false }: { compact?: boolean }) {
  const plansFn = useServerFn(getPricingPlans);
  const { data, isLoading } = useQuery({
    queryKey: ["pricing-plans"],
    queryFn: () => plansFn({}),
  });

  const plans = data ?? [];

  return (
    <section
      className={cn(
        "w-full border-y border-border bg-muted/40",
        compact ? "py-16" : "py-20 sm:py-24",
      )}
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              Pricing
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Less than a coffee per finished cut
            </h2>
          </div>
          <p className="max-w-sm text-muted-foreground">
            Credit packs for finished 1080p MP4s. Prices are what we intend to charge when checkout goes live.
          </p>
        </div>

        {isLoading ? (
          <div className="grid gap-5 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[420px] rounded-3xl" />
            ))}
          </div>
        ) : (
          <div className="grid items-start gap-5 lg:grid-cols-3">
            {plans.map((plan) => {
              const popular = plan.highlighted;
              const features = displayPlanFeatures({
                slug: plan.slug,
                features: plan.features,
              });
              const perVideo =
                plan.credits > 0
                  ? `≈ $${(Number(plan.price_monthly) / plan.credits).toFixed(2)} per finished cut`
                  : "";

              return (
                <div
                  key={plan.id}
                  className={cn(
                    "relative flex flex-col rounded-3xl border border-border bg-card p-7",
                    popular &&
                      "border-transparent bg-foreground text-background shadow-[0_30px_60px_-40px_var(--shadow-tint-strong)] lg:-mt-4 lg:pb-10",
                  )}
                >
                  {popular && (
                    <span className="absolute -top-3 left-7 rounded-full bg-accent px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-accent-foreground">
                      Most popular
                    </span>
                  )}
                  <div className="mb-5">
                    <h3
                      className={cn(
                        "text-sm font-semibold uppercase tracking-[0.18em]",
                        popular ? "text-accent" : "text-primary",
                      )}
                    >
                      {plan.name}
                    </h3>
                    <div className="mt-3 flex items-baseline gap-2">
                      <span className="font-display text-4xl font-bold">
                        ${Number(plan.price_monthly).toFixed(0)}
                      </span>
                      <span className={popular ? "text-background/60" : "text-muted-foreground"}>
                        /mo
                      </span>
                    </div>
                    {perVideo && (
                      <p
                        className={cn(
                          "mt-1 text-sm font-medium",
                          popular ? "text-accent" : "text-primary",
                        )}
                      >
                        {perVideo}
                      </p>
                    )}
                    <p
                      className={cn(
                        "mt-2 text-sm",
                        popular ? "text-background/70" : "text-muted-foreground",
                      )}
                    >
                      {plan.blurb}
                    </p>
                  </div>

                  <div
                    className={cn(
                      "mb-5 rounded-2xl p-4",
                      popular ? "bg-background/10" : "bg-muted",
                    )}
                  >
                    <div className="flex items-center gap-2 font-semibold">
                      <Check className={cn("h-4 w-4", popular ? "text-accent" : "text-primary")} />
                      {plan.credits.toLocaleString()} credits
                    </div>
                    <p
                      className={cn(
                        "ml-6 text-sm",
                        popular ? "text-background/60" : "text-muted-foreground",
                      )}
                    >
                      1 credit = 1 finished video
                    </p>
                  </div>

                  <ul className="mb-7 flex-1 space-y-3">
                    {features.map((feature) => (
                      <li key={feature} className="flex items-start gap-3 text-sm">
                        <Check
                          className={cn(
                            "mt-0.5 h-4 w-4 shrink-0",
                            popular ? "text-accent" : "text-primary",
                          )}
                        />
                        {feature}
                      </li>
                    ))}
                  </ul>

                  <Link
                    to="/auth"
                    className={cn(
                      "w-full rounded-full px-4 py-3 text-center text-sm font-semibold transition-transform hover:-translate-y-0.5",
                      popular ? "bg-accent text-accent-foreground" : "bg-foreground text-background",
                    )}
                  >
                    Start with {plan.name}
                  </Link>
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-8 text-sm text-muted-foreground">{PRICING_FOOTNOTE}</p>
      </div>
    </section>
  );
}

export function PricingSectionCompact() {
  return <PricingSection compact />;
}
