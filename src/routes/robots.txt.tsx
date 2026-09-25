import { createFileRoute } from "@tanstack/react-router";

const BASE = "https://vidoratube.lovable.app";

export const Route = createFileRoute("/robots/txt")({
  server: {
    handlers: {
      GET: async () => {
        const body = [
          "User-agent: *",
          "Allow: /",
          "Disallow: /studio",
          "Disallow: /projects",
          "Disallow: /research",
          "Disallow: /analytics",
          "Disallow: /billing",
          "Disallow: /admin",
          "Disallow: /api/",
          "",
          `Sitemap: ${BASE}/sitemap.xml`,
          "",
        ].join("\n");
        return new Response(body, {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      },
    },
  },
});
