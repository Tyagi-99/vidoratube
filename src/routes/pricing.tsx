import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PricingSection } from "@/components/vidora/PricingSection";
import { FaqSection } from "@/components/vidora/FaqSection";
import { getBillingConfig } from "@/lib/billing.functions";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — Vidora" },
      {
        name: "description",
        content:
          "Simple credit pricing for AI-generated YouTube videos. Pick the plan that matches your upload schedule.",
      },
      { property: "og:title", content: "Pricing — Vidora" },
      {
        property: "og:description",
        content: "Simple credit pricing for AI-generated YouTube videos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PricingPage,
});

function PricingPage() {
  const configFn = useServerFn(getBillingConfig);
  const { data: billingConfig } = useQuery({
    queryKey: ["billing-config"],
    queryFn: () => configFn(),
  });
  const checkoutLive = Boolean(billingConfig?.dodo || billingConfig?.razorpay);

  return (
    <main className="min-h-screen bg-background pt-16">
      <div className="mx-auto max-w-6xl px-4 pt-16 pb-8 sm:px-6 lg:px-8">
        <h1 className="text-center text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          Pricing
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-center text-lg text-muted-foreground">
          {checkoutLive
            ? "Simple credit pricing for AI-generated YouTube videos. Pick the plan that matches your upload schedule."
            : "Credit packs we intend to sell. Checkout is being set up — start with 10 free credits."}
        </p>
        {!checkoutLive && (
          <p className="mx-auto mt-6 max-w-2xl rounded-[10px] border border-dashed border-accent/40 px-4 py-3 text-center text-sm text-foreground">
            Early access: create a free account for 10 render credits — no card needed. Checkout is
            being set up.
          </p>
        )}
      </div>
      <PricingSection />
      <FaqSection />
    </main>
  );
}
