/**
 * General web-search adapter SHELL — deliberately unconfigured.
 *
 * There is no search API key in this environment, so this adapter exists only
 * to hold the contract slot and degrade honestly: configured() is false and
 * every search() returns `status: "unconfigured"` — never fabricated results.
 *
 * To wire it for real (founder): pick a search API (Brave Search, Tavily, or
 * SerpAPI), add its key to the server env (e.g. SEARCH_API_KEY), implement
 * the HTTP call against the SearchProvider contract, and flip configured().
 */
import type { ContentMetadata, ProviderResult, SearchProvider } from "./contracts";
import { withProviderTelemetry } from "./telemetry.server";

export const webSearch: SearchProvider = {
  id: "web-search",
  label: "Web search (needs a search API key — founder)",
  configured: () => false,
  async search(
    _query: string,
    _options?: { maxResults?: number | undefined },
  ): Promise<ProviderResult<ContentMetadata[]>> {
    return withProviderTelemetry<ContentMetadata[]>(
      async () => {
        throw new Error("Web search is not configured — needs a search API key (founder).");
      },
      {
        provider: "web-search",
        operation: "search",
        configured: false,
      },
    );
  },
};
