import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Play } from "lucide-react";
import { Timecode, RecBadge } from "./Timecode";

const STAGES = [
  { id: "script", label: "Script", duration: 2 },
  { id: "voice", label: "Voice", duration: 3 },
  { id: "stills", label: "Stills", duration: 3 },
  { id: "captions", label: "Captions", duration: 2 },
  { id: "mp4", label: "MP4", duration: 2 },
] as const;

const TOTAL = STAGES.reduce((s, x) => s + x.duration, 0); // 12s loop

const SCENES = [
  {
    caption: "The city never slept. It just changed shifts.",
    img: "/styles/hero-scene-city.jpg",
    alt: "Night city with glowing windows and night-shift workers crossing a bridge",
    grade: "from-amber-950 via-[#2a1c0e] to-black",
  },
  {
    caption: "Every rupee has a story. This one starts in 1947.",
    img: "/styles/hero-scene-rupee.jpg",
    alt: "A weathered 1947 one-rupee coin on old newspaper in warm lamplight",
    grade: "from-stone-900 via-[#1c1712] to-black",
  },
  {
    caption: "Three seconds. That's all a hook gets.",
    img: "/styles/hero-scene-hook.jpg",
    alt: "A film clapperboard snapping shut in front of a glowing cinema screen",
    grade: "from-[#241408] via-[#170f08] to-black",
  },
];

/** The monitor: a 16:9 frame showing a render in progress. */
export function loopElapsed(nowMs: number, startMs: number): number {
  // rAF timestamps can predate the performance.now() captured when the effect
  // ran (observed in Firefox). Without the clamp, the first tick sets t to a
  // tiny negative, Math.floor(negative / 3) % 4 yields -1, SCENES[-1] is
  // undefined, and `scene.grade` throws during render — unmounting the whole
  // homepage. That was the "Cannot read properties of undefined (reading
  // 'grade')" crash in client_errors on 2026-09-26. The clock never runs
  // backwards.
  return Math.max(0, (nowMs - startMs) / 1000) % TOTAL;
}

/**
 * Scene index for a loop time t (seconds). Always a valid SCENES index, even
 * for hostile inputs — the monitor must never take the homepage down over an
 * animation index.
 */
export function sceneIndexForTime(t: number): number {
  const safe = Number.isFinite(t) ? Math.max(0, t) : 0;
  return Math.floor(safe / (TOTAL / SCENES.length)) % SCENES.length;
}

