/**
 * Shared Playwright fixtures for VidoraTube E2E (Phase 6, Stream A).
 *
 * Every page automatically gets the localhost bridge
 * (bridgeLocalhost in adapter-helpers.ts): this VM's Chromium hard-blocks
 * direct loopback navigation, so requests to the local app and the
 * deterministic Supabase stub are fulfilled with their real responses via
 * the Node side. Import { test, expect } from "./fixtures" in specs.
 */

import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";
import { bridgeLocalhost } from "./adapter-helpers";

export const test = base.extend({
  page: async ({ page }, use) => {
    await bridgeLocalhost(page);
    await use(page);
  },
});

export { expect };
export type { APIRequestContext, Page };
