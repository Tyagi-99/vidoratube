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
  const checkoutLive = Boolean(billingConfig?.dodo || billingConfig?.razorpay);

  return (
    <section
      className={cn(
        "w-full border-t border-border",
        compact ? "py-16" : "py-20 sm:py-24",
      )}
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 max-w-2xl">
          <p className="font-mono text-xs tracking-[0.2em] text-[oklch(0.82_0.145_78)]">
            THE RATES
          </p>
          <h2 className="font-display mt-4 text-balance text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Less than a coffee per finished cut.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Credit packs for finished 1080p MP4s. One credit, one video.
          </p>
        </div>

        {isLoading ? (
          <div className="grid gap-5 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[420px] rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid items-stretch gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-3">
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
                    "relative flex flex-col bg-background p-8",
                    popular && "bg-card",
                  )}
                >
                  {popular && (
                    <span className="absolute right-8 top-8 font-mono text-[11px] tracking-widest text-[oklch(0.82_0.145_78)]">
                      MOST PICKED
                    </span>
                  )}
                  <div className="mb-6">
                    <h3 className="font-mono text-xs tracking-[0.2em] text-muted-foreground">
                      {plan.name.toUpperCase()}
                    </h3>
                    <div className="mt-4 flex items-baseline gap-2">
                      <span className="font-display text-5xl font-extrabold tracking-tight">
                        ${Number(plan.price_monthly).toFixed(0)}
                      </span>
                      <span className="text-muted-foreground">/mo</span>
                    </div>
                    {perVideo && (
                      <p className="mt-2 text-sm font-medium text-[oklch(0.82_0.145_78)]">
                        {perVideo}
                      </p>
                    )}
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      {plan.blurb}
                    </p>
                  </div>

                  <div className="mb-6 border-y border-border py-4">
                    <div className="flex items-center gap-2 font-semibold">
                      <Check className="h-4 w-4 text-[oklch(0.82_0.145_78)]" />
                      {plan.credits.toLocaleString()} credits
                    </div>
                    <p className="ml-6 mt-1 text-sm text-muted-foreground">
                      1 credit = 1 finished video
                    </p>
                  </div>

                  <ul className="mb-8 flex-1 space-y-3">
                    {features.map((feature) => (
                      <li key={feature} className="flex items-start gap-3 text-sm text-foreground/80">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-[oklch(0.82_0.145_78)]" />
                        {feature}
                      </li>
                    ))}
                  </ul>

                  <Link
                    to={loggedIn ? "/billing" : "/auth"}
                    className={cn(
                      "w-full rounded-lg px-4 py-3.5 text-center text-sm font-bold transition-transform duration-200 hover:scale-[1.01]",
                      popular
                        ? "bg-primary text-primary-foreground"
                        : "border border-border text-foreground hover:border-foreground/30",
                    )}
                  >
                    {loggedIn ? `Get ${plan.name}` : `Start with ${plan.name}`}
                  </Link>
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-8 font-mono text-xs text-muted-foreground">
          {checkoutLive ? PRICING_FOOTNOTE : PRICING_FOOTNOTE_SETUP}
        </p>
      </div>
    </section>
  );
}

export function PricingSectionCompact() {
  return <PricingSection compact />;
}