function RenderMonitor() {
  const [t, setT] = useState(0);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setT(loopElapsed(now, start));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Which stage is active, and how far through the whole render are we
  let acc = 0;
  let activeIdx = 0;
  for (let i = 0; i < STAGES.length; i++) {
    const stage = STAGES[i]!;
    if (t < acc + stage.duration) {
      activeIdx = i;
      break;
    }
    acc += stage.duration;
    activeIdx = i;
  }
  const progress = t / TOTAL;
  const sceneIdx = sceneIndexForTime(t);
  const scene = SCENES[sceneIdx] ?? SCENES[0]!;

  return (
    <div className="relative">
      {/* Monitor frame */}
      <div className="overflow-hidden rounded-xl border border-white/10 bg-black shadow-[0_40px_80px_-30px_rgba(0,0,0,0.8)]">
        {/* Screen */}
        <div className={`relative aspect-video bg-gradient-to-br ${scene.grade}`}>
          {/* Scene stills — a real render preview, crossfading per scene */}
          {SCENES.map((sc, i) => (
            <img
              key={sc.img}
              src={sc.img}
              alt={sc.alt}
              loading={i === 0 ? "eager" : "lazy"}
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ${
                i === sceneIdx ? "opacity-100" : "opacity-0"
              }`}
            />
          ))}
          {/* Scene suggestion — abstract light */}
          <div
            className="absolute inset-0 opacity-60"
            style={{
              background:
                "radial-gradient(60% 80% at 70% 20%, oklch(0.82 0.145 78 / 0.25), transparent 70%)",
            }}
          />
          {/* Burned-in caption */}
          <div className="absolute inset-x-0 bottom-0 p-5">
            <p
              key={sceneIdx}
              className="text-center text-lg font-semibold leading-snug text-white [text-shadow:0_2px_12px_rgba(0,0,0,0.9)]"
            >
              {scene.caption}
            </p>
          </div>
          {/* Top overlay: REC + timecode */}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4">
            <RecBadge label={activeIdx === 4 ? "DONE" : "RENDER"} />
            <Timecode className="text-xs text-white/70" />
          </div>
          {/* Letterbox mattes */}
          <div className="absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-black/60 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />
        </div>

        {/* Timeline */}
        <div className="border-t border-white/10 bg-[#121110] p-4">
          {/* Playhead track */}
          <div className="relative h-10">
            <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/15" />
            {/* Stage blocks */}
            <div className="absolute inset-0 flex gap-1">
              {STAGES.map((s, i) => {
                let start = 0;
                for (let j = 0; j < i; j++) start += STAGES[j]!.duration;
                const end = start + s.duration;
                const done = t >= end;
                const active = i === activeIdx;
                const widthPct = (s.duration / TOTAL) * 100;
                return (
                  <div
                    key={s.id}
                    className="relative h-full overflow-hidden rounded-sm"
                    style={{ width: `${widthPct}%` }}
                  >
                    <div
                      className={`absolute inset-0 transition-colors duration-300 ${
                        done
                          ? "bg-[oklch(0.82_0.145_78/0.85)]"
                          : active
                            ? "bg-[oklch(0.82_0.145_78/0.35)]"
                            : "bg-white/5"
                      }`}
                    />
                    {active && (
                      <div
                        className="absolute inset-y-0 left-0 bg-[oklch(0.82_0.145_78)]"
                        style={{
                          width: `${Math.min(100, ((t - start) / s.duration) * 100)}%`,
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 w-px bg-white"
              style={{ left: `${progress * 100}%` }}
            >
              <div className="absolute -left-[5px] -top-1 size-2.5 rotate-45 bg-white" />
            </div>
          </div>
          {/* Stage labels */}
          <div className="mt-2 flex">
            {STAGES.map((s, i) => (
              <div
                key={s.id}
                className={`font-mono text-[10px] uppercase tracking-widest transition-colors duration-300 ${
                  i <= activeIdx ? "text-[oklch(0.82_0.145_78)]" : "text-white/30"
                }`}
                style={{ width: `${(s.duration / TOTAL) * 100}%` }}
              >
                {s.label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section className="film-grain relative overflow-hidden">
      {/* Ambient tungsten glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(50% 40% at 75% 30%, oklch(0.82 0.145 78 / 0.08), transparent 70%)",
        }}
      />
      <div className="relative mx-auto max-w-7xl px-4 pt-16 pb-20 sm:px-6 sm:pt-24 lg:px-8">
        <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div>
            <div className="mb-6 flex items-center gap-3">
              <RecBadge label="NOW RENDERING" />
              <span className="font-mono text-xs text-foreground/50">v2.0 — early access</span>
            </div>
            <h1 className="font-display text-balance text-5xl font-extrabold leading-[0.98] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
              Script in.
              <br />
              Film out.
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground">
              Vidora writes the scene plan, narrates it in 25+ voices, generates the
              stills, and burns in the captions. You download a 1080p MP4, ready for
              YouTube.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link
                to="/studio"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-7 text-base font-bold text-primary-foreground transition-transform duration-200 hover:scale-[1.02] active:scale-[0.99]"
              >
                <Play className="h-5 w-5 fill-current" />
                Start a video
              </Link>
              <Link
                to="/features"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-border px-7 text-base font-semibold text-foreground transition-colors duration-200 hover:border-foreground/30 hover:bg-white/5"
              >
                See how it works
                <ArrowRight className="h-5 w-5" />
              </Link>
            </div>
            {/* Stats — hairline strip, not cards */}
            <dl className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
              {[
                ["1080p", "MP4 download"],
                ["25+", "AI voices"],
                ["10", "visual styles"],
                ["EN · हिन्दी", "and more"],
              ].map(([v, l]) => (
                <div key={l} className="bg-background px-5 py-4">
                  <dt className="font-display text-2xl font-bold text-foreground">{v}</dt>
                  <dd className="mt-1 text-xs text-muted-foreground">{l}</dd>
                </div>
              ))}
            </dl>
          </div>

          <RenderMonitor />
        </div>
      </div>
    </section>
  );
}
