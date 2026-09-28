import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BarChart3,
  Brain,
  Clapperboard,
  FlaskConical,
  Radar,
  Send,
} from "lucide-react";
import { FEATURE_CATALOG, TOTAL_CATALOG_FEATURES } from "@/lib/feature-catalog";

const PILLAR_ICONS = [Radar, FlaskConical, Clapperboard, Send, BarChart3, Brain];

/** Headline capabilities shown on each pillar card; the full list lives on /features. */
const HEADLINES: Record<string, string[]> = {
  discover: ["Niche Finder", "Outlier Explorer", "Trend Radar", "Watchtower alerts"],
  validate: ["Idea Engine", "Deep Research · Evidence Desk", "Title Lab", "Thumbnail Studio"],
  create: ["Script Studio", "Voice Studio", "Video Studio", "30-Second Quick Create"],
  publish: ["YouTube Connection", "Content Calendar", "Review Studio", "Packaging Checklist"],
  measure: ["Analytics Dashboard", "Packaging Experiments", "Comment Intelligence", "ROI Studio"],
  learn: ["Learning Engine", "Vidora Agent", "Team Workspaces", "API & MCP"],
};

const AMBER = "text-[oklch(0.82_0.145_78)]";

/**
 * "One OS, six moves" — the public map of everything Vidora includes.
 * Showcase only: every capability links to /features, and using any of it
 * requires sign-in.
 */
export function OsMap() {
  return (
    <section className="relative border-t border-border">
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <div className="mb-14 max-w-2xl">
          <p className={`font-mono text-xs tracking-[0.2em] ${AMBER}`}>THE OPERATING SYSTEM</p>
          <h2 className="font-display mt-4 text-balance text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            One OS. Six moves.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Not a video generator — a full creator OS. {TOTAL_CATALOG_FEATURES}{" "}
            capabilities across six moves, from finding the niche to learning
            what worked. Everything below is included — sign in to use it.
          </p>
        </div>

        <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-2 lg:grid-cols-3">
          {FEATURE_CATALOG.map((pillar, i) => {
            const Icon = PILLAR_ICONS[i % PILLAR_ICONS.length]!;
            const headlines = HEADLINES[pillar.id] ?? [];
            return (
              <Link
                key={pillar.id}
                to="/features"
                hash={pillar.id}
                className="group flex flex-col bg-background p-7 transition-colors duration-200 hover:bg-white/[0.03]"
              >
                <div className="flex items-center justify-between">
                  <span className={`font-mono text-xs tracking-[0.2em] ${AMBER}`}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <Icon className="h-6 w-6 text-foreground/40 transition-colors duration-200 group-hover:text-foreground/80" />
                </div>
                <h3 className="font-display mt-5 text-2xl font-bold tracking-tight text-foreground">
                  {pillar.name}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">{pillar.tagline}</p>
                <ul className="mt-5 space-y-2">
                  {headlines.map((h) => (
                    <li key={h} className="flex items-center gap-2 text-sm text-foreground/80">
                      <span className={`h-1 w-1 rounded-full bg-[oklch(0.82_0.145_78)]`} />
                      {h}
                    </li>
                  ))}
                </ul>
                <span className="mt-auto inline-flex items-center gap-1.5 pt-6 text-sm font-semibold text-foreground/70 transition-colors duration-200 group-hover:text-foreground">
                  Explore {pillar.name}
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </span>
              </Link>
            );
          })}
        </div>

        <div className="mt-10 flex flex-col items-start justify-between gap-6 rounded-xl border border-border bg-white/[0.02] p-7 sm:flex-row sm:items-center">
          <p className="max-w-xl text-base text-muted-foreground">
            The whole map above is inside the product. Browsing is free —
            running anything needs an account.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              to="/auth"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-7 text-base font-bold text-primary-foreground transition-transform duration-200 hover:scale-[1.02] active:scale-[0.99]"
            >
              Sign in to use everything
              <ArrowRight className="h-5 w-5" />
            </Link>
            <Link
              to="/features"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-border px-7 text-base font-semibold text-foreground transition-colors duration-200 hover:border-foreground/30 hover:bg-white/5"
            >
              Browse the full catalog
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
