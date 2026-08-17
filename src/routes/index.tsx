import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Check, Wand2, Play, Sparkles, Zap, Clock } from "lucide-react";
import { GenerateVideoDialog } from "@/components/vidora/GenerateVideoDialog";
import { DemoUI } from "@/components/vidora/DemoUI";
import { PricingSection } from "@/components/vidora/PricingSection";
import { FaqSection } from "@/components/vidora/FaqSection";
import { FeatureSection } from "@/components/vidora/FeatureSection";
import { ResultsSection } from "@/components/vidora/ResultsSection";

const socialProof = [
  "14,000,000+",
  "1,000,000+",
  "$500,000+",
];

const socialLabels = [
  "views generated",
  "subscribers gained",
  "revenue earned",
];

const processSteps = [
  {
    number: "01",
    title: "Paste your script",
    description: "Any topic, any length, any language. We'll break it into a scene-by-scene plan.",
  },
  {
    number: "02",
    title: "Pick a voice & format",
    description: "Choose a studio-grade voice and a style that matches your channel.",
  },
  {
    number: "03",
    title: "Click Generate",
    description: "We assemble narration, footage, captions, music, and motion into a 1080p video.",
  },
  {
    number: "04",
    title: "Publish",
    description: "Download the MP4 and upload it to YouTube. One click, one video, one day closer to Partner.",
  },
];

const niches = [
  "History",
  "Finance",
  "Celebrities",
  "Science",
  "Movies",
  "Sports",
  "Aliens",
  "Nature",
  "Conspiracies",
  "Mystery",
  "Cities",
  "Sleep",
];

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Vidora AI — Create faceless YouTube videos in one click" },
      {
        name: "description",
        content:
          "Turn any script into a monetizable YouTube video with AI narration, real footage, captions, music and motion graphics.",
      },
      {
        property: "og:title",
        content: "Vidora AI — Create faceless YouTube videos in one click",
      },
      {
        property: "og:description",
        content:
          "Turn any script into a monetizable YouTube video with AI narration, real footage, captions, music and motion graphics.",
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
      <section className="relative overflow-hidden bg-background pt-16 pb-24 sm:pt-20 sm:pb-32">
        <div className="absolute top-0 left-1/2 -z-10 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-top-glow opacity-60 blur-3xl" />

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-4xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-sm">
              <Sparkles className="h-4 w-4 text-primary" />
              <span>One-click video production</span>
            </div>

            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl md:text-6xl lg:text-7xl">
              Create faceless{" "}
              <span className="text-gradient-brand">YouTube videos</span> in one click
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground sm:text-xl">
              Paste your script. Pick a voice. Click generate. Get a fully-edited,
              monetizable YouTube video with narration, footage, captions, music,
              and motion graphics.
            </p>

            <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <button
                onClick={() => setDialogOpen(true)}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Wand2 className="h-5 w-5" />
                Make your first video
              </button>
              <Link
                to="/features"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-background px-6 py-3 text-base font-semibold text-foreground transition-colors hover:bg-muted"
              >
                See how it works
                <ArrowRight className="h-5 w-5" />
              </Link>
            </div>

            <div className="mt-10 flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" />
                No editing skills needed
              </div>
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" />
                14 languages
              </div>
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" />
                1080p export
              </div>
            </div>
          </div>

          <div className="mt-16">
            <DemoUI onGenerate={() => setDialogOpen(true)} />
          </div>

          <div className="mt-12 flex flex-wrap items-center justify-center gap-8 sm:gap-12">
            {socialProof.map((value, index) => (
              <div key={index} className="text-center">
                <p className="text-2xl font-bold text-foreground sm:text-3xl">{value}</p>
                <p className="text-xs text-muted-foreground sm:text-sm">{socialLabels[index]}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="w-full bg-muted/30 py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="mb-16 text-center">
            <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-primary">
              How it works
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              From script to YouTube video in 4 steps
            </h2>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {processSteps.map((step) => (
              <div
                key={step.number}
                className="relative rounded-2xl border border-border bg-card p-6 shadow-sm"
              >
                <span className="text-4xl font-bold text-primary/20">{step.number}</span>
                <h3 className="mt-4 text-lg font-semibold text-foreground">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Crew section */}
      <section className="w-full bg-background py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="mb-16 text-center">
            <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-primary">
              Your AI crew
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              One click hires a full production team
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
              Writers, editors, voiceover artists, sound designers and footage researchers — all replaced by one button.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { title: "AI Scriptwriter", desc: "Takes your draft and shapes it into a story that keeps viewers watching.", icon: Sparkles },
              { title: "AI Voice Artist", desc: "100+ voices in 14 languages, or bring your own narration.", icon: Play },
              { title: "AI Footage Editor", desc: "Matches real footage to every sentence in your script.", icon: Zap },
              { title: "AI Motion Designer", desc: "Adds captions, zooms, counters and map reveals.", icon: Wand2 },
              { title: "AI Sound Engineer", desc: "Mixes music and SFX under the voice, keeping it clean and monetizable.", icon: Clock },
              { title: "AI Post Producer", desc: "Renders the final 1080p MP4 ready for upload.", icon: Check },
            ].map((role) => (
              <div
                key={role.title}
                className="flex items-start gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <role.icon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground">{role.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{role.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Niches */}
      <section className="w-full bg-muted/30 py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Works in every niche that wins on YouTube
            </h2>
          </div>

          <div className="flex flex-wrap justify-center gap-3">
            {niches.map((niche) => (
              <span
                key={niche}
                className="rounded-full border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground shadow-sm"
              >
                {niche}
              </span>
            ))}
          </div>
        </div>
      </section>

      <FeatureSection />
      <ResultsSection />
      <PricingSection />
      <FaqSection />

      {/* Final CTA */}
      <section className="w-full bg-background py-24">
        <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-3xl bg-primary px-6 py-16 sm:px-12 sm:py-20">
            <div className="absolute top-0 right-0 -mt-10 -mr-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
            <div className="absolute bottom-0 left-0 -mb-10 -ml-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
            <h2 className="relative text-3xl font-bold tracking-tight text-primary-foreground sm:text-4xl">
              Stop editing. Start uploading.
            </h2>
            <p className="relative mx-auto mt-4 max-w-xl text-lg text-primary-foreground/80">
              Your first faceless video is one click away. No credit card required to try it.
            </p>
            <button
              onClick={() => setDialogOpen(true)}
              className="relative mt-8 inline-flex items-center gap-2 rounded-full bg-primary-foreground px-6 py-3 text-base font-semibold text-primary transition-colors hover:bg-primary-foreground/90"
            >
              <Wand2 className="h-5 w-5" />
              Make your first video
            </button>
          </div>
        </div>
      </section>

      <GenerateVideoDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </main>
  );
}
