import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests for VidoraTube. Run: npx playwright test
 * Uses the system Chromium at /opt/meta-chromium/chrome (no downloaded browsers needed).
 *
 * Authenticated tests require env vars:
 *   TEST_USER_EMAIL, TEST_USER_PASSWORD (a seeded test account)
 * Without them, authenticated specs are skipped.
 */

// Optional egress proxy (e.g. this VM's hatch-egress-proxy). Parsed from HTTPS_PROXY,
// or overridden with E2E_PROXY (e.g. a local chained proxy at http://localhost:18080).
function getProxy() {
  const raw =
    process.env.E2E_PROXY || process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    return {
      server: `${u.protocol}//${u.hostname}:${u.port}`,
      username: decodeURIComponent(u.username) || undefined,
      password: decodeURIComponent(u.password) || undefined,
      // Never proxy localhost: E2E targets the local deterministic stack.
      bypass: "127.0.0.1,localhost",
    };
  } catch {
    return undefined;
  }
}
const proxy = getProxy();
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    ...(proxy ? { proxy } : {}),
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /mobile\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          executablePath: "/opt/meta-chromium/chrome",
          args: ["--no-sandbox", "--disable-dev-shm-usage"],
        },
      },
    },
    {
      name: "mobile",
      testMatch: /mobile\.spec\.ts/,
      use: {
        // devices["iPhone 13"] carries defaultBrowserType: "webkit" and crashes
        // this VM's Chromium on launch; emulate the mobile viewport directly.
        viewport: { width: 375, height: 667 },
        isMobile: true,
        hasTouch: true,
        launchOptions: {
          executablePath: "/opt/meta-chromium/chrome",
          args: ["--no-sandbox", "--disable-dev-shm-usage"],
        },
      },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // Production build + deterministic adapters (D200): serves
        // `.output/server/index.mjs` with VIDORA_E2E_ADAPTER=deterministic and
        // a local deterministic Supabase stub. No real Supabase, no provider
        // keys, no cost. See e2e/serve.mjs.
        command: "node e2e/serve.mjs",
        url: "http://127.0.0.1:3100",
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
        env: {
          ...process.env,
        },
      },
});
