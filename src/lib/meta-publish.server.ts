import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Sprint 7–8 (workstream A): Meta (Facebook/Instagram) publishing adapters.
 *
 * Two adapters, both gated to founder-designated TEST accounts only (see
 * publishing-gates.server.ts — unset config disables publishing outright,
 * never silently):
 *
 * - Facebook Page video: POST /{page-id}/videos with a public file_url, or
 *   with a resumable-upload file handle for large files. Scheduling via
 *   published=false + scheduled_publish_time.
 * - Instagram Reels: the two-step container flow — POST /{ig-user-id}/media
 *   (media_type=REELS) -> poll the container until FINISHED -> POST
 *   /{ig-user-id}/media_publish.
 *
 * HARD RULES: no real network calls except to graph.facebook.com /
 * graph-video.facebook.com; no uploads to anything but the designated test
 * accounts; tokens encrypted at rest (AES-256-GCM); every publish path
 * re-checks the human-approval record before executing (the approval gate
 * lives in publishing-gates.server.ts — the sibling workstream's
 * server-enforced approvals table plugs in there).
 */

export const META_GRAPH_VERSION = "v26.0";
const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const GRAPH_VIDEO = `https://graph-video.facebook.com/${META_GRAPH_VERSION}`;

/** Minimum publish permission set: Facebook Page video. */
export const META_FB_PUBLISH_PERMISSIONS = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
] as const;
/** Minimum publish permission set: Instagram content publishing. */
export const META_IG_PUBLISH_PERMISSIONS = ["instagram_basic", "instagram_content_publish"] as const;

/** All permissions requested at Meta connect time (FB + IG publishing). */
export const META_CONNECT_SCOPES = [
  ...META_FB_PUBLISH_PERMISSIONS,
  ...META_IG_PUBLISH_PERMISSIONS,
].join(",");

/** Meta API error with the Graph error code/subcode for debugging. */
export class MetaApiError extends Error {
  readonly code: string;
  readonly fbCode?: number | undefined;
  readonly fbSubcode?: number | undefined;
  constructor(message: string, opts?: { code?: string; fbCode?: number; fbSubcode?: number }) {
    super(message);
    this.name = "MetaApiError";
    this.code = opts?.code ?? "META_API_ERROR";
    this.fbCode = opts?.fbCode;
    this.fbSubcode = opts?.fbSubcode;
  }
}

type MetaErrorPayload = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
  };
};

/**
 * Meta sometimes returns HTTP 200 with an {error} body, and sometimes a
 * non-2xx with the same shape. Normalize both into MetaApiError.
 */
async function metaFetch(url: string, init: RequestInit, what: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (error) {
    throw new MetaApiError(
      `${what}: network error — ${error instanceof Error ? error.message : error}`,
      { code: "META_NETWORK_ERROR" },
    );
  }
  const payload = (await res.json().catch(() => ({}))) as MetaErrorPayload;
  const err = payload.error;
  if (!res.ok || err) {
    const details: { code: string; fbCode?: number; fbSubcode?: number } = {
      code: "META_API_ERROR",
    };
    if (err?.code !== undefined) details.fbCode = err.code;
    if (err?.error_subcode !== undefined) details.fbSubcode = err.error_subcode;
    throw new MetaApiError(
      `${what}: ${err?.message ?? `HTTP ${res.status}`}`.slice(0, 300),
      details,
    );
  }
  return payload;
}

function postForm(url: string, params: Record<string, string | undefined>, what: string) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body.set(k, v);
  return metaFetch(url, { method: "POST", body }, what);
}

/* ------------------------------ configuration ------------------------------ */

export function metaCredentials(): { appId: string; appSecret: string } {
  const appId = process.env["META_APP_ID"];
  const appSecret = process.env["META_APP_SECRET"];
  if (!appId || !appSecret) {
    throw new Error(
      "Meta publishing isn't configured yet. Add META_APP_ID and META_APP_SECRET in Admin → Integrations.",
    );
  }
  return { appId, appSecret };
}

export function metaConfigured(): boolean {
  return Boolean(process.env["META_APP_ID"] && process.env["META_APP_SECRET"]);
}

export function metaRedirectUri(origin: string): string {
  return `${origin}/api/public/meta-callback`;
}

/* --------------------- token encryption at rest (AES-256-GCM) --------------- */

