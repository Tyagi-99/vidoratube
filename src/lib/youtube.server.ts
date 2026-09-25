import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GENERATED_VIDEOS_BUCKET = "generated-videos";

/** Requested at connect time: enough to read the channel, never to publish. */
export const YOUTUBE_CONNECT_SCOPES = ["https://www.googleapis.com/auth/youtube.readonly"].join(
  " ",
);
/** Requested incrementally, only when the user first clicks Publish. */
export const YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
/**
 * Sprint 7–8: second publish scope. videos.update (used for scheduled
 * publishing via status.publishAt) does NOT accept youtube.upload — it needs
 * youtube, youtube.force-ssl, or youtubepartner. force-ssl is the
 * least-privileged of the three that covers it.
 */
export const YOUTUBE_FORCE_SSL_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";
/** Both publish scopes, requested together at the incremental upgrade step. */
export const YOUTUBE_PUBLISH_SCOPES = `${YOUTUBE_UPLOAD_SCOPE} ${YOUTUBE_FORCE_SSL_SCOPE}`;

/**
 * @deprecated Kept for reference only — connect now requests
 * {@link YOUTUBE_CONNECT_SCOPES} and upgrades to {@link YOUTUBE_PUBLISH_SCOPES}
 * incrementally at publish time.
 */
export const YOUTUBE_SCOPES = `${YOUTUBE_UPLOAD_SCOPE} ${YOUTUBE_CONNECT_SCOPES}`;

/** The two OAuth purposes carried in the signed state parameter. */
export type YouTubeOAuthPurpose = "connect" | "upload";

/** True when the granted scope string includes the upload scope. */
export function hasUploadScope(scope: string | null | undefined): boolean {
  if (!scope) return false;
  return scope.split(/\s+/).includes(YOUTUBE_UPLOAD_SCOPE);
}

/** True when the granted scope string includes the force-ssl (scheduling) scope. */
export function hasForceSslScope(scope: string | null | undefined): boolean {
  if (!scope) return false;
  return scope.split(/\s+/).includes(YOUTUBE_FORCE_SSL_SCOPE);
}

/**
 * True when the connection holds BOTH publish scopes. Publishing requires
 * the pair: videos.insert/thumbnails.set need youtube.upload, while
 * videos.update (scheduled publish) needs youtube.force-ssl.
 */
export function hasPublishScopes(scope: string | null | undefined): boolean {
  return hasUploadScope(scope) && hasForceSslScope(scope);
}

/** Thrown when Google reports the grant is dead (401 / invalid_grant). */
export class YouTubeRevokedError extends Error {
  readonly code = "YOUTUBE_REVOKED";
  constructor(message = "Your YouTube connection was revoked. Please reconnect your channel.") {
    super(message);
    this.name = "YouTubeRevokedError";
  }
}

/** True for OAuth token responses that mean the grant is gone for good. */
export function isRevokedTokenResponse(status: number, errorCode?: string): boolean {
  return status === 401 || (status === 400 && errorCode === "invalid_grant");
}

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

