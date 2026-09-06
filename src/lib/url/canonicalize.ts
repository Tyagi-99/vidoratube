/**
 * URL normalization for the content library.
 * Pure helpers — safe for unit tests and server functions.
 */

export type DetectedPlatform =
  | "youtube"
  | "vimeo"
  | "tiktok"
  | "instagram"
  | "x"
  | "facebook"
  | "other"
  | "unknown";

export type CanonicalUrlResult = {
  /** Normalized absolute URL, or null if input is not a usable URL */
  canonicalUrl: string | null;
  platform: DetectedPlatform;
  /** Platform-native ID when we can parse it (e.g. YouTube video id) */
  platformId: string | null;
  /** True when the input looked like a URL but could not be normalized */
  invalid: boolean;
};

const YT_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

function stripWww(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

/** Extract a YouTube video id from common URL shapes. */
export function extractYouTubeVideoId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host === "youtu.be" || host === "www.youtu.be") {
    const id = url.pathname.replace(/^\//, "").split("/")[0] ?? "";
    return /^[\w-]{11}$/.test(id) ? id : null;
  }
  if (!YT_HOSTS.has(host)) return null;
  const v = url.searchParams.get("v");
  if (v && /^[\w-]{11}$/.test(v)) return v;
  const parts = url.pathname.split("/").filter(Boolean);
  // /shorts/ID, /embed/ID, /live/ID
  const marker = parts.findIndex((p) => p === "shorts" || p === "embed" || p === "live" || p === "v");
  if (marker >= 0) {
    const id = parts[marker + 1] ?? "";
    return /^[\w-]{11}$/.test(id) ? id : null;
  }
  return null;
}

export function detectPlatform(hostname: string): DetectedPlatform {
  const h = stripWww(hostname);
  if (h === "youtu.be" || h === "youtube.com" || h.endsWith(".youtube.com")) return "youtube";
  if (h === "vimeo.com" || h.endsWith(".vimeo.com")) return "vimeo";
  if (h === "tiktok.com" || h.endsWith(".tiktok.com")) return "tiktok";
  if (h === "instagram.com" || h.endsWith(".instagram.com")) return "instagram";
  if (h === "x.com" || h === "twitter.com" || h.endsWith(".twitter.com")) return "x";
  if (h === "facebook.com" || h.endsWith(".facebook.com") || h === "fb.watch") return "facebook";
  if (h.includes(".")) return "other";
  return "unknown";
}

/**
 * Canonicalize a user-entered or discovered URL.
 * - Trims whitespace
 * - Adds https:// if scheme missing
 * - Lowercases host
 * - Strips hash and common tracking params
 * - For YouTube, collapses to https://www.youtube.com/watch?v=ID
 */
export function canonicalizeUrl(raw: string): CanonicalUrlResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { canonicalUrl: null, platform: "unknown", platformId: null, invalid: true };
  }

  let candidate = trimmed;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { canonicalUrl: null, platform: "unknown", platformId: null, invalid: true };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { canonicalUrl: null, platform: "unknown", platformId: null, invalid: true };
  }

  url.hash = "";
  // Drop common tracking params
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|mc_|ref$|si$)/i.test(key) || key.toLowerCase() === "feature") {
      url.searchParams.delete(key);
    }
  }

  const platform = detectPlatform(url.hostname);
  let platformId: string | null = null;

  if (platform === "youtube") {
    platformId = extractYouTubeVideoId(url.toString());
    if (platformId) {
      return {
        canonicalUrl: `https://www.youtube.com/watch?v=${platformId}`,
        platform,
        platformId,
        invalid: false,
      };
    }
  }

  url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase();
  // Normalize empty path
  if (url.pathname === "") url.pathname = "/";
  // Remove trailing slash except root
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return {
    canonicalUrl: url.toString(),
    platform,
    platformId,
    invalid: false,
  };
}
