import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { getGuide } from "@/lib/guides";

export const Route = createFileRoute("/guides/$slug")({
  loader: ({ params }) => {
    const guide = getGuide(params.slug);
    if (!guide) throw notFound();
    return { guide };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.guide.title} — Vidora AI` },
      { name: "description", content: loaderData?.guide.description ?? "" },
      { property: "og:title", content: `${loaderData?.guide.title} — Vidora AI` },
      { property: "og:type", content: "article" },
    ],
    links: [
      { rel: "canonical", href: `https://vidoratube.lovable.app/guides/${loaderData?.guide.slug}` },
    ],
  }),
  component: GuidePage,
});

function GuidePage() {
  const { t } = useI18n();
  const { guide } = Route.useLoaderData();
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <Link
        to="/guides"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> {t("guides_back")}
      </Link>
      <article className="mt-6">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{guide.title}</h1>
        <p className="mt-3 text-lg text-muted-foreground">{guide.description}</p>
        {guide.sections.map((section) => (
          <section key={section.heading} className="mt-10">
            <h2 className="text-xl font-semibold">{section.heading}</h2>
            {section.body.map((para, i) => (
              <p key={i} className="mt-3 leading-relaxed text-foreground/90">
                {para}
              </p>
            ))}
          </section>
        ))}
      </article>
    </main>
  );
}
