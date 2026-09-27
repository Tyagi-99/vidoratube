/**
 * Real search backend: YouTube Data API v3 `search.list`.
 *
 * Server-side, quota-cheap (1 quota unit per call in its own 100/day bucket —
 * see api-cost.ts), and read-only. Uses the existing YouTube integration's
 * configured-ness (youtubeConfigured: the Google OAuth client is set up) plus
 * a server Data API key (YOUTUBE_API_KEY) that performs the actual calls.
 *
 * Honesty rules: configured() is false until BOTH are present; search()
 * returns `status: "unconfigured"` until then — never fabricated results.
 * search.list returns snippets only, so metrics (views/likes/...) are null:
 * the adapter reports what the API actually returned, nothing invented.
 */
import type { ContentMetadata, ProviderResult, SearchProvider } from "./contracts";
import { providerFetch } from "./http.server";
import { withProviderTelemetry } from "./telemetry.server";
import { recordYouTubeQuota } from "../api-cost";
import { youtubeConfigured } from "../youtube.server";
import type { CostCtx } from "../api-cost";

const SEARCH_ENDPOINT = "https://www.googleapis.com/youtube/v3/search";

export function youtubeSearchConfigured(): boolean {
  return youtubeConfigured() && Boolean(process.env["YOUTUBE_API_KEY"]);
}

type SearchThumbnail = { url?: unknown };
type SearchItem = {
  id?: { kind?: unknown; videoId?: unknown };
  snippet?: {
    title?: unknown;
    description?: unknown;
    channelId?: unknown;
    channelTitle?: unknown;
    publishedAt?: unknown;
    thumbnails?: {
      high?: SearchThumbnail;
      medium?: SearchThumbnail;
      default?: SearchThumbnail;
    };
  };
};

type SearchResponse = {
  items?: SearchItem[];
};

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function toMetadata(item: SearchItem): ContentMetadata | null {
  const videoId = asString(item.id?.videoId);
  if (!videoId) return null; // search.list can return channels/playlists; we only take videos
  const snippet = item.snippet ?? {};
  const thumbs = snippet.thumbnails ?? {};
  const thumbnailUrl =
    asString(thumbs.high?.url) ?? asString(thumbs.medium?.url) ?? asString(thumbs.default?.url);
  const channelId = asString(snippet.channelId);

  return {
    platform: "youtube",
    platformId: videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    title: asString(snippet.title),
    description: asString(snippet.description),
    creatorName: asString(snippet.channelTitle),
    creatorProfileUrl: channelId ? `https://www.youtube.com/channel/${channelId}` : null,
    uploadedAt: asString(snippet.publishedAt),
    durationSeconds: null, // search.list has no duration — never invent it
    thumbnailUrl,
    language: null,
    tags: [],
    // search.list returns no statistics — every metric stays null.
    metrics: { views: null, likes: null, comments: null, shares: null, followers: null },
    raw: item,
  };
}

async function runSearch(
  query: string,
  maxResults: number,
  costCtx: CostCtx | null | undefined,
): Promise<ContentMetadata[]> {
  const key = process.env["YOUTUBE_API_KEY"];
  if (!key) {
    throw new Error(
      "YouTube search is not configured. Add YOUTUBE_API_KEY (founder) alongside the Google OAuth client.",
    );
  }
  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", String(Math.min(50, Math.max(1, maxResults))));
  url.searchParams.set("q", query);
  url.searchParams.set("key", key);

  const res = await providerFetch("YouTube", url.toString(), { timeoutMs: 30_000 });
  const payload = (await res.json()) as SearchResponse;
  const items = Array.isArray(payload.items) ? payload.items : [];
  const results: ContentMetadata[] = [];
  for (const item of items) {
    const meta = toMetadata(item);
    if (meta) results.push(meta);
  }

  if (costCtx) {
    await recordYouTubeQuota(costCtx.admin, {
      userId: costCtx.userId,
      projectId: costCtx.projectId ?? null,
      operation: "search.list",
    });
  }
  return results;
}

export const youtubeSearch: SearchProvider = {
  id: "youtube-search",
  label: "YouTube Data API (search.list)",
  configured: youtubeSearchConfigured,
  async search(
    query: string,
    options?: { maxResults?: number | undefined; costCtx?: CostCtx | null | undefined },
  ): Promise<ProviderResult<ContentMetadata[]>> {
    const maxResults = options?.maxResults ?? 10;
    return withProviderTelemetry(() => runSearch(query, maxResults, options?.costCtx ?? null), {
      provider: "youtube",
      operation: "search.list",
      model: null,
      configured: youtubeSearchConfigured(),
      usage: { max_results: maxResults, query_chars: query.length },
    });
  },
};
