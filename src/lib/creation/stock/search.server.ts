/**
 * F18 Stock Media — licensed-stock search (Stream D, Phase 3).
 *
 * SERVER-ONLY. Searches go through src/lib/providers/stock.server.ts
 * (Pexels → Pixabay priority order, key-gated). The honest-unconfigured
 * contract (D98-class):
 *
 *   - WITHOUT keys, searchStock returns `configured: false` with ZERO
 *     network calls — no provider.search() is ever invoked. Every surface
 *     renders the "stock provider not connected" unavailable state.
 *   - The existing `mock://` path (src/lib/stock/mock.ts) keeps working for
 *     the planner/source-selection pipeline (D48) and is reachable here
 *     ONLY via the explicit `includeMock: true` opt-in, labeled
 *     "MOCK — preview asset, not licensed for use".
 *
 * `searchStockAssets` takes injectable providers so tests can pin the
 * zero-network unconfigured envelope. The server fn (stock.functions.ts)
 * always resolves from the real key-gated providers.
 */
import { pexels, pixabay, type StockAsset, type StockProvider } from "../../providers/stock.server";
import { mockStock } from "../../stock/mock";

export type StockSearchResult =
  | {
      configured: true;
      mock: boolean;
      assets: StockAsset[];
    }
  | {
      configured: false;
      mock: false;
      assets: [];
      /** Honest unavailable-state copy for the UI. */
      message: string;
    };

export type StockSearchOptions = {
  /**
   * Override providers (tests only). Production passes nothing and the
   * real key-gated providers are resolved here.
   */
  providers?: StockProvider[] | undefined;
  /**
   * Explicit opt-in to the honestly-labeled mock provider (preview assets
   * only). Defaults to false — unconfigured keys yield the unavailable
   * state, never silent mock substitution.
   */
  includeMock?: boolean | undefined;
  perPage?: number | undefined;
};

const UNCONFIGURED_MESSAGE =
  "Stock provider not connected. Add a Pexels or Pixabay API key in Settings → Providers to search licensed stock.";

/**
 * Search licensed stock. Returns the unconfigured envelope WITHOUT any
 * network I/O when no provider is configured (unit-tested).
 */
export async function searchStockAssets(
  query: string,
  kind: "photo" | "video",
  opts: StockSearchOptions = {},
): Promise<StockSearchResult> {
  const q = query.trim();
  if (!q) {
    return { configured: false, mock: false, assets: [], message: "Enter a search term." };
  }

  const realProviders = opts.providers ?? [pexels, pixabay].filter((p) => p.configured());

  if (opts.includeMock) {
    // Explicit preview mode: honestly-labeled mock assets only.
    return { configured: true, mock: true, assets: await mockStock.search(q, kind, opts.perPage) };
  }

  if (realProviders.length === 0) {
    // No keys → honest unavailable state. No provider.search() call, so
    // zero network I/O by construction.
    return { configured: false, mock: false, assets: [], message: UNCONFIGURED_MESSAGE };
  }

  const perPage = Math.min(Math.max(opts.perPage ?? 12, 1), 40);
  const seen = new Set<string>();
  const assets: StockAsset[] = [];
  for (const provider of realProviders) {
    try {
      for (const asset of await provider.search(q, kind, perPage)) {
        const dedupe = `${asset.provider}:${asset.asset_id}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        assets.push(asset);
        if (assets.length >= perPage) break;
      }
    } catch (err) {
      // One failing provider must not kill the other; the error is
      // surfaced in the log, not as fabricated results.
      console.warn(`[vidora] stock search failed on ${provider.id}:`, err);
    }
    if (assets.length >= perPage) break;
  }
  return { configured: true, mock: false, assets };
}

/** Provider connectivity facts (no secrets) for UI badges. */
export function stockProviderStatus(): {
  providers: { id: string; label: string; configured: boolean }[];
  anyConfigured: boolean;
} {
  const providers = [
    { id: "pexels", label: "Pexels", configured: pexels.configured() },
    { id: "pixabay", label: "Pixabay", configured: pixabay.configured() },
  ];
  return { providers, anyConfigured: providers.some((p) => p.configured) };
}