const ENCRYPTED_PREFIX = "enc1:";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function metaCryptoKey(): Promise<CryptoKey> {
  const raw = process.env["META_TOKEN_ENCRYPTION_KEY"];
  if (!raw) {
    throw new Error(
      "META_TOKEN_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and add it to the server environment.",
    );
  }
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = b64ToBytes(raw.trim());
  } catch {
    throw new Error("META_TOKEN_ENCRYPTION_KEY is not valid base64.");
  }
  if (bytes.length !== 32) {
    throw new Error("META_TOKEN_ENCRYPTION_KEY must decode to 32 bytes.");
  }
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/**
 * Encrypts a Meta token for storage. Same AES-256-GCM "enc1:" envelope as the
 * YouTube token crypto (fail closed when the key is missing).
 */
export async function encryptMetaToken(plain: string): Promise<string> {
  const key = await metaCryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      Uint8Array.from(textEncoder.encode(plain)),
    ),
  );
  return `${ENCRYPTED_PREFIX}${bytesToB64(iv)}.${bytesToB64(ct)}`;
}

/** Decrypts a stored Meta token. Returns null when missing or tampered with. */
export async function decryptMetaToken(stored: string | null | undefined): Promise<string | null> {
  if (!stored) return null;
  if (!stored.startsWith(ENCRYPTED_PREFIX)) return stored;
  const [ivB64, ctB64] = stored.slice(ENCRYPTED_PREFIX.length).split(".");
  if (!ivB64 || !ctB64) return null;
  try {
    const key = await metaCryptoKey();
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

/* ------------------------- signed OAuth state (CSRF) ------------------------- */

function stateKey(): string {
  const key = process.env["META_APP_SECRET"];
  if (!key) throw new Error("META_APP_SECRET is not set — refusing to start Meta connect.");
  return key;
}

async function hmacHex(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(textEncoder.encode(stateKey())),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, Uint8Array.from(textEncoder.encode(value)));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Signs the OAuth state parameter so the callback can't be forged. */
export async function signMetaState(userId: string): Promise<string> {
  const payload = `${userId}.${Date.now()}`;
  return `${payload}.${await hmacHex(payload)}`;
}

/** Verifies the OAuth state; returns the user id or null. 15-minute expiry. */
export async function verifyMetaState(state: string): Promise<string | null> {
  const parts = state.split(".");
  if (parts.length !== 3) return null;
  const [userId, issuedRaw, sig] = parts;
  if (!userId || !sig) return null;
  const payload = `${userId}.${issuedRaw}`;
  const expected = hexToBytes(await hmacHex(payload));
  const actual = hexToBytes(sig);
  if (!expected || !actual || expected.length !== actual.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i]! ^ actual[i]!;
  if (diff !== 0) return null;
  const issued = Number(issuedRaw);
  if (!Number.isFinite(issued) || Date.now() - issued > 15 * 60 * 1000) return null;
  return userId;
}

/** Builds the Facebook Login URL for the connect flow. */
export function buildMetaLoginUrl(input: {
  appId: string;
  origin: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.appId,
    redirect_uri: metaRedirectUri(input.origin),
    response_type: "code",
    scope: META_CONNECT_SCOPES,
    state: input.state,
  });
  return `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth?${params.toString()}`;
}

/* --------------------------------- OAuth ----------------------------------- */

type TokenPayload = {
  access_token?: string;
  expires_in?: number;
} & MetaErrorPayload;

/** Exchanges the Login code for a short-lived user access token. */
export async function exchangeMetaCode(
  code: string,
  origin: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const { appId, appSecret } = metaCredentials();
  const payload = (await postForm(
    `${GRAPH}/oauth/access_token`,
    {
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: metaRedirectUri(origin),
      code,
    },
    "Meta code exchange",
  )) as TokenPayload;
  if (!payload.access_token) throw new MetaApiError("Meta did not return an access token.");
  return { accessToken: payload.access_token, expiresIn: payload.expires_in ?? 3600 };
}

/** Exchanges a short-lived user token for a long-lived one (~60 days). */
export async function exchangeForLongLivedToken(
  shortLivedToken: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const { appId, appSecret } = metaCredentials();
  const payload = (await postForm(
    `${GRAPH}/oauth/access_token`,
    {
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortLivedToken,
    },
    "Meta long-lived token exchange",
  )) as TokenPayload;
  if (!payload.access_token) throw new MetaApiError("Meta did not return a long-lived token.");
  return { accessToken: payload.access_token, expiresIn: payload.expires_in ?? 5184000 };
}

export type MetaPageAccount = {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string } | null | undefined;
};

/**
 * Lists the Pages the user manages, with each Page's own access token and the
 * linked Instagram Business/Creator account. Page tokens — never the user
 * token — are what publishing endpoints require.
 */
export async function getManagedPages(userAccessToken: string): Promise<MetaPageAccount[]> {
  const url =
    `${GRAPH}/me/accounts?` +
    new URLSearchParams({
      fields: "id,name,access_token,instagram_business_account{id,username}",
      access_token: userAccessToken,
    });
  const payload = (await metaFetch(url, { method: "GET" }, "Meta page list")) as {
    data?: MetaPageAccount[];
  } & MetaErrorPayload;
  return payload.data ?? [];
}

