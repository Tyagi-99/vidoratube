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
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    ...(proxy ? { proxy } : {}),
  },
  projects: [
    {
      name: "chromium",
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
        ...devices["iPhone 13"],
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
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          // Dev server needs these; CI must provide real values.
          ...process.env,
        },
      },
});
