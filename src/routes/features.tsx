import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/features")({
  head: () => ({
    meta: [
      { title: "Features — GoMotion" },
      { name: "description", content: "Everything an editor would do, done for you. Human-grade voiceover, real footage, captions, motion graphics, music and SFX." },
      { property: "og:title", content: "Features — GoMotion" },
      { property: "og:description", content: "Everything an editor would do, done for you." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FeaturesPage,
});

function FeaturesPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 lg:px-8">
      <h1 className="text-center text-4xl font-bold tracking-tight text-foreground">
        Features
      </h1>
      <p className="mx-auto mt-4 max-w-2xl text-center text-lg text-muted-foreground">
        A full editing crew behind every click: voice actor, asset manager, motion designer, sound designer, and video editor.
      </p>
    </div>
  );
}
