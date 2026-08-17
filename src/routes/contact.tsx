import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact — GoMotion" },
      { name: "description", content: "Get in touch for enterprise plans, custom volume, and hands-on onboarding." },
      { property: "og:title", content: "Contact — GoMotion" },
      { property: "og:description", content: "Enterprise plans, custom volume, and hands-on onboarding." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 lg:px-8">
      <h1 className="text-center text-4xl font-bold tracking-tight text-foreground">
        Contact
      </h1>
      <p className="mx-auto mt-4 max-w-2xl text-center text-lg text-muted-foreground">
        Enterprise & large scale. Hundreds of videos a month, multiple channels, custom volume & hands-on onboarding.
      </p>
    </div>
  );
}
