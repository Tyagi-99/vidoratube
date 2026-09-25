/**
 * Registry that wraps existing Vidora adapters behind the P0 contracts.
 * Does not change runtime behavior of studio/jobs — only exposes a stable surface.
 */
import type { ImageProvider } from "./image.server";
import { IMAGE_PROVIDERS, activeImageProvider, geminiImage } from "./image.server";
import type { StockProvider } from "./stock.server";
import { STOCK_PROVIDERS, findBestStockAsset, pexels, pixabay } from "./stock.server";
import {
  DEFAULT_VOICE_ID,
  DEFAULT_VOICE_MODEL,
  elevenLabsConfigured,
  listVoices,
  synthesize,
} from "./voice.server";
import { falProvider, videoModeAvailable } from "./video.server";
import type {
  MetadataProvider,
  PublishingProvider,
  SearchProvider,
  StorageProvider,
  TranscriptionProvider,
  VideoSourceProvider,
  VoiceProvider,
  ProviderHealth,
} from "./contracts";
import { youtubeConfigured } from "../youtube.server";

/** Stock adapters already implement a focused interface — re-export as catalog. */
export const stockAdapters: StockProvider[] = STOCK_PROVIDERS;

export const imageAdapters: ImageProvider[] = IMAGE_PROVIDERS;

export const voiceAdapter: VoiceProvider = {
  id: "elevenlabs",
  label: "ElevenLabs",
  configured: elevenLabsConfigured,
  synthesize: (text, voiceId, model) =>
    synthesize(text, {
      voiceId: voiceId || DEFAULT_VOICE_ID,
      model: model || DEFAULT_VOICE_MODEL,
    }),
};

/** v1 video source policy: no YouTube download. Stock + uploads only. */
export const compliantVideoSource: VideoSourceProvider = {
  id: "compliant-v1",
  label: "User upload or approved stock (no YouTube download)",
  configured: () => true,
  supportsYouTubeDownload: false,
};

/** Placeholder until YouTube Data API metadata adapter lands in P1. */
export const youtubeMetadataStub: MetadataProvider = {
  id: "youtube-data-api",
  label: "YouTube Data API (metadata only)",
  configured: () => false,
  async resolve(_canonicalUrl) {
    // P1 will implement official metadata fetch. Stub returns null (no invented metrics).
    return null;
  },
};

export const youtubeSearchStub: SearchProvider = {
  id: "youtube-search",
  label: "YouTube search (official API)",
  configured: () => false,
  async search() {
    return [];
  },
};

export const transcriptionStub: TranscriptionProvider = {
  id: "transcription-stub",
  label: "Transcription (not configured)",
  configured: () => false,
  async transcribe() {
    throw new Error("TranscriptionProvider is not configured in v1 foundation.");
  },
};

export const storageStub: StorageProvider = {
  id: "supabase-storage",
  label: "Supabase Storage",
  configured: () => Boolean(process.env["SUPABASE_URL"] && process.env["SUPABASE_SERVICE_ROLE_KEY"]),
  async createSignedUrl() {
    throw new Error("StorageProvider.createSignedUrl not wired in PR1 — use existing upload helpers.");
  },
};

export const youtubePublishing: PublishingProvider = {
  id: "youtube-upload",
  label: "YouTube upload",
  configured: youtubeConfigured,
};

export function providerHealthSnapshot(): ProviderHealth[] {
  return [
    { id: pexels.id, label: "Pexels", configured: pexels.configured() },
    { id: pixabay.id, label: "Pixabay", configured: pixabay.configured() },
    { id: geminiImage.id, label: geminiImage.label, configured: geminiImage.configured() },
    { id: voiceAdapter.id, label: voiceAdapter.label, configured: voiceAdapter.configured() },
    { id: falProvider.id, label: "FAL video", configured: falProvider.configured() },
    {
      id: youtubeMetadataStub.id,
      label: youtubeMetadataStub.label,
      configured: youtubeMetadataStub.configured(),
    },
    { id: youtubePublishing.id, label: youtubePublishing.label, configured: youtubePublishing.configured() },
    {
      id: transcriptionStub.id,
      label: transcriptionStub.label,
      configured: transcriptionStub.configured(),
    },
    { id: storageStub.id, label: storageStub.label, configured: storageStub.configured() },
    {
      id: compliantVideoSource.id,
      label: compliantVideoSource.label,
      configured: compliantVideoSource.configured(),
    },
  ];
}

export {
  findBestStockAsset,
  activeImageProvider,
  listVoices,
  videoModeAvailable,
};
