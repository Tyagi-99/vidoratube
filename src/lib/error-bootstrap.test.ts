import { describe, expect, it } from "vitest";
import { errorBootstrapScript } from "./error-bootstrap";

describe("errorBootstrapScript", () => {
  const script = errorBootstrapScript(
    "https://example.supabase.co/",
    "sb_publishable_testkey",
  );

  it("targets the client_errors PostgREST endpoint", () => {
    expect(script).toContain("https://example.supabase.co/rest/v1/client_errors");
  });

  it("strips trailing slashes so the endpoint has no double slash", () => {
    expect(script).not.toContain("supabase.co//rest");
  });

  it("embeds the publishable key for the apikey header", () => {
    expect(script).toContain("sb_publishable_testkey");
    expect(script).toContain('"apikey"');
  });

  it("listens for both error and unhandledrejection", () => {
    expect(script).toContain('addEventListener("error"');
    expect(script).toContain('addEventListener("unhandledrejection"');
  });

  it("uses keepalive so reports survive page unload", () => {
    expect(script).toContain("keepalive");
  });

  it("caps reports per page load", () => {
    expect(script).toMatch(/n>=5/);
  });

  it("is a self-contained IIFE that cannot break the page", () => {
    expect(script.startsWith("(function(){try{")).toBe(true);
    expect(script.endsWith("})();")).toBe(true);
  });

  it("never contains a raw closing script tag", () => {
    expect(script.toLowerCase()).not.toContain("</script>");
  });
});
