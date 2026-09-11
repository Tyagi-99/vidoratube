import { createFileRoute } from "@tanstack/react-router";
import { FeatureSection } from "@/components/vidora/FeatureSection";
import { ResultsSection } from "@/components/vidora/ResultsSection";
import { DemoUI } from "@/components/vidora/DemoUI";

export const Route = createFileRoute("/features")({
  head: () => ({
    meta: [
      { title: "Features — Vidora" },
      {
        name: "description",
        content:
          "Script to 1080p MP4: AI narration, scene stills, and burned-in captions. Voiceover and automatic edit for footage you own.",
      },
      { property: "og:title", content: "Features — Vidora" },
      { property: "og:description", content: "What Vidora actually renders today." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FeaturesPage,
});

function FeaturesPage() {
  return (
    <div className="min-h-screen bg-background pt-16">
      <div className="mx-auto max-w-6xl px-4 pt-16 pb-8 sm:px-6 lg:px-8">
        <h1 className="text-center text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          Features
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-center text-lg text-muted-foreground">
          A script-to-MP4 studio in early access. The mock below is a product sketch, not a finished
          render.
        </p>
      </div>

      <div className="mx-auto max-w-5xl px-4 pb-24 sm:px-6 lg:px-8">
        <DemoUI onGenerate={() => { window.location.href = "/studio?create=script"; }} />
      </div>

      <FeatureSection />
      <ResultsSection />
    </div>
  );
}
