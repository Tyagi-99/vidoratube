import { CREATION_MODES } from "@/lib/creation-modes";

export function HomeCreateModes() {
  return (
    <section id="create" className="w-full border-y border-border bg-background py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-8 max-w-xl">
          <p className="font-display text-xs font-semibold uppercase tracking-[0.22em] text-foreground/70">
            Start here
          </p>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Pick the job. A new page opens.
          </h2>
          <p className="mt-3 text-base text-muted-foreground">
            Same studio, three doors. Each one renders a finished MP4. Not a popup.
          </p>
        </div>

        <div className="divide-y divide-border border-y border-border">
          {CREATION_MODES.map((mode, index) => (
            <a
              key={mode.id}
              href={mode.href}
              className="group grid gap-3 py-6 sm:grid-cols-[7rem_1fr_auto] sm:items-end sm:gap-8 sm:py-7"
            >
              <p className="font-display text-sm font-semibold tabular-nums text-foreground/45">
                {String(index + 1).padStart(2, "0")}
              </p>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-foreground/55">
                  {mode.kicker}
                </p>
                <h3 className="mt-1 font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                  {mode.title}
                </h3>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">{mode.line}</p>
              </div>
              <span className="text-sm font-semibold text-foreground underline-offset-4 group-hover:underline">
                Open
              </span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