/* --------------------------- Facebook Page video --------------------------- */

export interface FacebookVideoInput {
  /** Page access token (from /me/accounts), NOT the user token. */
  pageAccessToken: string;
  /** The target Page id — must equal META_TEST_PAGE_ID. */
  pageId: string;
  /** Publicly reachable HTTPS URL of the MP4 (Meta's servers fetch it). */
  videoUrl: string;
  title: string;
  description?: string | undefined;
  /**
   * ISO datetime for scheduled publishing. When set, the video is created
   * unpublished (published=false) with scheduled_publish_time. Must be at
   * least 10 minutes in the future and within 75 days (Meta enforces this).
   */
  scheduledFor?: string | null | undefined;
}

/**
 * Publishes a video to a Facebook Page via the file_url method.
 * TEST-ACCOUNT GATE: pageId must equal META_TEST_PAGE_ID or the call is
 * refused before any network I/O.
 */
export async function publishFacebookPageVideo(
  input: FacebookVideoInput,
): Promise<{ videoId: string }> {
  const { assertMetaTestAccountAllowed } = await import("./publishing-gates.server");
  assertMetaTestAccountAllowed("facebook", input.pageId);

  const params: Record<string, string | undefined> = {
    access_token: input.pageAccessToken,
    file_url: input.videoUrl,
    title: input.title.slice(0, 255),
    description: input.description?.slice(0, 5000),
  };
  if (input.scheduledFor) {
    const when = Date.parse(input.scheduledFor);
    if (!Number.isFinite(when) || when <= Date.now()) {
      throw new MetaApiError("scheduledFor must be a future datetime.", {
        code: "META_INVALID_SCHEDULE",
      });
    }
    params["published"] = "false";
    params["scheduled_publish_time"] = String(Math.floor(when / 1000));
  }
  const payload = (await postForm(
    `${GRAPH}/${input.pageId}/videos`,
    params,
    "Facebook Page video publish",
  )) as { id?: string } & MetaErrorPayload;
  if (!payload.id) throw new MetaApiError("Meta did not return a video id.");
  return { videoId: payload.id };
}

/**
 * Publishes a video to a Facebook Page from a Resumable Upload file handle
 * (for large files — start a session with startResumableUpload, transfer the
 * chunks, then publish with the returned handle).
 */
export async function publishFacebookVideoFromHandle(input: {
  pageAccessToken: string;
  pageId: string;
  fileHandle: string;
  title: string;
  description?: string | undefined;
}): Promise<{ videoId: string }> {
  const { assertMetaTestAccountAllowed } = await import("./publishing-gates.server");
  assertMetaTestAccountAllowed("facebook", input.pageId);
  const payload = (await postForm(
    `${GRAPH_VIDEO}/${input.pageId}/videos`,
    {
      access_token: input.pageAccessToken,
      fbuploader_video_file_chunk: input.fileHandle,
      title: input.title.slice(0, 255),
      description: input.description?.slice(0, 5000),
    },
    "Facebook Page video publish (upload handle)",
  )) as { id?: string } & MetaErrorPayload;
  if (!payload.id) throw new MetaApiError("Meta did not return a video id.");
  return { videoId: payload.id };
}

/**
 * Starts a Resumable Upload session for a large video file. Transfer chunks
 * to the session, then publish with publishFacebookVideoFromHandle.
 */
export async function startResumableUpload(input: {
  /** App-scoped token with upload permission (user or page token). */
  accessToken: string;
  fileName: string;
  fileLength: number;
  fileType: string;
}): Promise<{ uploadSessionId: string }> {
  const { appId } = metaCredentials();
  const payload = (await postForm(
    `${GRAPH}/${appId}/uploads`,
    {
      access_token: input.accessToken,
      file_name: input.fileName,
      file_length: String(input.fileLength),
      file_type: input.fileType,
    },
    "Meta resumable upload session",
  )) as { id?: string } & MetaErrorPayload;
  if (!payload.id) throw new MetaApiError("Meta did not return an upload session id.");
  return { uploadSessionId: payload.id };
}

/* ------------------------------ Instagram Reels ---------------------------- */

export interface InstagramReelInput {
  /**
   * Page access token for the Page linked to the IG account (IG publishing
   * uses the Page's token).
   */
  accessToken: string;
  /** The IG Business/Creator user id — must equal META_TEST_IG_USER_ID. */
  igUserId: string;
  /** Fully public HTTPS URL of the MP4 — Meta's servers fetch it. */
  videoUrl: string;
  /** Caption (max 2200 chars). */
  caption?: string | undefined;
  /** Public HTTPS URL of the cover image (optional). */
  coverUrl?: string | undefined;
}

