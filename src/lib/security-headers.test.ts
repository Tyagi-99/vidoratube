import { describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  SECURITY_HEADERS,
  withSecurityHeaders,
} from "./security-headers";

describe("buildContentSecurityPolicy", () => {
  it("includes the directives the app needs", () => {
    const csp = buildContentSecurityPolicy();
    // Supabase REST + Realtime (wildcarded so the project ref can change)
    expect(csp).toContain("https://*.supabase.co");
    expect(csp).toContain("wss://*.supabase.co");
    // Google Fonts
    expect(csp).toContain("https://fonts.googleapis.com");
    expect(csp).toContain("https://fonts.gstatic.com");
    // YouTube OAuth flow
    expect(csp).toContain("https://accounts.google.com");
    expect(csp).toContain("https://www.googleapis.com");
    // FFmpeg.wasm workers and blob previews
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("blob:");
    // Clickjacking defense at the CSP layer too
    expect(csp).toContain("frame-ancestors 'none'");
    // No plugins, no arbitrary object embeds
    expect(csp).toContain("object-src 'none'");
  });

  it("documents why unsafe-inline is required for scripts and styles", () => {
    const csp = buildContentSecurityPolicy();
    // Theme-init inline script in __root.tsx + TanStack Start SSR hydration
    expect(csp).toMatch(/script-src[^;]*'unsafe-inline'/);
    // Tailwind/shadcn inline styles
    expect(csp).toMatch(/style-src[^;]*'unsafe-inline'/);
  });
});

describe("SECURITY_HEADERS", () => {
  it("sets HSTS, frame options, content-type options and referrer policy", () => {
    expect(SECURITY_HEADERS["Strict-Transport-Security"]).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
    expect(SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
    expect(SECURITY_HEADERS["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(SECURITY_HEADERS["Content-Security-Policy"]).toBe(buildContentSecurityPolicy());
  });
});

describe("withSecurityHeaders", () => {
  it("adds missing security headers to a response", () => {
    const res = withSecurityHeaders(new Response("ok"));
    for (const name of Object.keys(SECURITY_HEADERS)) {
      expect(res.headers.get(name)).toBe(SECURITY_HEADERS[name]);
    }
  });

  it("preserves status, body and existing headers", async () => {
    const res = withSecurityHeaders(
      new Response("hello", { status: 201, headers: { "x-custom": "yes" } }),
    );
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("hello");
    expect(res.headers.get("x-custom")).toBe("yes");
  });

  it("never overwrites a header the route already set", () => {
    const res = withSecurityHeaders(
      new Response("ok", { headers: { "X-Frame-Options": "SAMEORIGIN" } }),
    );
    expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
  });
});
