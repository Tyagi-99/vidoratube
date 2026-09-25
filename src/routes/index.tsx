import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Wand2 } from "lucide-react";
import { HomeCreateModes } from "@/components/vidora/HomeCreateModes";
import { DemoUI } from "@/components/vidora/DemoUI";
import { PricingSection } from "@/components/vidora/PricingSection";
import { FaqSection } from "@/components/vidora/FaqSection";
import { FeatureSection } from "@/components/vidora/FeatureSection";
import { ResultsSection } from "@/components/vidora/ResultsSection";

const socialProof = ["1080p", "3 modes", "10"];

const socialLabels = ["MP4 download", "script, voiceover, auto-edit", "free credits to start"];

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Vidora AI — Your AI video studio, on autopilot" },
      {
        name: "description",
        content:
          "Vidora turns a script into a 1080p MP4 with AI narration, scene stills, and burned-in captions. Early access — keep the tab open until the file is ready.",
      },
      {
        property: "og:title",
        content: "Vidora AI — Your AI video studio, on autopilot",
      },
      {
        property: "og:description",
        content: "Turn a script into a 1080p MP4 with narration, scene stills, and captions.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://vidoratube.lovable.app/" },
      { property: "og:image", content: "https://vidoratube.lovable.app/og-image.png" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://vidoratube.lovable.app/" }],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="min-h-screen w-full bg-background">
      {/* Hero */}
      <section className="relative overflow-hidden bg-background pt-14 pb-20 sm:pt-20 sm:pb-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <div className="text-left">
              <h1 className="text-4xl font-bold leading-[1.02] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                Your AI video studio, on autopilot
              </h1>

              <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground">
                Script in, 1080p MP4 out. Vidora writes a scene plan, narrates it, generates stills,
                and burns captions. Keep the tab open until Download appears.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <a
                  href="#create"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] bg-primary px-6 py-3 text-base font-semibold text-primary-foreground transition-colors duration-200 hover:bg-primary/90"
                >
                  <Wand2 className="h-5 w-5" />
                  Start a video
                </a>
                <Link
                  to="/features"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] border border-border bg-card px-6 py-3 text-base font-semibold text-foreground transition-colors duration-200 hover:bg-muted"
                >
                  Watch the workflow
                  <ArrowRight className="h-5 w-5" />
                </Link>
              </div>

              <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border pt-6 text-sm text-muted-foreground">
                {["No timeline required", "EN / ES / FR voices", "1080p MP4"].map((item) => (
                  <div key={item} className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-accent" />
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:-mr-6">
              <DemoUI
                onGenerate={() => {
                  window.location.href = "/studio?create=script";
                }}
              />
            </div>
          </div>

          <dl className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3">
            {socialProof.map((value, index) => (
              <div key={index} className="bg-card px-6 py-7 text-left">
                <dt className="sr-only">{socialLabels[index]}</dt>
                <dd>
                  <p className="font-display text-3xl font-semibold tracking-tight text-foreground tabular-nums">
                    {value}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{socialLabels[index]}</p>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <HomeCreateModes />
      <FeatureSection />
      <ResultsSection />
      <PricingSection />
      <FaqSection />

      <section className="w-full bg-background pb-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl border border-border bg-card px-6 py-14 sm:px-14">
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Close the timeline. Open the render queue.
            </h2>
            <p className="mt-4 max-w-xl text-lg text-muted-foreground">
              Your first cut is a script and an account. Ten free credits, no card.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Checkout is not live yet. Create a free account for 10 render credits — no card
              needed.
            </p>
            <Link
              to="/studio"
              search={{ create: "script" }}
              className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-primary px-6 py-3 text-base font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5"
            >
              <Wand2 className="h-5 w-5" />
              Render your first video
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
