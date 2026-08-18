import { providerFetch } from "./http.server";

export type VoiceOption = { id: string; name: string; category?: string | undefined };

export type VoiceSettings = {
  voiceId: string;
  model: string;
  stability?: number;
  similarity?: number;
  style?: number;
  speed?: number;
};

export const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"; // George
export const DEFAULT_VOICE_MODEL = "eleven_flash_v2_5";

export function elevenLabsConfigured(): boolean {
  return Boolean(process.env["ELEVENLABS_API_KEY"]);
}

function key(): string {
  const k = process.env["ELEVENLABS_API_KEY"];
  if (!k) throw new Error("ElevenLabs is not configured. Add your API key in Settings → Providers.");
  return k;
}

export async function listVoices(): Promise<VoiceOption[]> {
  const res = await providerFetch("ElevenLabs", "https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": key() },
  });
  const json = (await res.json()) as { voices?: { voice_id: string; name: string; category?: string }[] };
  return (json.voices ?? []).map((v) => ({ id: v.voice_id, name: v.name, category: v.category }));
}

/** Generates MP3 narration for one chunk of text. */
export async function synthesize(text: string, settings: VoiceSettings): Promise<ArrayBuffer> {
  const res = await providerFetch(
    "ElevenLabs",
    `https://api.elevenlabs.io/v1/text-to-speech/${settings.voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key(), "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: settings.model || DEFAULT_VOICE_MODEL,
        voice_settings: {
          stability: settings.stability ?? 0.55,
          similarity_boost: settings.similarity ?? 0.75,
          style: settings.style ?? 0.25,
          use_speaker_boost: true,
          speed: settings.speed ?? 1,
        },
      }),
      timeoutMs: 120_000,
    },
  );
  return res.arrayBuffer();
}

/**
 * Reads the real playback duration out of the MP3 frame headers.
 * Falls back to a words-per-minute estimate if the stream can't be parsed.
 */
export function mp3Duration(buffer: ArrayBuffer, fallbackText: string): number {
  try {
    const bytes = new Uint8Array(buffer);
    const bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
    const rates = [44100, 48000, 32000, 0];
    let i = 0;
    let seconds = 0;
    let guard = 0;

    while (i < bytes.length - 4 && guard < 400_000) {
      guard++;
      if (bytes[i] === 0xff && (bytes[i + 1]! & 0xe0) === 0xe0) {
        const bitrate = bitrates[(bytes[i + 2]! & 0xf0) >> 4]!;
        const rate = rates[(bytes[i + 2]! & 0x0c) >> 2]!;
        const padding = (bytes[i + 2]! & 0x02) >> 1;
        if (!bitrate || !rate) {
          i++;
          continue;
        }
        const frameLength = Math.floor((144000 * bitrate) / rate) + padding;
        seconds += 1152 / rate;
        i += Math.max(4, frameLength);
      } else {
        i++;
      }
    }
    if (seconds > 0.5) return Math.round(seconds * 10) / 10;
  } catch {
    /* fall through to the estimate */
  }
  const words = fallbackText.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(3, Math.round((words / 150) * 60));
}