/* ------------------------------- base64 utils ------------------------------ */

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function bytesToB64Url(bytes: Uint8Array): string {
  return bytesToB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function utf8Bytes(s: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(textEncoder.encode(s));
}

/** Comparison without an early exit so timing doesn't leak the mismatch position. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/* ---------------- signed state + PKCE (prevents CSRF on the callback) ------- */

/** Fail closed: never sign OAuth state with a public fallback key. */
function stateKey(): string {
  const key = process.env["GOOGLE_OAUTH_CLIENT_SECRET"];
  if (!key) {
    throw new Error(
      "GOOGLE_OAUTH_CLIENT_SECRET is not set — refusing to start YouTube connect without a signing key.",
    );
  }
  return key;
}

export async function hmac(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    utf8Bytes(stateKey()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, utf8Bytes(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = bytesToB64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", utf8Bytes(verifier)),
  );
  return { verifier, challenge: bytesToB64Url(digest) };
}

export async function signState(
  userId: string,
  purpose: YouTubeOAuthPurpose = "connect",
): Promise<{ state: string; verifier: string; challenge: string }> {
  const { verifier, challenge } = await createPkcePair();
  const payload = `${userId}.${purpose}.${Date.now()}.${verifier}`;
  return { state: `${payload}.${await hmac(payload)}`, verifier, challenge };
}

export async function verifyState(
  state: string,
): Promise<{ userId: string; verifier: string; purpose: YouTubeOAuthPurpose } | null> {
  const parts = state.split(".");
  if (parts.length !== 5) return null;
  const [userId, purposeRaw, issuedRaw, verifier, sig] = parts;
  if (!userId || !verifier || !sig) return null;
  const purpose: YouTubeOAuthPurpose = purposeRaw === "upload" ? "upload" : "connect";
  const payload = `${userId}.${purpose}.${issuedRaw}.${verifier}`;
  const expected = hexToBytes(await hmac(payload));
  const actual = hexToBytes(sig);
  if (!expected || !actual || !constantTimeEqual(expected, actual)) return null;
  const issued = Number(issuedRaw);
  if (!Number.isFinite(issued)) return null;
  if (Date.now() - issued > 15 * 60 * 1000) return null;
  return { userId, verifier, purpose };
}

/** Builds the Google OAuth consent URL for the given scopes. */
export function buildConsentUrl(input: {
  clientId: string;
  origin: string;
  state: string;
  challenge: string;
  scopes: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: redirectUri(input.origin),
    response_type: "code",
    scope: input.scopes,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    state: input.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/* --------------------- token encryption at rest (AES-256-GCM) -------------- */

const ENCRYPTED_PREFIX = "enc1:";

async function tokenCryptoKey(): Promise<CryptoKey> {
  const raw = process.env["YOUTUBE_TOKEN_ENCRYPTION_KEY"];
  if (!raw) {
    throw new Error(
      "YOUTUBE_TOKEN_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and add it to the server environment.",
    );
  }
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = b64ToBytes(raw.trim());
  } catch {
    throw new Error("YOUTUBE_TOKEN_ENCRYPTION_KEY is not valid base64.");
  }
  if (bytes.length !== 32) {
    throw new Error(
      "YOUTUBE_TOKEN_ENCRYPTION_KEY must decode to 32 bytes. Generate with `openssl rand -base64 32`.",
    );
  }
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Encrypts an OAuth token for storage. Fail closed when the key is missing. */
export async function encryptToken(plain: string): Promise<string> {
  const key = await tokenCryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, utf8Bytes(plain)),
  );
  // WebCrypto appends the 16-byte auth tag to the ciphertext.
  return `${ENCRYPTED_PREFIX}${bytesToB64(iv)}.${bytesToB64(ct)}`;
}

/**
 * Decrypts a stored token. Rows written before encryption was introduced are
 * returned as-is (legacy plaintext). Returns null when the value is missing or
 * tampered with — never throws for a stored value.
 */
export async function decryptToken(stored: string | null | undefined): Promise<string | null> {
  if (!stored) return null;
  if (!stored.startsWith(ENCRYPTED_PREFIX)) return stored;
  const [ivB64, ctB64] = stored.slice(ENCRYPTED_PREFIX.length).split(".");
  if (!ivB64 || !ctB64) return null;
  try {
    const key = await tokenCryptoKey();
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(ivB64) },
      key,
      b64ToBytes(ctB64),
    );
    return textDecoder.decode(pt);
  } catch {
    return null;
  }
}

/* ---------------------------------- tokens --------------------------------- */

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

export async function exchangeCode(
  code: string,
  origin: string,
  codeVerifier?: string,
): Promise<TokenResponse> {
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
      ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
    }),
  });
  const payload = (await res.json()) as TokenResponse;
  if (!res.ok) {
    if (isRevokedTokenResponse(res.status, payload.error)) throw new YouTubeRevokedError();
    throw new Error(payload.error_description ?? "Google rejected the sign-in.");
  }
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
  if (!res.ok) {
    // Google returns 400 + invalid_grant when the user revoked access or the
    // grant expired — the stored tokens are dead and must not be retried.
    if (isRevokedTokenResponse(res.status, payload.error)) throw new YouTubeRevokedError();
    throw new Error(payload.error_description ?? "Could not refresh the YouTube token.");
  }
  return payload;
}

type StoredConnection = {
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
};

/**
 * Returns a usable access token, reusing the stored one while it is valid for
 * at least 5 more minutes. Refreshes (decrypting the stored refresh token)
 * only when the access token is missing, expired, or expiring.
 */
export async function getValidAccessToken(
  connection: StoredConnection,
): Promise<{ accessToken: string; refreshed: TokenResponse | null }> {
  const stored = await decryptToken(connection.access_token);
  const expiresAt = connection.expires_at ? Date.parse(connection.expires_at) : NaN;
  if (stored && Number.isFinite(expiresAt) && expiresAt - Date.now() > 5 * 60 * 1000) {
    return { accessToken: stored, refreshed: null };
  }
  const refreshToken = await decryptToken(connection.refresh_token);
  if (!refreshToken) {
    throw new YouTubeRevokedError(
      "The YouTube connection lost its credentials — please reconnect your channel.",
    );
  }
  const tokens = await refreshAccessToken(refreshToken);
  if (!tokens.access_token) throw new Error("Could not refresh the YouTube token.");
  return { accessToken: tokens.access_token, refreshed: tokens };
}

