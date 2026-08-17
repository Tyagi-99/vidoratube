import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const plans = [
  {
    name: "Starter",
    originalPrice: "$39",
    price: "$27",
    period: "/mo",
    perVideo: "≈ $2.25 per finished cut",
    description: "A few uploads a week to get a channel moving.",
    credits: "1,440 credits",
    creditsDetail: "≈12 videos · 15 min each",
    features: [
      "Videos up to 25 minutes",
      "100+ AI voices · 14 languages",
      "1080p delivery with captions",
      "Real footage on every scene",
    ],
    cta: "Start with Starter",
    popular: false,
  },
  {
    name: "Studio",
    originalPrice: "$89",
    price: "$59",
    period: "/mo",
    perVideo: "≈ $1.97 per finished cut",
    description: "A daily upload — the pace that actually compounds.",
    credits: "3,600 credits",
    creditsDetail: "≈30 videos · 15 min each",
    features: [
      "Videos up to 25 minutes",
      "Auto captions, score & SFX",
      "Full 1080p renders, every time",
      "Downloads included · re-render anytime",
      "Everything in Starter",
    ],
    cta: "Grow with Studio",
    popular: true,
  },
  {
    name: "Scale",
    originalPrice: "$159",
    price: "$107",
    period: "/mo",
    perVideo: "≈ $1.78 per finished cut — best rate",
    description: "For networks running several channels at once.",
    credits: "7,200 credits",
    creditsDetail: "≈60 videos · 15 min each",
    features: [
      "Videos up to 25 minutes",
      "Priority queue & onboarding",
      "Best rate per finished cut",
      "Everything in Studio",
    ],
    cta: "Scale up",
    popular: false,
  },
];

export function PricingSection({ compact = false }: { compact?: boolean }) {
  return (
    <section className={cn("w-full bg-muted/40 border-y border-border", compact ? "py-16" : "py-20 sm:py-24")}>
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
            Credit-based, no seats, no surprises. You only spend on the videos you actually render.
          </p>
        </div>

        <div className="grid items-start gap-5 lg:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={cn(
                "relative flex flex-col rounded-3xl border border-border bg-card p-7",
                plan.popular &&
                  "border-transparent bg-foreground text-background shadow-[0_30px_60px_-40px_oklch(0.235_0.035_196/0.8)] lg:-mt-4 lg:pb-10"
              )}
            >
              {plan.popular && (
                <span className="absolute -top-3 left-7 rounded-full bg-accent px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-foreground">
                  Most popular
                </span>
              )}
              <div className="mb-5">
                <h3
                  className={cn(
                    "text-sm font-semibold uppercase tracking-[0.18em]",
                    plan.popular ? "text-accent" : "text-primary"
                  )}
                >
                  {plan.name}
                </h3>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className={cn("text-base line-through", plan.popular ? "text-background/50" : "text-muted-foreground")}>
                    {plan.originalPrice}
                  </span>
                  <span className="font-display text-4xl font-bold">{plan.price}</span>
                  <span className={plan.popular ? "text-background/60" : "text-muted-foreground"}>
                    {plan.period}
                  </span>
                </div>
                <p className={cn("mt-1 text-sm font-medium", plan.popular ? "text-accent" : "text-primary")}>
                  {plan.perVideo}
                </p>
                <p className={cn("mt-2 text-sm", plan.popular ? "text-background/70" : "text-muted-foreground")}>
                  {plan.description}
                </p>
              </div>

              <div
                className={cn(
                  "mb-5 rounded-2xl p-4",
                  plan.popular ? "bg-background/10" : "bg-muted"
                )}
              >
                <div className="flex items-center gap-2 font-semibold">
                  <Check className={cn("h-4 w-4", plan.popular ? "text-accent" : "text-primary")} />
                  {plan.credits}
                </div>
                <p className={cn("ml-6 text-sm", plan.popular ? "text-background/60" : "text-muted-foreground")}>
                  {plan.creditsDetail}
                </p>
              </div>

              <ul className="mb-7 flex-1 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3 text-sm">
                    <Check className={cn("mt-0.5 h-4 w-4 shrink-0", plan.popular ? "text-accent" : "text-primary")} />
                    {feature}
                  </li>
                ))}
              </ul>

              <button
                className={cn(
                  "w-full rounded-full px-4 py-3 text-sm font-semibold transition-transform hover:-translate-y-0.5",
                  plan.popular
                    ? "bg-accent text-foreground"
                    : "bg-foreground text-background"
                )}
              >
                {plan.cta}
              </button>
            </div>
          ))}
        </div>

        <p className="mt-8 text-sm text-muted-foreground">
          Cancel in one click · credits reset monthly
        </p>
      </div>
    </section>
  );
}


export function PricingSectionCompact() {
  return <PricingSection compact />;
}
