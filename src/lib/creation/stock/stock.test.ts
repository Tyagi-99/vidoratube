/**
 * F18 Stock Media — tests (Stream D, Phase 3).
 *
 * - Unconfigured envelope: without keys, searchStockAssets performs ZERO
 *   network calls (pinned with a fetch spy).
 * - Rights metadata builder: every selected asset carries provider, license,
 *   attribution facts, URLs, and fetch time.
 * - Mock labeling: mock assets can never be recorded as licensed stock.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { searchStockAssets, stockProviderStatus } from "./search.server";
import {
  buildStockRights,
  isMockAsset,
  licenseSummary,
  sceneAssetSourceForStock,
  toContentAssetInsert,
  toProvenanceInsert,
} from "./rights";
import { mockStock, MOCK_LICENSE } from "../../stock/mock";
import type { StockAsset, StockProvider } from "../../providers/stock.server";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function fakeStockProvider(id: "pexels" | "pixabay", calls: string[]): StockProvider {
  return {
    id,
    configured: () => true,
    search: async (query, kind, perPage = 10): Promise<StockAsset[]> => {
      calls.push(`${id}:${query}:${kind}:${perPage}`);
      return [
        {
          provider: id,
          asset_id: `${id}-1`,
          kind,
          url: `https://example.com/${id}-1.mp4`,
          thumb_url: `https://example.com/${id}-1.jpg`,
          source_url: `https://${id}.com/asset/1`,
          creator: "Test Creator",
          license:
            id === "pexels"
              ? "Pexels License (free to use, attribution appreciated)"
              : "Pixabay Content License (free to use)",
          width: 1920,
          height: 1080,
          fetched_at: new Date().toISOString(),
        },
      ];
    },
  };
}

describe("searchStockAssets — unconfigured envelope", () => {
  it("returns 'not connected' with ZERO network calls when no provider is configured", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await searchStockAssets("ocean sunset", "video", { providers: [] });

    expect(result.configured).toBe(false);
    if (!result.configured) {
      expect(result.assets).toEqual([]);
      expect(result.message).toMatch(/not connected/i);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("also makes zero calls when resolving from env with no keys set", async () => {
    vi.stubEnv("PEXELS_API_KEY", "");
    vi.stubEnv("PIXABAY_API_KEY", "");
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    // No injected providers → resolves from env → both unconfigured.
    const result = await searchStockAssets("ocean sunset", "photo");

    expect(result.configured).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an empty query without touching providers", async () => {
    const calls: string[] = [];
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const result = await searchStockAssets("   ", "photo", {
      providers: [fakeStockProvider("pexels", calls)],
    });
    expect(result.configured).toBe(false);
    expect(calls).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("searchStockAssets — configured path", () => {
  it("searches injected providers in order and dedupes", async () => {
    const calls: string[] = [];
    const result = await searchStockAssets("city night", "photo", {
      providers: [fakeStockProvider("pexels", calls), fakeStockProvider("pixabay", calls)],
    });
    expect(result.configured).toBe(true);
    if (result.configured) {
      expect(result.assets).toHaveLength(2);
      expect(result.assets.map((a) => a.provider)).toEqual(["pexels", "pixabay"]);
      expect(calls[0]).toMatch(/^pexels:city night:photo:/);
    }
  });

  it("a failing provider does not kill the other", async () => {
    const calls: string[] = [];
    const failing: StockProvider = {
      id: "pexels",
      configured: () => true,
      search: async () => {
        throw new Error("pexels down");
      },
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await searchStockAssets("desert", "video", {
      providers: [failing, fakeStockProvider("pixabay", calls)],
    });
    expect(result.configured).toBe(true);
    if (result.configured) {
      expect(result.assets).toHaveLength(1);
      expect(result.assets[0]!.provider).toBe("pixabay");
    }
    warn.mockRestore();
  });

  it("includeMock returns honestly-labeled mock assets with no real providers", async () => {
    const result = await searchStockAssets("mountain", "photo", {
      providers: [],
      includeMock: true,
    });
    expect(result.configured).toBe(true);
    if (result.configured) {
      expect(result.mock).toBe(true);
      expect(result.assets.length).toBeGreaterThan(0);
      for (const a of result.assets) {
        expect(a.url.startsWith("mock://")).toBe(true);
        expect(a.license).toBe(MOCK_LICENSE);
      }
    }
  });
});

describe("stockProviderStatus", () => {
  it("reports pexels/pixabay key presence without leaking secrets", async () => {
    vi.stubEnv("PEXELS_API_KEY", "");
    vi.stubEnv("PIXABAY_API_KEY", "");
    const status = stockProviderStatus();
    expect(status.anyConfigured).toBe(false);
    expect(JSON.stringify(status)).not.toContain("key-");
  });
});

const realAsset: StockAsset = {
  provider: "pexels",
  asset_id: "123",
  kind: "video",
  url: "https://videos.pexels.com/video-files/123.mp4",
  thumb_url: "https://images.pexels.com/123.jpg",
  source_url: "https://www.pexels.com/video/123/",
  creator: "Jane Doe",
  license: "Pexels License (free to use, attribution appreciated)",
  width: 1920,
  height: 1080,
  fetched_at: "2026-09-28T00:00:00.000Z",
};

describe("buildStockRights", () => {
  it("records every license fact a render needs to prove licensed use", () => {
    const rights = buildStockRights(realAsset);
    expect(rights).toMatchObject({
      provider: "pexels",
      assetId: "123",
      kind: "video",
      license: realAsset.license,
      licenseType: "pexels",
      attributionRequired: false,
      attributionRecommended: true,
      assetUrl: realAsset.url,
      sourceUrl: realAsset.source_url,
      creator: "Jane Doe",
      width: 1920,
      height: 1080,
      fetchedAt: "2026-09-28T00:00:00.000Z",
    });
  });

  it("never records a mock asset as licensed stock", () => {
    const mock = buildStockRights({
      provider: "mock",
      asset_id: "mock-x",
      kind: "photo",
      url: "mock://stock/photo/x-0",
      thumb_url: "mock://stock/photo/x-0/thumb",
      source_url: "mock://stock",
      creator: "Mock provider",
      license: MOCK_LICENSE,
      width: 1920,
      height: 1080,
      fetched_at: new Date(0).toISOString(),
    });
    expect(mock.licenseType).toBe("mock");
    expect(isMockAsset({ provider: "mock", url: "mock://x", license: MOCK_LICENSE })).toBe(true);
    expect(licenseSummary(mock)).toMatch(/MOCK — preview asset, not licensed/);
  });

  it("licenseSummary is human-readable for real licenses", () => {
    const rights = buildStockRights(realAsset);
    expect(licenseSummary(rights)).toBe("Pexels License · attribution appreciated · by Jane Doe");
  });

  it("sceneAssetSourceForStock matches the coordinator contract shape", () => {
    const rights = buildStockRights(realAsset);
    const src = sceneAssetSourceForStock(rights) as {
      kind: string;
      provider: string;
      rights: { assetId: string };
    };
    expect(src.kind).toBe("stock");
    expect(src.provider).toBe("pexels");
    expect(src.rights.assetId).toBe("123");
  });

  it("toContentAssetInsert puts rights in technical_metadata.rights", () => {
    const rights = buildStockRights(realAsset);
    const row = toContentAssetInsert({
      userId: "u1",
      contentItemId: "c1",
      rights,
      sceneId: "s1",
    });
    expect(row.origin).toBe("stock");
    expect(row.kind).toBe("source");
    expect(row.rights_basis).toBe(realAsset.license);
    const meta = row.technical_metadata as { rights: typeof rights; scene_id: string };
    expect(meta.rights.provider).toBe("pexels");
    expect(meta.scene_id).toBe("s1");
  });

  it("toProvenanceInsert maps to the asset_provenance shape", () => {
    const rights = buildStockRights(realAsset);
    const row = toProvenanceInsert({ userId: "u1", projectId: "p1", sceneId: "s1", rights });
    expect(row).toMatchObject({
      kind: "video",
      provider: "pexels",
      model: "123",
      license: realAsset.license,
      license_url: realAsset.source_url,
      asset_url: realAsset.url,
    });
  });
});

describe("mock provider still works (D48 preserved)", () => {
  it("returns deterministic mock:// assets with the honest license label", async () => {
    const assets = await mockStock.search("ocean", "video", 3);
    expect(assets).toHaveLength(3);
    for (const a of assets) {
      expect(a.provider).toBe("mock");
      expect(a.url.startsWith("mock://")).toBe(true);
      expect(a.license).toBe(MOCK_LICENSE);
    }
  });
});
