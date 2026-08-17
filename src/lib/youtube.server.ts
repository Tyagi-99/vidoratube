const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
].join(" ");

export function googleCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env["GOOGLE_OAUTH_CLIENT_ID"];
  const clientSecret = process.env["GOOGLE_OAUTH_CLIENT_SECRET"];
  if (!clientId || !clientSecret) {
    throw new Error(
      "YouTube publishing isn't configured yet. Add the Google OAuth client ID and secret in Admin → Integrations.",
    );
  }
  return { clientId, clientSecret };
}

export function youtubeConfigured(): boolean {
  return Boolean(process.env["GOOGLE_OAUTH_CLIENT_ID"] && process.env["GOOGLE_OAUTH_CLIENT_SECRET"]);
}

export function redirectUri(origin: string): string {
  return `${origin}/api/public/youtube-callback`;
}

/* ---------------- signed state (prevents CSRF on the callback) --------------- */

function stateKey(): string {
  return process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ?? "vidora-state";
}

async function hmac(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(stateKey()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signState(userId: string): Promise<string> {
  const payload = `${userId}.${Date.now()}`;
  return `${payload}.${await hmac(payload)}`;
}

export async function verifyState(state: string): Promise<string | null> {
  const parts = state.split(".");
  if (parts.length !== 3) return null;
  const [userId, issued, sig] = parts;
  const payload = `${userId}.${issued}`;
  if ((await hmac(payload)) !== sig) return null;
  if (Date.now() - Number(issued) > 15 * 60 * 1000) return null;
  return userId ?? null;
}

/* ---------------------------------- tokens --------------------------------- */

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error_description?: string;
};

export async function exchangeCode(code: string, origin: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = googleCredentials();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(origin),
      grant_type: "authorization_code",
    }),
  });
  const payload = (await res.json()) as TokenResponse;
  if (!res.ok) throw new Error(payload.error_description ?? "Google rejected the sign-in.");
  return payload;
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = googleCredentials();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const payload = (await res.json()) as TokenResponse;
  if (!res.ok) throw new Error(payload.error_description ?? "Could not refresh the YouTube token.");
  return payload;
}

export async function fetchChannel(
  accessToken: string,
): Promise<{ id: string | null; title: string | null }> {
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return { id: null, title: null };
  const payload = (await res.json()) as {
    items?: { id?: string; snippet?: { title?: string } }[];
  };
  const item = payload.items?.[0];
  return { id: item?.id ?? null, title: item?.snippet?.title ?? null };
}

/* ---------------------------------- upload --------------------------------- */

export async function uploadToYouTube(input: {
  accessToken: string;
  video: Blob;
  title: string;
  description: string;
  privacyStatus: "private" | "unlisted" | "public";
  tags: string[];
}): Promise<string> {
  const metadata = {
    snippet: {
      title: input.title.slice(0, 100),
      description: input.description.slice(0, 4900),
      tags: input.tags.slice(0, 10),
      categoryId: "22",
    },
    status: { privacyStatus: input.privacyStatus, selfDeclaredMadeForKids: false },
  };

  // Start a resumable session so large files stream in a single PUT.
  const start = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(input.video.size),
      },
      body: JSON.stringify(metadata),
    },
  );
  if (!start.ok) {
    throw new Error(`YouTube rejected the upload (${start.status}): ${await start.text()}`);
  }
  const uploadUrl = start.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube did not return an upload URL.");

  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4" },
    body: input.video,
  });
  if (!put.ok) {
    throw new Error(`YouTube upload failed (${put.status}): ${await put.text()}`);
  }
  const payload = (await put.json()) as { id?: string };
  if (!payload.id) throw new Error("YouTube did not return a video id.");
  return payload.id;
}
