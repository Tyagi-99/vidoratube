import { createFileRoute } from "@tanstack/react-router";
import { Hero } from "@/components/vidora/cinema/Hero";
import { Pipeline } from "@/components/vidora/cinema/Pipeline";
import { VoiceWall } from "@/components/vidora/cinema/VoiceWall";
import { StyleGallery } from "@/components/vidora/cinema/StyleGallery";
import { FinalCta } from "@/components/vidora/cinema/FinalCta";
import { PricingSection } from "@/components/vidora/PricingSection";
import { FaqSection } from "@/components/vidora/FaqSection";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Vidora AI — Script in. Film out." },
      {
        name: "description",
        content:
          "Vidora turns a script into a 1080p MP4 with AI narration, scene stills, and burned-in captions. 25+ voices, 10 visual styles, English and Hindi.",
      },
      { property: "og:title", content: "Vidora AI — Script in. Film out." },
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
    <main className="min-h-screen w-full bg-background text-foreground">
      <Hero />
      <Pipeline />
      <VoiceWall />
      <StyleGallery />
      <PricingSection />
      <FaqSection />
      <FinalCta />
    </main>
  );
}