/** Revokes the Google grant. Never throws — callers delete the row regardless. */
export async function revokeGoogleToken(token: string): Promise<void> {
  try {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
  } catch (error) {
    console.warn(
      "[vidora] Google token revoke failed:",
      error instanceof Error ? error.message : error,
    );
  }
}

export async function fetchChannel(
  accessToken: string,
): Promise<{ id: string | null; title: string | null }> {
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (res.status === 401) throw new YouTubeRevokedError();
  if (!res.ok) return { id: null, title: null };
  const payload = (await res.json()) as {
    items?: { id?: string; snippet?: { title?: string } }[];
  };
  const item = payload.items?.[0];
  return { id: item?.id ?? null, title: item?.snippet?.title ?? null };
}

/* ------------------------------ publish guard ------------------------------ */

export type PublishPrecheck =
  | { action: "return-existing"; videoId: string }
  | { action: "already-uploading" }
  | { action: "claim" };

/** Pure decision helper: is this publish a duplicate, a race, or a fresh claim? */
export function publishPrecheck(job: {
  youtube_status: string | null;
  youtube_video_id: string | null;
}): PublishPrecheck {
  if (job.youtube_status === "published" && job.youtube_video_id) {
    return { action: "return-existing", videoId: job.youtube_video_id };
  }
  if (job.youtube_status === "uploading") return { action: "already-uploading" };
  return { action: "claim" };
}

/**
 * Atomically claims a job for publishing: the UPDATE only applies when the
 * status is still exactly what the caller read, so two concurrent publishes
 * cannot both proceed. Returns true when this caller won the claim.
 */
export async function claimJobForUpload(
  client: SupabaseClient<Database>,
  jobId: string,
  currentStatus: string | null,
): Promise<boolean> {
  const base = client
    .from("video_jobs")
    .update({ youtube_status: "uploading" })
    .eq("id", jobId);
  const query =
    currentStatus == null
      ? base.is("youtube_status", null)
      : base.eq("youtube_status", currentStatus);
  const { data } = await query.select("id").maybeSingle();
  return Boolean(data);
}

/* --------------------------- streaming video source ------------------------ */

/**
 * Opens the stored MP4 as a stream (via a short-lived signed URL) without
 * loading the whole file into server memory.
 */
export async function streamStoredVideo(
  admin: SupabaseClient<Database>,
  jobId: string,
  userId: string,
): Promise<{ stream: ReadableStream<Uint8Array>; size: number }> {
  const path = `${userId}/${jobId}/video.mp4`;
  const { data, error } = await admin.storage
    .from(GENERATED_VIDEOS_BUCKET)
    .createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new Error("The rendered video file is not available yet.");
  const head = await fetch(data.signedUrl, { method: "HEAD" });
  const size = Number(head.headers.get("content-length"));
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error("Could not determine the rendered video's file size.");
  }
  const res = await fetch(data.signedUrl);
  if (!res.ok || !res.body) throw new Error("Could not download the rendered video file.");
  return { stream: res.body as ReadableStream<Uint8Array>, size };
}

/* --------------------------- chunked resumable upload ---------------------- */

const UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB (YouTube wants multiples of 256 KB)
const CHUNK_MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class RetryableUploadError extends Error {}

/** Asks YouTube how many bytes of this resumable session are already committed. */
async function queryCommittedOffset(
  uploadUrl: string,
  accessToken: string,
  total: number,
): Promise<number> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Length": "0",
      "Content-Range": `bytes */${total}`,
    },
  });
  if (res.status === 308) {
    const m = /bytes=0-(\d+)/.exec(res.headers.get("range") ?? "");
    return m?.[1] ? Number(m[1]) + 1 : 0;
  }
  if (res.ok) return total;
  throw new Error(`Upload status check failed (${res.status})`);
}

