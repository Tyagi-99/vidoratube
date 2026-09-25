import { providerFetch } from "./http.server";

export type StockAsset = {
  provider: "pexels" | "pixabay" | "mock";
  asset_id: string;
  kind: "photo" | "video";
  url: string;
  thumb_url: string;
  source_url: string;
  creator: string;
  license: string;
  width: number;
  height: number;
  fetched_at: string;
};

export interface StockProvider {
  /** "mock" is the clearly-marked fallback used when no API key is set. */
  id: "pexels" | "pixabay" | "mock";
  configured(): boolean;
  search(query: string, kind: "photo" | "video", perPage?: number): Promise<StockAsset[]>;
}

/* ------------------------------ Pexels ------------------------------ */

export const pexels: StockProvider = {
  id: "pexels",
  configured: () => Boolean(process.env["PEXELS_API_KEY"]),
  async search(query, kind, perPage = 10) {
    const key = process.env["PEXELS_API_KEY"];
    if (!key) return [];
    const base = kind === "video" ? "https://api.pexels.com/videos/search" : "https://api.pexels.com/v1/search";
    const url = `${base}?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`;
    const res = await providerFetch("Pexels", url, { headers: { Authorization: key } });
    const json = (await res.json()) as PexelsResponse;
    const now = new Date().toISOString();

    if (kind === "video") {
      return (json.videos ?? []).map((v) => {
        const file =
          [...(v.video_files ?? [])].sort((a, b) => (b.width ?? 0) - (a.width ?? 0)).find((f) => (f.width ?? 0) <= 1920) ??
          v.video_files?.[0];
        return {
          provider: "pexels" as const,
          asset_id: String(v.id),
          kind: "video" as const,
          url: file?.link ?? "",
          thumb_url: v.image ?? "",
          source_url: v.url ?? "",
          creator: v.user?.name ?? "Pexels contributor",
          license: "Pexels License (free to use, attribution appreciated)",
          width: file?.width ?? 0,
          height: file?.height ?? 0,
          fetched_at: now,
        };
      }).filter((a) => a.url);
    }

    return (json.photos ?? []).map((p) => ({
      provider: "pexels" as const,
      asset_id: String(p.id),
      kind: "photo" as const,
      url: p.src?.large2x ?? p.src?.large ?? p.src?.original ?? "",
      thumb_url: p.src?.medium ?? p.src?.small ?? "",
      source_url: p.url ?? "",
      creator: p.photographer ?? "Pexels contributor",
      license: "Pexels License (free to use, attribution appreciated)",
      width: p.width ?? 0,
      height: p.height ?? 0,
      fetched_at: now,
    })).filter((a) => a.url);
  },
};

/* ------------------------------ Pixabay ----------------------------- */

export const pixabay: StockProvider = {
  id: "pixabay",
  configured: () => Boolean(process.env["PIXABAY_API_KEY"]),
  async search(query, kind, perPage = 10) {
    const key = process.env["PIXABAY_API_KEY"];
    if (!key) return [];
    const base = kind === "video" ? "https://pixabay.com/api/videos/" : "https://pixabay.com/api/";
    const url = `${base}?key=${key}&q=${encodeURIComponent(query)}&per_page=${Math.max(3, perPage)}&safesearch=true${
      kind === "photo" ? "&image_type=photo&orientation=horizontal" : ""
    }`;
    const res = await providerFetch("Pixabay", url, {});
    const json = (await res.json()) as PixabayResponse;
    const now = new Date().toISOString();

    return (json.hits ?? [])
      .map((h) => {
        const video = h.videos?.large?.url || h.videos?.medium?.url || "";
        return {
          provider: "pixabay" as const,
          asset_id: String(h.id),
          kind,
          url: kind === "video" ? video : h.largeImageURL || h.webformatURL || "",
          thumb_url: h.previewURL || h.webformatURL || "",
          source_url: h.pageURL ?? "",
          creator: h.user ?? "Pixabay contributor",
          license: "Pixabay Content License (free to use)",
          width: kind === "video" ? (h.videos?.large?.width ?? 0) : (h.imageWidth ?? 0),
          height: kind === "video" ? (h.videos?.large?.height ?? 0) : (h.imageHeight ?? 0),
          fetched_at: now,
        };
      })
      .filter((a) => a.url);
  },
};

export const STOCK_PROVIDERS: StockProvider[] = [pexels, pixabay];

/** Searches providers in order and ranks the combined results. */
export async function findBestStockAsset(
  queries: string[],
  kind: "photo" | "video",
): Promise<StockAsset | null> {
  const words = queries.join(" ").toLowerCase().split(/\s+/).filter(Boolean);
  const collected: StockAsset[] = [];

  for (const provider of STOCK_PROVIDERS) {
    if (!provider.configured()) continue;
    for (const query of queries.slice(0, 3)) {
      try {
        collected.push(...(await provider.search(query, kind, 8)));
      } catch {
        // A single failing query must never break the scene; try the next one.
      }
      if (collected.length >= 12) break;
    }
    if (collected.length >= 6) break;
  }

  if (collected.length === 0) return null;

  const scored = collected.map((asset) => {
    const haystack = `${asset.source_url} ${asset.creator}`.toLowerCase();
    const overlap = words.filter((w) => w.length > 3 && haystack.includes(w)).length;
    const resolution = Math.min(asset.width, 4000) / 4000;
    const landscape = asset.width >= asset.height ? 0.3 : 0;
    return { asset, score: overlap * 0.4 + resolution + landscape };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]!.asset;
}

/* ----------------------------- API shapes ---------------------------- */

type PexelsResponse = {
  photos?: {
    id: number;
    url?: string;
    photographer?: string;
    width?: number;
    height?: number;
    src?: { original?: string; large2x?: string; large?: string; medium?: string; small?: string };
  }[];
  videos?: {
    id: number;
    url?: string;
    image?: string;
    user?: { name?: string };
    video_files?: { link?: string; width?: number; height?: number }[];
  }[];
};

type PixabayResponse = {
  hits?: {
    id: number;
    pageURL?: string;
    user?: string;
    previewURL?: string;
    webformatURL?: string;
    largeImageURL?: string;
    imageWidth?: number;
    imageHeight?: number;
    videos?: {
      large?: { url?: string; width?: number; height?: number };
      medium?: { url?: string; width?: number; height?: number };
    };
  }[];
};