type ContainerStatus = "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED" | "PUBLISHED";

const defaultSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Polls an IG media container until it reaches FINISHED. Throws on ERROR,
 * EXPIRED, or timeout — never publishes a half-processed container.
 */
export async function pollInstagramContainer(
  accessToken: string,
  containerId: string,
  opts?: {
    maxAttempts?: number | undefined;
    intervalMs?: number | undefined;
    sleep?: ((ms: number) => Promise<void>) | undefined;
  },
): Promise<void> {
  const maxAttempts = opts?.maxAttempts ?? 24; // ~2 min at 5s intervals
  const intervalMs = opts?.intervalMs ?? 5000;
  const sleep = opts?.sleep ?? defaultSleep;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const url =
      `${GRAPH}/${containerId}?` +
      new URLSearchParams({ fields: "status_code", access_token: accessToken });
    const payload = (await metaFetch(url, { method: "GET" }, "IG container status")) as {
      status_code?: ContainerStatus;
    } & MetaErrorPayload;
    const status = payload.status_code;
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED" || status === "PUBLISHED") {
      throw new MetaApiError(`IG container ${status.toLowerCase()} before publish.`, {
        code: `META_CONTAINER_${status}`,
      });
    }
    await sleep(intervalMs);
  }
  throw new MetaApiError("IG container did not finish processing in time.", {
    code: "META_CONTAINER_TIMEOUT",
  });
}

/**
 * Publishes a Reel to Instagram via the two-step container flow.
 * TEST-ACCOUNT GATE: igUserId must equal META_TEST_IG_USER_ID.
 */
export async function publishInstagramReel(
  input: InstagramReelInput,
  pollOpts?: { maxAttempts?: number | undefined; intervalMs?: number | undefined },
): Promise<{ mediaId: string; containerId: string }> {
  const { assertMetaTestAccountAllowed } = await import("./publishing-gates.server");
  assertMetaTestAccountAllowed("instagram", input.igUserId);

  if (input.caption && input.caption.length > 2200) {
    throw new MetaApiError("Instagram captions are limited to 2200 characters.", {
      code: "META_CAPTION_TOO_LONG",
    });
  }
  const container = (await postForm(
    `${GRAPH}/${input.igUserId}/media`,
    {
      access_token: input.accessToken,
      media_type: "REELS",
      video_url: input.videoUrl,
      caption: input.caption,
      share_to_feed: "true",
      cover_url: input.coverUrl,
    },
    "IG reel container",
  )) as { id?: string } & MetaErrorPayload;
  if (!container.id) throw new MetaApiError("Meta did not return a container id.");

  await pollInstagramContainer(input.accessToken, container.id, pollOpts);

  const published = (await postForm(
    `${GRAPH}/${input.igUserId}/media_publish`,
    { access_token: input.accessToken, creation_id: container.id },
    "IG media publish",
  )) as { id?: string } & MetaErrorPayload;
  if (!published.id) throw new MetaApiError("Meta did not return a media id.");
  return { mediaId: published.id, containerId: container.id };
}

/**
 * Reads the account's live publishing quota — the documented limit has
 * changed over time, so it is read at runtime, never hardcoded.
 */
export async function getInstagramPublishingLimit(
  accessToken: string,
  igUserId: string,
): Promise<{ quotaUsage: number | null; quotaTotal: number | null }> {
  const url =
    `${GRAPH}/${igUserId}/content_publishing_limit?` +
    new URLSearchParams({ fields: "quota_usage,config", access_token: accessToken });
  const payload = (await metaFetch(url, { method: "GET" }, "IG publishing limit")) as {
    quota_usage?: number;
    config?: { quota_total?: number };
  } & MetaErrorPayload;
  return {
    quotaUsage: typeof payload.quota_usage === "number" ? payload.quota_usage : null,
    quotaTotal: typeof payload.config?.quota_total === "number" ? payload.config.quota_total : null,
  };
}

/* ------------------------- stored video URL helper ------------------------- */

/**
 * Builds a short-lived public URL for the rendered MP4 so Meta's servers can
 * fetch it (file_url / video_url must be publicly reachable).
 */
export async function publicVideoUrl(
  admin: SupabaseClient<Database>,
  userId: string,
  videoJobId: string,
): Promise<string> {
  const path = `${userId}/${videoJobId}/video.mp4`;
  const { data, error } = await admin.storage
    .from("generated-videos")
    .createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new Error("The rendered video file is not available yet.");
  return data.signedUrl;
}
