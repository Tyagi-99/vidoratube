import { Mic, Film, Type, Palette, Music, FileVideo } from "lucide-react";
import { cn } from "@/lib/utils";

const features = [
  {
    icon: Film,
    title: "Real footage on every beat",
    description:
      "Vidora reads the script line by line and pulls licensed clips that actually match what's being said, then cuts them to the narration.",
    badge: "scene_plan · 42 shots",
    span: "lg:col-span-2 lg:row-span-1",
  },
  {
    icon: Mic,
    title: "Human-grade narration",
    description:
      "100+ studio voices across 14 languages — or upload your own track and Vidora builds around it.",
    badge: null,
    span: "",
  },
  {
    icon: Type,
    title: "Word-synced captions",
    description: "Karaoke captions land on the exact syllable, styled to your channel.",
    badge: "+38,412 COUNTER",
    span: "",
  },
  {
    icon: Palette,
    title: "Motion that earns its place",
    description:
      "Punch-ins, kinetic type, counters and map reveals, placed only where the script asks for them.",
    badge: null,
    span: "",
  },
  {
    icon: Music,
    title: "Scored and mixed",
    description:
      "A soundtrack that tracks the story, ducked under the voice, cleared for monetization.",
    badge: null,
    span: "",
  },
  {
    icon: FileVideo,
    title: "One file, ready to publish",
    description:
      "A 1080p master with everything baked in. Drag it straight into your upload queue.",
    badge: "master.mp4 · 1080p · 11:42",
    span: "lg:col-span-2",
  },
];

export function FeatureSection() {
  return (
    <section className="w-full bg-background py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 max-w-2xl">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Inside a render
          </p>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Everything an edit suite does, minus the edit suite
          </h2>
        </div>

        <div className="grid auto-rows-fr gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className={cn("surface-card flex flex-col p-6", feature.span)}
            >
              <div className="mb-5 flex items-center justify-between gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-foreground">
                  <feature.icon className="h-5 w-5" />
                </div>
                {feature.badge && (
                  <span className="rounded-full bg-muted px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
                    {feature.badge}
                  </span>
                )}
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