async function sendChunk(
  uploadUrl: string,
  accessToken: string,
  bytes: Uint8Array,
  start: number,
  total: number,
): Promise<{ complete: boolean; videoId?: string | undefined }> {
  const end = start + bytes.length - 1;
  let res: Response;
  try {
    res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "video/mp4",
        "Content-Length": String(bytes.length),
        "Content-Range": `bytes ${start}-${end}/${total}`,
      },
      body: bytes as BodyInit,
    });
  } catch (error) {
    throw new RetryableUploadError(
      `Chunk upload network error: ${error instanceof Error ? error.message : error}`,
    );
  }
  if (res.status === 308) return { complete: false };
  if (res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { id?: string };
    return { complete: true, videoId: payload.id };
  }
  const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
  const detail = (await res.text().catch(() => "")).slice(0, 200);
  const error = new Error(`YouTube chunk upload failed (${res.status}): ${detail}`);
  if (retryable) throw new RetryableUploadError(error.message);
  throw error;
}

/**
 * Sends one chunk with retries. After a retriable failure it re-syncs with the
 * server and only re-sends bytes YouTube hasn't committed yet.
 */
async function uploadChunkWithRetry(
  uploadUrl: string,
  accessToken: string,
  chunk: Uint8Array,
  start: number,
  total: number,
): Promise<{ complete: boolean; videoId?: string | undefined; nextOffset: number }> {
  let offset = start;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < CHUNK_MAX_ATTEMPTS; attempt++) {
    const pending = chunk.subarray(offset - start);
    if (pending.length === 0) return { complete: false, nextOffset: offset };
    try {
      const result = await sendChunk(uploadUrl, accessToken, pending, offset, total);
      return { ...result, nextOffset: result.complete ? total : offset + pending.length };
    } catch (error) {
      lastError = error;
      if (!(error instanceof RetryableUploadError)) throw error;
      try {
        offset = Math.max(offset, await queryCommittedOffset(uploadUrl, accessToken, total));
      } catch {
        /* keep the current offset and retry the chunk */
      }
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("YouTube chunk upload failed");
}

/**
 * Uploads a video to YouTube with the resumable-upload protocol, streaming in
 * 8 MB chunks with per-chunk retry. The whole file is never held in memory.
 */
export async function uploadToYouTube(input: {
  accessToken: string;
  video: { stream: ReadableStream<Uint8Array>; size: number };
  title: string;
  description: string;
  privacyStatus: "private" | "unlisted" | "public";
  /** The uploader's own "made for kids" declaration (COPPA). Required by YouTube. */
  madeForKids: boolean;
  tags: string[];
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
}): Promise<string> {
  const total = input.video.size;
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("Cannot upload to YouTube: the video size is unknown.");
  }
  const metadata = {
    snippet: {
      title: input.title.slice(0, 100),
      description: input.description.slice(0, 4900),
      tags: input.tags.slice(0, 10),
      categoryId: "22",
    },
    status: { privacyStatus: input.privacyStatus, selfDeclaredMadeForKids: input.madeForKids },
  };

  const start = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(total),
      },
      body: JSON.stringify(metadata),
    },
  );
  if (!start.ok) {
    // 401 here means the access token died between the refresh and the upload.
    if (start.status === 401) throw new YouTubeRevokedError();
    throw new Error(
      `YouTube rejected the upload (${start.status}): ${(await start.text().catch(() => "")).slice(0, 200)}`,
    );
  }
  const uploadUrl = start.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube did not return an upload URL.");

  const reader = input.video.stream.getReader();
  let offset = 0;
  let carry: Uint8Array[] = [];
  let carryLen = 0;
  const takeChunk = (): Uint8Array => {
    const out = new Uint8Array(Math.min(carryLen, UPLOAD_CHUNK_SIZE));
    let pos = 0;
    while (pos < out.length && carry.length > 0) {
      const head = carry[0]!;
      const need = out.length - pos;
      if (head.length <= need) {
        out.set(head, pos);
        pos += head.length;
        carry.shift();
      } else {
        out.set(head.subarray(0, need), pos);
        carry[0] = head.subarray(need);
        pos = out.length;
      }
    }
    carryLen -= out.length;
    return out;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value && value.length > 0) {
        carry.push(value);
        carryLen += value.length;
      }
      while (carryLen >= UPLOAD_CHUNK_SIZE || (done && carryLen > 0)) {
        const chunk = takeChunk();
        const result = await uploadChunkWithRetry(
          uploadUrl,
          input.accessToken,
          chunk,
          offset,
          total,
        );
        if (result.complete) {
          if (!result.videoId) throw new Error("YouTube did not return a video id.");
          return result.videoId;
        }
        offset = result.nextOffset;
        input.onProgress?.(offset, total);
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
  throw new Error("The upload stream ended before YouTube confirmed the video.");
}
