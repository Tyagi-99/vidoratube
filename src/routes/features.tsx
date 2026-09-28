import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import {
  FEATURE_CATALOG,
  TOTAL_CATALOG_FEATURES,
  type CatalogBadge,
} from "@/lib/feature-catalog";

export const Route = createFileRoute("/features")({
  head: () => ({
    meta: [
      { title: "Every feature — Vidora" },
      {
        name: "description",
        content: `The complete Vidora capability catalog: ${TOTAL_CATALOG_FEATURES} features across six pillars — discover, validate, create, publish, measure, learn. Public to browse; sign in to use.`,
      },
      { property: "og:title", content: "Every feature — Vidora" },
      {
        property: "og:description",
        content: "The complete Vidora capability catalog. Public to browse; sign in to use.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FeaturesPage,
});

const AMBER = "text-[oklch(0.82_0.145_78)]";

const BADGE_STYLES: Record<CatalogBadge, string> = {
  "Needs a key": "border-[oklch(0.82_0.145_78/0.4)] text-[oklch(0.82_0.145_78)]",
  "Shipping next": "border-white/20 text-foreground/70",
  "Design only": "border-white/20 text-foreground/70",
};

function FeaturesPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Sticky sign-in note */}
      <div className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <p className="text-sm text-muted-foreground">
            Everything below is included —{" "}
            <span className="font-semibold text-foreground">sign in to use it.</span>
          </p>
          <Link
            to="/auth"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-primary px-5 text-sm font-bold text-primary-foreground transition-transform duration-200 hover:scale-[1.02]"
          >
            Sign in
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 pt-16 pb-8 sm:px-6 lg:px-8">
        <p className={`font-mono text-xs tracking-[0.2em] ${AMBER}`}>THE FULL CATALOG</p>
        <h1 className="font-display mt-4 text-balance text-4xl font-bold tracking-tight sm:text-5xl">
          Every feature. One page.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
          {TOTAL_CATALOG_FEATURES} capabilities across six moves. Each entry links
          to where it lives in the product — follow one and you'll land at
          sign-in if you're signed out.
        </p>
        <nav aria-label="Pillars" className="mt-8 flex flex-wrap gap-2">
          {FEATURE_CATALOG.map((pillar) => (
            <a
              key={pillar.id}
              href={`#${pillar.id}`}
              className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-foreground/80 transition-colors duration-200 hover:border-foreground/30 hover:text-foreground"
            >
              {pillar.name}
            </a>
          ))}
        </nav>
      </div>

      <div className="mx-auto max-w-7xl px-4 pb-24 sm:px-6 lg:px-8">
        {FEATURE_CATALOG.map((pillar, i) => (
          <section
            key={pillar.id}
            id={pillar.id}
            aria-label={pillar.name}
            className="scroll-mt-24 border-t border-border py-14"
          >
            <div className="mb-8 max-w-2xl">
              <p className={`font-mono text-xs tracking-[0.2em] ${AMBER}`}>
                {String(i + 1).padStart(2, "0")} — {pillar.features.length} CAPABILITIES
              </p>
              <div className="mt-3 flex flex-wrap items-baseline gap-x-4">
                <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
                  {pillar.name}
                </h2>
                <Link
                  to={pillar.route}
                  className="inline-flex items-center gap-1 text-sm font-semibold text-foreground/60 transition-colors hover:text-foreground"
                >
                  Open in the app
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </div>
              <p className="mt-2 text-lg text-muted-foreground">{pillar.tagline}</p>
            </div>

            <ul className="grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-2">
              {pillar.features.map((feature) => (
                <li key={feature.name} className="bg-background p-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-lg font-bold tracking-tight">
                      {feature.name}
                    </h3>
                    {feature.badge && (
                      <span
                        className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest ${BADGE_STYLES[feature.badge]}`}
                      >
                        {feature.badge}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {feature.description}
                  </p>
                  <Link
                    to={feature.route}
                    className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-foreground/70 transition-colors hover:text-foreground"
                  >
                    Use it in the app
                    <ArrowUpRight className="h-4 w-4" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <div className="mt-4 flex flex-col items-start justify-between gap-6 rounded-xl border border-border bg-white/[0.02] p-7 sm:flex-row sm:items-center">
          <p className="max-w-xl text-base text-muted-foreground">
            That's the whole OS. Pick a capability above — or sign in and start
            with the nine-step setup.
          </p>
          <Link
            to="/auth"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-7 text-base font-bold text-primary-foreground transition-transform duration-200 hover:scale-[1.02] active:scale-[0.99]"
          >
            Sign in to use everything
            <ArrowRight className="h-5 w-5" />
          </Link>
        </div>
      </div>
    </main>
  );
}
