import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { getBillingConfig } from "@/lib/billing.functions";
import { getDisplayCurrency, getPricingPlans } from "@/lib/public.functions";
import { displayPlanFeatures, PRICING_FOOTNOTE, PRICING_FOOTNOTE_SETUP } from "@/lib/pricing-display";
import { formatMoney, type DisplayCurrency } from "@/lib/currency";

const CURRENCY_STORAGE_KEY = "vidora-currency";

/**
 * Pricing with honest per-finished-minute costs and a USD/INR toggle.
 *
 * - USD is the global default; INR is pre-selected only for Indian visitors
 *   (best-effort CDN country header) or when the visitor picks it manually.
 * - 1 credit = 1 finished minute of Story Mode with a standard voice.
 * - Checkout buttons read "Coming soon" until the matching provider is live:
 *   Dodo Payments for USD, Razorpay for INR.
 * - Plan cards render from the server query; while loading, skeletons show.
 */
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
  const currencyFn = useServerFn(getDisplayCurrency);
  const { data: detectedCurrency } = useQuery({
    queryKey: ["display-currency"],
    queryFn: () => currencyFn(),
    staleTime: Infinity,
  });

  const [currency, setCurrency] = useState<DisplayCurrency>("USD");
  useEffect(() => {
    const stored = window.localStorage.getItem(CURRENCY_STORAGE_KEY);
    if (stored === "USD" || stored === "INR") {
      setCurrency(stored);
    } else if (detectedCurrency) {
      setCurrency(detectedCurrency);
    }
  }, [detectedCurrency]);

  const [loggedIn, setLoggedIn] = useState(false);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setLoggedIn(Boolean(data.user)));
  }, []);

  const plans = data ?? [];
  // USD checkout runs through Dodo Payments; INR through Razorpay.
  const currencyLive = currency === "INR" ? Boolean(billingConfig?.razorpay) : Boolean(billingConfig?.dodo);
  const checkoutLive = Boolean(billingConfig?.dodo || billingConfig?.razorpay);

  const pickCurrency = (next: DisplayCurrency) => {
    setCurrency(next);
    window.localStorage.setItem(CURRENCY_STORAGE_KEY, next);
  };

  return (
    <section
      className={cn(
        "w-full border-t border-border",
        compact ? "py-16" : "py-20 sm:py-24",
      )}
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 flex max-w-2xl flex-col gap-6">
          <div>
            <p className="font-mono text-xs tracking-[0.2em] text-[oklch(0.82_0.145_78)]">
              THE RATES
            </p>
            <h2 className="font-display mt-4 text-balance text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              Less than a coffee per finished cut.
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              1 credit = 1 finished minute of video. Premium voices and cinema
              stock cost more per minute — the exact cost is shown before every
              render.
            </p>
          </div>

          <div
            className="inline-flex w-fit items-center gap-1 rounded-lg border border-border p-1"
            role="group"
            aria-label="Currency"
          >
            {(["USD", "INR"] as DisplayCurrency[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => pickCurrency(c)}
                aria-pressed={currency === c}
                className={cn(
                  "rounded-md px-4 py-1.5 text-sm font-semibold transition-colors",
                  currency === c
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {c === "USD" ? "USD $" : "INR ₹"}
              </button>
            ))}
          </div>
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
              const price =
                currency === "INR" && plan.price_monthly_inr != null
                  ? Number(plan.price_monthly_inr)
                  : Number(plan.price_monthly);
              const perMinute =
                plan.credits > 0
                  ? `≈ ${formatMoney(currency, price / plan.credits)} per finished minute`
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
                        {formatMoney(currency, price)}
                      </span>
                      <span className="text-muted-foreground">/mo</span>
                    </div>
                    {perMinute && (
                      <p className="mt-2 text-sm font-medium text-[oklch(0.82_0.145_78)]">
                        {perMinute}
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
                      1 credit = 1 finished minute
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

                  {currencyLive ? (
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
                  ) : (
                    <button
                      type="button"
                      disabled
                      title="Checkout is being set up"
                      className="w-full cursor-not-allowed rounded-lg border border-dashed border-border px-4 py-3.5 text-center text-sm font-bold text-muted-foreground"
                    >
                      Coming soon
                    </button>
                  )}
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
