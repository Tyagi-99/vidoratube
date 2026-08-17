import { Mic, Film, Type, Palette, Music, FileVideo } from "lucide-react";

const features = [
  {
    icon: Mic,
    title: "Human-grade voiceover",
    description:
      "Reads your script like a narrator would. 100+ studio-grade voices in each of 14 languages — or upload your own narration.",
    badge: null,
  },
  {
    icon: Film,
    title: "Real footage, every sentence",
    description: "Real clips matched to what's being said and cut to the narration.",
    badge: "fourteenmengone",
  },
  {
    icon: Type,
    title: "Word-synced captions",
    description: "Karaoke captions hit the exact syllable, styled like the channels that win.",
    badge: "ZOOMSWIPE+38,412 COUNTER",
  },
  {
    icon: Palette,
    title: "Motion graphics & animations",
    description: "Zoom punches, kinetic text, counters and map reveals, placed where the script asks for them.",
    badge: "AMBIENTDRIVINGFINALE",
  },
  {
    icon: Music,
    title: "Music & SFX, mixed",
    description:
      "A soundtrack that follows the story, kept softly under the voice, safe to monetize.",
    badge: null,
  },
  {
    icon: FileVideo,
    title: "The final video, delivered",
    description: "A 1080p MP4 with everything baked in. Drag it into YouTube and publish.",
    badge: "final_cut.mp4 · 1080p · 11:42",
  },
];

export function FeatureSection() {
  return (
    <section className="w-full bg-background py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-16 text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-primary">
            Inside every video
          </p>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Everything an editor would do, done for you
          </h2>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="group relative overflow-hidden rounded-2xl border border-border bg-card p-6 transition-shadow hover:shadow-md"
            >
              {feature.badge && (
                <div className="mb-4 inline-flex rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                  {feature.badge}
                </div>
              )}
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <feature.icon className="h-5 w-5" />
              </div>
              <h3 className="mb-2 text-lg font-semibold text-foreground">{feature.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
