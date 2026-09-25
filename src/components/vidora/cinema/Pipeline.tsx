import { FileText, Mic, Image, Captions, Clapperboard } from "lucide-react";

const SCENES = [
  {
    no: "01",
    icon: FileText,
    title: "The script",
    body: "Drop in a topic or a rough draft. Vidora structures it into scenes with hooks, beats, and a payoff — in English or Hindi.",
  },
  {
    no: "02",
    icon: Mic,
    title: "The voice",
    body: "Pick from 25+ narrators. Hindi-first voices that actually sound human, plus English, Spanish, and French.",
  },
  {
    no: "03",
    icon: Image,
    title: "The stills",
    body: "Every scene gets a generated still in one of 10 visual styles — cinematic, anime, documentary, and more. Characters stay consistent.",
  },
  {
    no: "04",
    icon: Captions,
    title: "The captions",
    body: "Word-level captions burned into the frame, timed to the narration. The way Shorts are actually watched: muted, on a phone.",
  },
  {
    no: "05",
    icon: Clapperboard,
    title: "The film",
    body: "Music ducked under the voiceover, scenes cut to 1080p, one MP4. Download it or publish straight to YouTube.",
  },
];

/** The pipeline as a shot list — not cards. */
export function Pipeline() {
  return (
    <section className="relative border-t border-border">
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <div className="mb-16 max-w-2xl">
          <p className="font-mono text-xs tracking-[0.2em] text-[oklch(0.82_0.145_78)]">
            THE PIPELINE
          </p>
          <h2 className="font-display mt-4 text-balance text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Five scenes. One take.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            No timeline to learn, no assets to hunt. Each stage hands off to the
            next automatically.
          </p>
        </div>

        <ol>
          {SCENES.map((s, i) => (
            <li
              key={s.no}
              className={`group grid gap-4 border-t border-border py-8 transition-colors duration-200 hover:bg-white/[0.02] sm:grid-cols-[80px_48px_1fr_2fr] sm:items-start sm:gap-6 sm:px-4 ${
                i === SCENES.length - 1 ? "border-b" : ""
              }`}
            >
              <span className="font-mono text-sm text-muted-foreground">{s.no}</span>
              <span className="hidden size-12 items-center justify-center rounded-lg border border-border text-[oklch(0.82_0.145_78)] sm:inline-flex">
                <s.icon className="h-5 w-5" />
              </span>
              <h3 className="font-display text-2xl font-bold text-foreground">{s.title}</h3>
              <p className="max-w-xl leading-relaxed text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
