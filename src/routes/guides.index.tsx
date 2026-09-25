import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, BookOpen, Clock } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { GUIDES } from "@/lib/guides";

export const Route = createFileRoute("/guides/")({
  head: () => ({
    meta: [
      { title: "Guides — Vidora AI" },
      {
        name: "description",
        content: "Learn to make better YouTube videos with AI: the AI studio pipeline, monetization safety, and Hindi AI voiceover.",
      },
      { property: "og:title", content: "Guides — Vidora AI" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "https://vidoratube.lovable.app/guides" }],
  }),
  component: GuidesIndex,
});

function GuidesIndex() {
  const { t } = useI18n();
  return (
    <main className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("guides_title")}</h1>
      <p className="mt-2 text-muted-foreground">{t("guides_subtitle")}</p>
      <div className="mt-10 grid gap-4">
        {GUIDES.map((guide) => (
          <Link
            key={guide.slug}
            to="/guides/$slug"
            params={{ slug: guide.slug }}
            className="group rounded-2xl border border-border bg-card p-6 transition-colors hover:bg-muted/40"
          >
            <div className="flex items-start gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                <BookOpen className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold">{guide.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{guide.description}</p>
                <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="size-3.5" aria-hidden="true" /> {guide.readingMinutes} min
                  </span>
                  <span className="flex items-center gap-1 font-medium text-foreground">
                    {t("guides_read")} <ArrowRight className="size-3.5" aria-hidden="true" />
                  </span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
