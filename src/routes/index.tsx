import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Check, Wand2, Play, Sparkles, Zap, Clock } from "lucide-react";
import { GenerateVideoDialog } from "@/components/vidora/GenerateVideoDialog";
import { DemoUI } from "@/components/vidora/DemoUI";
import { PricingSection } from "@/components/vidora/PricingSection";
import { FaqSection } from "@/components/vidora/FaqSection";
import { FeatureSection } from "@/components/vidora/FeatureSection";
import { ResultsSection } from "@/components/vidora/ResultsSection";

const socialProof = ["14M+", "1M+", "$500K+"];

const socialLabels = ["views delivered", "subscribers gained", "creator revenue"];

const processSteps = [
  {
    number: "01",
    title: "Drop in your script",
    description: "Any topic, any length, any language. Vidora breaks it into a scene-by-scene plan.",
  },
  {
    number: "02",
    title: "Choose voice & look",
    description: "Pick a studio voice and a visual register that matches your channel.",
  },
  {
    number: "03",
    title: "Hit render",
    description: "Narration, footage, captions, music and motion are assembled into a 1080p cut.",
  },
  {
    number: "04",
    title: "Ship it",
    description: "Download the MP4 and publish. No timeline, no keyframes, no all-nighter.",
  },
];

const niches = [
  "History",
  "Finance",
  "Celebrities",
  "Science",
  "Film",
  "Sports",
  "Space",
  "Nature",
  "True crime",
  "Mystery",
  "Travel",
  "Sleep",
];

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Vidora AI — Your AI video studio, on autopilot" },
      {
        name: "description",
        content:
          "Vidora AI turns a script into a finished video — AI narration, real footage, word-synced captions, music and motion graphics, rendered in one pass.",
      },
      {
        property: "og:title",
        content: "Vidora AI — Your AI video studio, on autopilot",
      },
      {
        property: "og:description",
        content:
          "Turn a script into a finished, ready-to-upload video with narration, footage, captions, music and motion.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});


function Index() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <main className="min-h-screen w-full bg-background">
      {/* Hero */}
      <section className="relative overflow-hidden bg-background pt-12 pb-20 sm:pt-16 sm:pb-28">
        <div className="absolute top-0 left-0 -z-10 h-[520px] w-[820px] -translate-x-1/4 rounded-full bg-top-glow opacity-70 blur-3xl" />

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <div className="text-left">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-semibold tracking-wide text-foreground uppercase">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span>Render-first video studio</span>
              </div>

              <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                Your AI video studio,{" "}
                <span className="text-gradient-brand">on autopilot</span>
              </h1>

              <p className="mt-6 max-w-xl text-lg text-muted-foreground">
                Script in, finished cut out. Vidora writes the shot plan, narrates
                it, sources the footage, syncs the captions and scores the whole
                thing — then hands you a 1080p file.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <button
                  onClick={() => setDialogOpen(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-foreground px-6 py-3 text-base font-semibold text-background transition-transform hover:-translate-y-0.5"
                >
                  <Wand2 className="h-5 w-5" />
                  Render your first video
                </button>
                <Link
                  to="/features"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-card px-6 py-3 text-base font-semibold text-foreground transition-colors hover:bg-muted"
                >
                  Watch the workflow
                  <ArrowRight className="h-5 w-5" />
                </Link>
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
                {["Zero editing skills", "14 languages", "1080p delivery"].map((item) => (
                  <div key={item} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" />
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:-mr-6">
              <DemoUI onGenerate={() => setDialogOpen(true)} />
            </div>
          </div>

          <div className="mt-14 grid gap-6 rounded-3xl border border-border bg-card/70 px-6 py-7 sm:grid-cols-3">
            {socialProof.map((value, index) => (
              <div key={index} className="text-left">
                <p className="font-display text-3xl font-bold text-foreground">{value}</p>
                <p className="mt-1 text-sm text-muted-foreground">{socialLabels[index]}</p>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* How it works */}
      <section className="w-full border-y border-border bg-muted/40 py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="mb-12 max-w-2xl">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              The workflow
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Four moves between a draft and a published video
            </h2>
          </div>

          <div className="grid gap-px overflow-hidden rounded-3xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
            {processSteps.map((step) => (
              <div key={step.number} className="bg-card p-6 lg:p-7">
                <span className="font-display text-sm font-bold tracking-[0.2em] text-primary">
                  {step.number}
                </span>
                <h3 className="mt-5 text-lg font-semibold text-foreground">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Crew section */}
      <section className="w-full bg-background py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="mb-12 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                The crew
              </p>
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Six specialists, one render button
              </h2>
            </div>
            <p className="max-w-sm text-muted-foreground">
              Writers, editors, voice talent, sound designers and researchers —
              coordinated by Vidora instead of a production schedule.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { title: "Story architect", desc: "Reshapes your draft into a structure that holds attention past the hook.", icon: Sparkles },
              { title: "Voice talent", desc: "100+ voices across 14 languages, or bring your own narration track.", icon: Play },
              { title: "Footage researcher", desc: "Finds and cuts real clips against every sentence of the script.", icon: Zap },
              { title: "Motion designer", desc: "Layers captions, punch-ins, counters and map reveals where they land.", icon: Wand2 },
              { title: "Sound designer", desc: "Scores and mixes music and SFX beneath the voice, cleared for monetization.", icon: Clock },
              { title: "Post producer", desc: "Bakes the master and delivers a 1080p MP4 ready for upload.", icon: Check },
            ].map((role) => (
              <div key={role.title} className="surface-card flex items-start gap-4 p-6">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-foreground">
                  <role.icon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-foreground">{role.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{role.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Niches */}
      <section className="w-full bg-muted/40 py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-center">
            <h2 className="max-w-xs shrink-0 text-2xl font-bold tracking-tight text-foreground">
              Built for the niches that actually scale
            </h2>
            <div className="flex flex-wrap gap-2.5">
              {niches.map((niche) => (
                <span
                  key={niche}
                  className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground"
                >
                  {niche}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <FeatureSection />
      <ResultsSection />
      <PricingSection />
      <FaqSection />

      {/* Final CTA */}
      <section className="w-full bg-background pb-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-[2rem] bg-foreground px-6 py-16 sm:px-14 sm:py-20">
            <div className="absolute -top-20 -right-16 h-72 w-72 rounded-full bg-accent/25 blur-3xl" />
            <div className="relative max-w-xl">
              <h2 className="text-3xl font-bold tracking-tight text-background sm:text-4xl">
                Close the timeline. Open the render queue.
              </h2>
              <p className="mt-4 text-lg text-background/70">
                Your first Vidora cut takes one script and one click. No card needed to try it.
              </p>
              <button
                onClick={() => setDialogOpen(true)}
                className="mt-8 inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-base font-semibold text-foreground transition-transform hover:-translate-y-0.5"
              >
                <Wand2 className="h-5 w-5" />
                Render your first video
              </button>
            </div>
          </div>
        </div>
      </section>


      <GenerateVideoDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </main>
  );
}
