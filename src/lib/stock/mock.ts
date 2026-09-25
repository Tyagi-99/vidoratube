/**
 * Mock stock provider (Sprint 5-6).
 *
 * Real stock search needs server-side keys (PEXELS_API_KEY / PIXABAY_API_KEY).
 * When neither key is set, resolveStockProviders() falls back to this mock so
 * the source-selection pipeline stays testable and the planner never blocks
 * on a missing key. Every asset it returns is CLEARLY marked:
 *
 *   - provider id "mock" (see the widened StockProvider id union)
 *   - license "MOCK — preview asset, not licensed for use"
 *   - mock:// URLs that can never be mistaken for downloadable stock
 *
 * The mock performs NO network I/O — search() is a pure deterministic
 * function of (query, kind). Tests assert this.
 */
import { pexels, pixabay, type StockAsset, type StockProvider } from "../providers/stock.server";

/** License string every mock asset carries. Never a real license. */
export const MOCK_LICENSE = "MOCK — preview asset, not licensed for use";

function slug(query: string): string {
  return (
    query
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "scene"
  );
}

export const mockStock: StockProvider = {
  id: "mock",
  configured: () => true,
  async search(query, kind, perPage = 10): Promise<StockAsset[]> {
    const n = Math.min(Math.max(1, perPage ?? 4), 6);
    const q = slug(query);
    // Deterministic timestamp: the mock must not leak wall-clock time.
    const fetchedAt = new Date(0).toISOString();
    return Array.from({ length: n }, (_, i) => ({
      provider: "mock" as const,
      asset_id: `mock-${q}-${i}`,
      kind,
      url: `mock://stock/${kind}/${q}-${i}`,
      thumb_url: `mock://stock/${kind}/${q}-${i}/thumb`,
      source_url: "mock://stock",
      creator: "Mock provider",
      license: MOCK_LICENSE,
      width: 1920,
      height: 1080,
      fetched_at: fetchedAt,
    }));
  },
};

/**
 * Resolve the stock providers to use, in priority order (Pexels, then
 * Pixabay). Real providers are used only when their server-side key is
 * configured; otherwise the clearly-marked mock is returned and the
 * situation is logged. Callers surface `mock: true` in the plan so the UI
 * can label preview assets honestly.
 */
export function resolveStockProviders(): { providers: StockProvider[]; mock: boolean } {
  const real = [pexels, pixabay].filter((p) => p.configured());
  if (real.length > 0) return { providers: real, mock: false };
  console.info(
    "[vidora] stock: no PEXELS_API_KEY / PIXABAY_API_KEY set — " +
      "using the mock stock provider (preview assets only, not licensed)",
  );
  return { providers: [mockStock], mock: true };
}
