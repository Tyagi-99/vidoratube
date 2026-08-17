import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const plans = [
  {
    name: "Creator",
    originalPrice: "$39",
    price: "$27",
    period: "/mo",
    perVideo: "≈ $2.25 per finished video",
    description: "A few uploads a week to get a channel moving.",
    credits: "1,440 credits",
    creditsDetail: "≈12 videos · 15 min each",
    features: [
      "Videos up to 25 minutes",
      "100+ AI voices per language · 14 languages",
      "1080p videos with captions",
      "Real footage on every scene",
    ],
    cta: "Start with Creator",
    popular: false,
  },
  {
    name: "Studio",
    originalPrice: "$89",
    price: "$59",
    period: "/mo",
    perVideo: "≈ $1.97 per finished video",
    description: "A daily upload, the pace that grows channels.",
    credits: "3,600 credits",
    creditsDetail: "≈30 videos · 15 min each",
    features: [
      "Videos up to 25 minutes",
      "Auto captions, music & SFX",
      "Every video rendered at full 1080p quality",
      "Downloads included · regenerate anytime",
      "Everything in Creator",
    ],
    cta: "Grow with Studio →",
    popular: true,
  },
  {
    name: "Agency",
    originalPrice: "$159",
    price: "$107",
    period: "/mo",
    perVideo: "≈ $1.78 per finished video — best value",
    description: "For networks running several channels at once.",
    credits: "7,200 credits",
    creditsDetail: "≈60 videos · 15 min each",
    features: [
      "Videos up to 25 minutes",
      "Priority support & onboarding",
      "Best price per finished video",
      "Everything in Studio",
    ],
    cta: "Scale with Agency",
    popular: false,
  },
];

export function PricingSection({ compact = false }: { compact?: boolean }) {
  return (
    <section className={cn("w-full bg-background", compact ? "py-16" : "py-24")}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-primary">
            Pricing
          </p>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Less than a coffee per finished video
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Simple credit pricing — pick the plan that matches your upload schedule. You only pay for the videos you make.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={cn(
                "relative flex flex-col rounded-2xl border bg-card p-6 shadow-sm transition-shadow hover:shadow-md",
                plan.popular && "border-primary/50 ring-1 ring-primary/20"
              )}
            >
              {plan.popular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                  MOST POPULAR
                </span>
              )}
              <div className="mb-4">
                <h3 className="text-xl font-semibold text-foreground">{plan.name}</h3>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-lg text-muted-foreground line-through">
                    {plan.originalPrice}
                  </span>
                  <span className="text-4xl font-bold text-foreground">
                    {plan.price}
                  </span>
                  <span className="text-muted-foreground">{plan.period}</span>
                </div>
                <p className="mt-1 text-sm font-medium text-primary">{plan.perVideo}</p>
                <p className="mt-2 text-sm text-muted-foreground">{plan.description}</p>
              </div>

              <div className="mb-4 rounded-xl bg-muted p-4">
                <div className="flex items-center gap-2 text-foreground">
                  <Check className="h-4 w-4 text-primary" />
                  <span className="font-semibold">{plan.credits}</span>
                </div>
                <p className="ml-6 text-sm text-muted-foreground">{plan.creditsDetail}</p>
              </div>

              <ul className="mb-6 flex-1 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3 text-sm text-foreground">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {feature}
                  </li>
                ))}
              </ul>

              <button
                className={cn(
                  "w-full rounded-full px-4 py-2.5 text-sm font-semibold transition-colors",
                  plan.popular
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "border border-border bg-background text-foreground hover:bg-muted"
                )}
              >
                {plan.cta}
              </button>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          Cancel anytime in one click · your credit allowance resets every month
        </p>
      </div>
    </section>
  );
}

export function PricingSectionCompact() {
  return <PricingSection compact />;
}
