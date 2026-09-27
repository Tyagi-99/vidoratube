import { createFileRoute } from "@tanstack/react-router";
import {
  buildSitemapXml,
  SITEMAP_CONTENT_TYPE,
} from "../lib/sitemap.server";

/**
 * Legacy path — the canonical sitemap now lives at /sitemap.xml
 * (served from src/server.ts, since dots in route filenames become
 * path separators in TanStack file routing). This route is kept so
 * old links don't break.
 */
export const Route = createFileRoute("/sitemap/xml")({
  server: {
    handlers: {
      GET: async () =>
        new Response(buildSitemapXml(), {
          headers: { "Content-Type": SITEMAP_CONTENT_TYPE },
        }),
    },
  },
});
