import { createFileRoute } from "@tanstack/react-router";
import { PricingSection } from "@/components/vidora/PricingSection";
import { FaqSection } from "@/components/vidora/FaqSection";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — Vidora" },
      { name: "description", content: "Simple credit pricing for AI-generated YouTube videos. Pick the plan that matches your upload schedule." },
      { property: "og:title", content: "Pricing — Vidora" },
      { property: "og:description", content: "Simple credit pricing for AI-generated YouTube videos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PricingPage,
});

function PricingPage() {
  return (
    <div className="min-h-screen bg-background pt-16">
      <div className="mx-auto max-w-6xl px-4 pt-16 pb-8 sm:px-6 lg:px-8">
        <h1 className="text-center text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          Pricing
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-center text-lg text-muted-foreground">
          Credit packs we intend to sell. Checkout is not live — start with 10 free credits.
        </p>
        <p className="mx-auto mt-6 max-w-2xl rounded-[10px] border border-dashed border-accent/40 px-4 py-3 text-center text-sm text-foreground">
          Early access: create a free account for 10 render credits — no card needed. Checkout is not live yet.
        </p>
      </div>
      <PricingSection />
      <FaqSection />
    </div>
  );
}
