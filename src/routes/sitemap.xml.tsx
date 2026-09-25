import { createFileRoute } from "@tanstack/react-router";

const BASE = "https://vidoratube.lovable.app";

/** Public, indexable pages. App pages stay out of the sitemap by design. */
const PATHS = ["/", "/features", "/pricing", "/guides", "/contact"];

export const Route = createFileRoute("/sitemap/xml")({
  server: {
    handlers: {
      GET: async () => {
        const urls = PATHS.map(
          (p) =>
            `  <url><loc>${BASE}${p}</loc><changefreq>${p === "/" ? "weekly" : "monthly"}</changefreq></url>`,
        ).join("\n");
        const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
        return new Response(body, {
          headers: { "Content-Type": "application/xml; charset=utf-8" },
        });
      },
    },
  },
});
