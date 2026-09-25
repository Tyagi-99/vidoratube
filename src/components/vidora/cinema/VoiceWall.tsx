const VOICES = [
  "George — English, narrator",
  "Sarah — English, storyteller",
  "Rachel — English, warm",
  "Adam — English, deep",
  "Domi — English, expressive",
  "Elli — English, bright",
  "Josh — English, conversational",
  "Arnold — English, documentary",
  "Antoni — English, calm",
  "Nova — English, modern",
  "Aisha — Hindi, warm",
  "Arjun — Hindi, deep",
  "Kavya — Hindi, bright",
  "Vikram — Hindi, steady",
];

export function VoiceWall() {
  const row = [...VOICES, ...VOICES];
  return (
    <section className="relative overflow-hidden border-t border-border">
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <div className="mb-12 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-xl">
            <p className="font-mono text-xs tracking-[0.2em] text-[oklch(0.82_0.145_78)]">
              THE CAST
            </p>
            <h2 className="font-display mt-4 text-balance text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              Cast your narrator.
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              16 built-in voices. Not the flat robot read — directors pick
              for warmth, gravity, or mischief. More languages in beta.
            </p>
          </div>
          <a
            href="/studio"
            className="shrink-0 font-mono text-sm text-[oklch(0.82_0.145_78)] underline-offset-4 hover:underline"
          >
            Hear them in the studio →
          </a>
        </div>
      </div>

      {/* Marquee */}
      <div className="relative pb-24">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-background to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-background to-transparent" />
        <div className="flex w-max animate-marquee gap-3">
          {row.map((v, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-card px-5 py-3 text-sm text-foreground"
            >
              <span className="size-1.5 rounded-full bg-[oklch(0.82_0.145_78)]" />
              {v}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
