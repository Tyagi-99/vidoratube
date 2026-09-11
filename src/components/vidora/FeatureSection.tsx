import { Mic, Film, Type, Palette, Music, FileVideo } from "lucide-react";
import { cn } from "@/lib/utils";

const features = [
  {
    icon: Film,
    title: "Scene stills from your script",
    description:
      "Vidora breaks the script into scenes and generates an image for each beat. Stock video matching is on the studio path when keys are configured.",
    badge: "script → scenes",
    span: "lg:col-span-2 lg:row-span-1",
  },
  {
    icon: Mic,
    title: "AI narration",
    description:
      "A short voice list on the quick path (English, Spanish, French). Upload your own footage in Voiceover mode.",
    badge: null,
    span: "",
  },
  {
    icon: Type,
    title: "Burned-in captions",
    description: "Captions are burned into the MP4, one readable cue per scene — not karaoke word-sync yet.",
    badge: "on-screen",
    span: "",
  },
  {
    icon: Palette,
    title: "Simple motion",
    description: "Ken Burns-style moves on stills so the cut does not sit static.",
    badge: null,
    span: "",
  },
  {
    icon: Music,
    title: "Optional music",
    description:
      "You can attach a music bed on the studio render path. We do not claim a cleared commercial library yet.",
    badge: null,
    span: "",
  },
  {
    icon: FileVideo,
    title: "One 1080p MP4",
    description:
      "The download is a muxed MP4. Keep the tab open until it finishes — compose currently runs in the browser.",
    badge: "master.mp4 · 1080p",
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
            What a Vidora render includes today
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

