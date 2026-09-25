import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { getPricingPlans } from "@/lib/public.functions";
import { getBillingConfig } from "@/lib/billing.functions";
import { supabase } from "@/integrations/supabase/client";
import { displayPlanFeatures, PRICING_FOOTNOTE, PRICING_FOOTNOTE_SETUP } from "@/lib/pricing-display";

export function PricingSection({ compact = false }: { compact?: boolean }) {
  const plansFn = useServerFn(getPricingPlans);
  const { data, isLoading } = useQuery({
    queryKey: ["pricing-plans"],
    queryFn: () => plansFn({}),
  });
  const configFn = useServerFn(getBillingConfig);
  const { data: billingConfig } = useQuery({
    queryKey: ["billing-config"],
    queryFn: () => configFn(),
  });
  const [loggedIn, setLoggedIn] = useState(false);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setLoggedIn(Boolean(data.user)));
  }, []);

  const plans = data ?? [];
  const checkoutLive = Boolean(billingConfig?.stripe || billingConfig?.razorpay);

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
            <p className="mb-3 text-xs font-semibold text-accent">
              Future packaging
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
                    "relative flex flex-col rounded-2xl border border-border bg-card p-7",
                    popular && "border-accent/40 bg-secondary",
                  )}
                >
                  {popular && (
                    <span className="absolute -top-3 left-7 rounded-md bg-accent px-3 py-1 text-[11px] font-semibold text-accent-foreground">
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
                      <span className="text-muted-foreground">
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
                    <p className="mt-2 text-sm text-muted-foreground">
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
                    <p className="ml-6 text-sm text-muted-foreground">
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
                    to={loggedIn ? "/billing" : "/auth"}
                    className={cn(
                      "w-full rounded-[10px] px-4 py-3 text-center text-sm font-semibold transition-transform hover:-translate-y-0.5",
                      "bg-primary text-primary-foreground",
                    )}
                  >
                    {loggedIn ? `Get ${plan.name}` : `Start with ${plan.name}`}
                  </Link>
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-8 text-sm text-muted-foreground">
          {checkoutLive ? PRICING_FOOTNOTE : PRICING_FOOTNOTE_SETUP}
        </p>
      </div>
    </section>
  );
}

export function PricingSectionCompact() {
  return <PricingSection compact />;
}
