/**
 * Real transcription backend: ElevenLabs Scribe (speech-to-text).
 *
 * Reuses the existing ELEVENLABS_API_KEY (same key + xi-api-key header as the
 * TTS adapter in voice.server.ts). Scribe accepts an audio file upload and
 * returns word-level timestamps.
 *
 * Honesty rules: configured() is false when the key is absent, and every
 * transcribe() call then returns the `status: "unconfigured"` envelope —
 * never a fabricated transcript.
 */
import type {
  ProviderResult,
  TranscriptionProvider,
  TranscriptResult,
  TranscriptWord,
} from "./contracts";
import { providerFetch } from "./http.server";
import { withProviderTelemetry } from "./telemetry.server";

const STT_ENDPOINT = "https://api.elevenlabs.io/v1/speech-to-text";
const STT_MODEL = "scribe_v2";

export function elevenLabsSttConfigured(): boolean {
  return Boolean(process.env["ELEVENLABS_API_KEY"]);
}

function apiKey(): string {
  const key = process.env["ELEVENLABS_API_KEY"];
  if (!key) {
    throw new Error("ElevenLabs is not configured. Add your API key in Settings → Providers.");
  }
  return key;
}

type ScribeWord = {
  text?: unknown;
  type?: unknown;
  start?: unknown;
  end?: unknown;
};

type ScribeResponse = {
  text?: unknown;
  words?: ScribeWord[];
};

/** Downloads the audio (a short-lived signed URL works) as raw bytes. */
async function fetchAudioBytes(audioUrl: string): Promise<Uint8Array> {
  const res = await providerFetch("ElevenLabs-STT", audioUrl, {
    timeoutMs: 120_000,
  });
  return new Uint8Array(await res.arrayBuffer());
}

async function transcribeAudio(audioUrl: string): Promise<TranscriptResult> {
  const bytes = await fetchAudioBytes(audioUrl);

  const form = new FormData();
  // Copy into a fresh ArrayBuffer-backed view: BlobPart typing rejects the
  // generic ArrayBufferLike view returned by arrayBuffer().
  const audioCopy = Uint8Array.from(bytes);
  form.append("file", new Blob([audioCopy.buffer], { type: "audio/mpeg" }), "audio.mp3");
  form.append("model_id", STT_MODEL);
  // language_code intentionally omitted: Scribe auto-detects (the product
  // narrates in English and Hindi). timestamps_granularity=word gives the
  // word-level timings the contract promises.
  form.append("timestamps_granularity", "word");

  const res = await providerFetch("ElevenLabs-STT", STT_ENDPOINT, {
    method: "POST",
    headers: { "xi-api-key": apiKey() },
    body: form,
    timeoutMs: 300_000,
  });

  const payload = (await res.json()) as ScribeResponse;
  const rawWords = Array.isArray(payload.words) ? payload.words : [];
  const words: TranscriptWord[] = [];
  for (const w of rawWords) {
    if (w.type !== undefined && w.type !== "word") continue; // skip spacing/audio_event entries
    const text = typeof w.text === "string" ? w.text : "";
    const start = typeof w.start === "number" ? w.start : NaN;
    const end = typeof w.end === "number" ? w.end : NaN;
    if (!text || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    words.push({ start, end, text });
  }
  const text = typeof payload.text === "string" ? payload.text : "";
  return { text, words };
}

export const elevenLabsTranscription: TranscriptionProvider = {
  id: "elevenlabs-stt",
  label: "ElevenLabs Speech-to-Text (Scribe)",
  configured: elevenLabsSttConfigured,
  async transcribe(audioUrl: string): Promise<ProviderResult<TranscriptResult>> {
    return withProviderTelemetry(() => transcribeAudio(audioUrl), {
      provider: "elevenlabs",
      operation: "speech_to_text",
      model: STT_MODEL,
      configured: elevenLabsSttConfigured(),
      // Scribe is billed per audio-second; the exact list price moves, so no
      // fabricated estimate — the envelope carries measured usage instead.
      usage: {},
      meta: { cost_basis: "provider-billed-see-elevenlabs-pricing" },
    });
  },
};
