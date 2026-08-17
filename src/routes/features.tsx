import { createFileRoute } from "@tanstack/react-router";
import { FeatureSection } from "@/components/vidora/FeatureSection";
import { ResultsSection } from "@/components/vidora/ResultsSection";
import { DemoUI } from "@/components/vidora/DemoUI";
import { useState } from "react";
import { GenerateVideoDialog } from "@/components/vidora/GenerateVideoDialog";

export const Route = createFileRoute("/features")({
  head: () => ({
    meta: [
      { title: "Features — Vidora" },
      { name: "description", content: "Everything an editor would do, done for you. Human-grade voiceover, real footage, captions, motion graphics, music and SFX." },
      { property: "og:title", content: "Features — Vidora" },
      { property: "og:description", content: "Everything an editor would do, done for you." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FeaturesPage,
});

function FeaturesPage() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <main className="min-h-screen bg-background pt-16">
      <div className="mx-auto max-w-6xl px-4 pt-16 pb-8 sm:px-6 lg:px-8">
        <h1 className="text-center text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          Features
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-center text-lg text-muted-foreground">
          A full editing crew behind every click: voice actor, asset manager, motion designer, sound designer, and video editor.
        </p>
      </div>

      <div className="mx-auto max-w-5xl px-4 pb-24 sm:px-6 lg:px-8">
        <DemoUI onGenerate={() => setDialogOpen(true)} />
      </div>

      <FeatureSection />
      <ResultsSection />

      <GenerateVideoDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </main>
  );
}
