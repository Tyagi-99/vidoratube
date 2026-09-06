/**
 * Provider abstractions for Vidora's rights-aware workflow.
 * Existing adapters (stock / image / voice / youtube) should implement or wrap these.
 * VideoSourceProvider must NEVER download YouTube in v1 — only uploads + approved stock.
 */

export type ProviderHealth = {
  id: string;
  label: string;
  configured: boolean;
};

export type ContentMetadata = {
  platform: string;
  platformId: string | null;
  canonicalUrl: string;
  title: string | null;
  description: string | null;
  creatorName: string | null;
  creatorProfileUrl: string | null;
  uploadedAt: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  language: string | null;
  tags: string[];
  /** Raw provider payload facts — never invent metrics */
  metrics: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    followers: number | null;
  };
  raw: unknown;
};

/** Official/public metadata lookup (YouTube Data API first). */
export interface MetadataProvider {
  id: string;
  label: string;
  configured(): boolean;
  resolve(canonicalUrl: string): Promise<ContentMetadata | null>;
}

/** Discovery / search across platforms that allow official APIs. */
export interface SearchProvider {
  id: string;
  label: string;
  configured(): boolean;
  search(query: string, options?: { maxResults?: number }): Promise<ContentMetadata[]>;
}

export type AcquiredAsset = {
  origin: "user_upload" | "stock" | "generated";
  provider: string;
  storagePath: string | null;
  sourceUrl: string | null;
  mimeType: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  rightsBasis: string;
};

/**
 * Compliant asset intake only.
 * v1: user-uploaded owned/licensed files or approved stock — not YouTube downloads.
 */
export interface VideoSourceProvider {
  id: string;
  label: string;
  configured(): boolean;
  /** Explicit capability flag so callers never assume download support */
  supportsYouTubeDownload: false;
}

export interface LLMProvider {
  id: string;
  label: string;
  configured(): boolean;
  completeJson<T>(system: string, user: string): Promise<T>;
}

export interface VoiceProvider {
  id: string;
  label: string;
  configured(): boolean;
  synthesize(text: string, voiceId: string, model?: string): Promise<ArrayBuffer>;
}

export interface TranscriptionProvider {
  id: string;
  label: string;
  configured(): boolean;
  /** Stub until a real transcription backend is wired */
  transcribe(_audioUrl: string): Promise<{ words: { start: number; end: number; text: string }[] }>;
}

export interface StorageProvider {
  id: string;
  label: string;
  configured(): boolean;
  /** Return a short-lived access URL for a private storage path */
  createSignedUrl(path: string, expiresInSeconds: number): Promise<string>;
}

export interface PublishingProvider {
  id: string;
  label: string;
  configured(): boolean;
}
