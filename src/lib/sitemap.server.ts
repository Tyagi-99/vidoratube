/** Canonical sitemap XML builder (server-only). */

export const SITEMAP_BASE = "https://vidoratube.lovable.app";

/** Public, indexable pages. App pages stay out of the sitemap by design. */
const PATHS = ["/", "/features", "/pricing", "/guides", "/contact"];

export function buildSitemapXml(): string {
  const urls = PATHS.map(
    (p) =>
      `  <url><loc>${SITEMAP_BASE}${p}</loc><changefreq>${
        p === "/" ? "weekly" : "monthly"
      }</changefreq></url>`,
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}

export const SITEMAP_CONTENT_TYPE = "application/xml; charset=utf-8";
