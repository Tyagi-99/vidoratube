import { describe, it, expect } from "vitest";
import { buildSitemapXml, SITEMAP_BASE, SITEMAP_CONTENT_TYPE } from "./sitemap.server";

describe("buildSitemapXml", () => {
  it("emits valid XML with every public path", () => {
    const xml = buildSitemapXml();
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<urlset");
    for (const p of ["/", "/features", "/pricing", "/guides", "/contact"]) {
      expect(xml).toContain(`<loc>${SITEMAP_BASE}${p}</loc>`);
    }
  });

  it("advertises the canonical base that robots.txt points at", () => {
    expect(SITEMAP_BASE).toBe("https://vidoratube.lovable.app");
    expect(SITEMAP_CONTENT_TYPE).toContain("application/xml");
  });
});
