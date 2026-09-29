import { Link } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { Timecode } from "./Timecode";

export function FinalCta() {
  return (
    <section className="film-grain relative overflow-hidden border-t border-border">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 80% at 50% 100%, oklch(0.82 0.145 78 / 0.12), transparent 70%)",
        }}
      />
      <div className="relative mx-auto max-w-4xl px-4 py-32 text-center sm:px-6">
        <Timecode className="text-sm text-muted-foreground" />
        <h2 className="font-display mx-auto mt-6 max-w-3xl text-balance text-5xl font-extrabold leading-[0.98] tracking-tight text-foreground sm:text-6xl">
          Your next video is a script away.
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
          Start with 10 free credits. No card, no timeline to learn — just type
          and render.
        </p>
        <div className="mt-10">
          <Link
            to="/studio"
            className="inline-flex min-h-14 items-center justify-center gap-2 rounded-lg bg-primary px-10 text-lg font-bold text-primary-foreground transition-transform duration-200 hover:scale-[1.02] active:scale-[0.99]"
          >
            <Play className="h-5 w-5 fill-current" />
            Roll camera
          </Link>
        </div>
        <p className="mt-6 font-mono text-xs text-muted-foreground">
          1080p MP4 · yours to keep · review &amp; publish to YouTube
        </p>
      </div>
    </section>
  );
}
