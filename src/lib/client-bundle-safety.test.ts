/**
 * Regression guard for the 2026-09-26 homepage crash:
 *   Module "node:crypto" has been externalized for browser compatibility.
 *
 * billing.functions.ts, chapters.functions.ts and server-renders.functions.ts
 * are imported by client components (via TanStack Start server functions), so
 * their top-level module graph must never contain node:* imports. A top-level
 * node:crypto import crashes client module evaluation in the browser.
 *
 * This test statically scans the guarded files. Tests run in Node, so
 * node: imports are fine *here* — the guard is about the app source files.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Files whose top-level imports are bundled into the client.
const CLIENT_REACHABLE = [
  "src/lib/sha1.ts",
  "src/lib/billing/billing-math.ts",
  "src/lib/billing.functions.ts",
  "src/lib/chapters/chapters.functions.ts",
  "src/lib/server-renders.functions.ts",
];

// Server-only billing providers that use node:crypto for HMAC webhook
// verification. They may only be reached via dynamic import() inside server
// function handlers — never via a top-level import in a client-reachable file.
const SERVER_ONLY_PROVIDERS = [
  "./billing/dodo",
  "./billing/razorpay",
  "./billing/stripe",
];

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("client bundle safety: no node:* in client-reachable modules", () => {
  for (const rel of CLIENT_REACHABLE) {
    it(`${rel} has no node:* import`, () => {
      const src = read(rel);
      expect(src).not.toMatch(/from\s+["']node:/);
      expect(src).not.toMatch(/require\(\s*["']node:/);
      expect(src).not.toMatch(/import\(\s*["']node:/);
    });
  }

  it("billing.functions.ts reaches server-only providers only via dynamic import", () => {
    const src = read("src/lib/billing.functions.ts");
    for (const mod of SERVER_ONLY_PROVIDERS) {
      // A top-level static import would drag node:crypto into the client bundle.
      const staticImport = new RegExp(
        `^import\\s+[^;]*from\\s+["']${mod.replace(/[./]/g, "\\$&")}["']`,
        "m",
      );
      expect(src, `${mod} must not be a top-level import`).not.toMatch(staticImport);
    }
    // The providers must still be reachable server-side via dynamic import.
    expect(src).toMatch(/await import\("\.\/billing\/dodo"\)/);
    expect(src).toMatch(/await import\("\.\/billing\/razorpay"\)/);
    expect(src).toMatch(/await import\("\.\/billing\/stripe"\)/);
  });
});
