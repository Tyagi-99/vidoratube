const features = [
  {
    n: "01",
    title: "Scene stills from your script",
    description:
      "Vidora breaks the script into scenes and generates an image for each beat. Stock video matching is on the studio path when keys are configured.",
  },
  {
    n: "02",
    title: "AI narration",
    description:
      "A short voice list on the quick path (English, Spanish, French). Upload your own footage in Voiceover mode.",
  },
  {
    n: "03",
    title: "Burned-in captions",
    description: "Captions are burned into the MP4, one readable cue per scene — not karaoke word-sync yet.",
  },
  {
    n: "04",
    title: "Simple motion",
    description: "Ken Burns-style moves on stills so the cut does not sit static.",
  },
  {
    n: "05",
    title: "Optional music",
    description:
      "You can attach a music bed on the studio render path. We do not claim a cleared commercial library yet.",
  },
  {
    n: "06",
    title: "One 1080p MP4",
    description:
      "The download is a muxed MP4. Keep the tab open until it finishes — compose currently runs in the browser.",
  },
];

export function FeatureSection() {
  return (
    <section className="w-full bg-background py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-8 max-w-2xl">
          <p className="mb-3 text-xs font-semibold text-accent">Inside a render</p>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            What a Vidora render includes today
          </h2>
        </div>

        <div className="border-t border-border">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="grid gap-3 border-b border-border py-6 sm:grid-cols-[5rem_1fr] sm:items-start"
            >
              <span className="font-display text-sm tabular-nums text-accent">{feature.n}</span>
              <div>
                <h3 className="text-lg font-semibold text-foreground">{feature.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
