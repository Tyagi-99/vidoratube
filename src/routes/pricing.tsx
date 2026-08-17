import { createFileRoute } from "@tanstack/react-router";
import { PricingSection } from "@/components/gomotion/PricingSection";
import { FaqSection } from "@/components/gomotion/FaqSection";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — GoMotion" },
      { name: "description", content: "Simple credit pricing for AI-generated YouTube videos. Pick the plan that matches your upload schedule." },
      { property: "og:title", content: "Pricing — GoMotion" },
      { property: "og:description", content: "Simple credit pricing for AI-generated YouTube videos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PricingPage,
});

function PricingPage() {
  return (
    <main className="min-h-screen bg-background pt-16">
      <div className="mx-auto max-w-6xl px-4 pt-16 pb-8 sm:px-6 lg:px-8">
        <h1 className="text-center text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          Pricing
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-center text-lg text-muted-foreground">
          Less than a coffee per finished video. Simple credit pricing — pick the plan that matches your upload schedule.
        </p>
      </div>
      <PricingSection />
      <FaqSection />
    </main>
  );
}
