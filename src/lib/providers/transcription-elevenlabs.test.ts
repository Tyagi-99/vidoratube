import { afterEach, describe, expect, it, vi } from "vitest";
import {
  elevenLabsSttConfigured,
  elevenLabsTranscription,
} from "./transcription-elevenlabs.server";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const AUDIO_URL = "https://example.com/audio.mp3";

function mockFetch(okImpl: (url: string) => Response) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : String(input);
    return okImpl(url);
  });
}

function okResponse(body: {
  json?: () => Promise<unknown>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
}): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => "",
    json: body.json ?? (async () => ({})),
    arrayBuffer: body.arrayBuffer ?? (async () => new ArrayBuffer(0)),
  } as unknown as Response;
}

describe("elevenLabsTranscription", () => {
  it("configured() is false when ELEVENLABS_API_KEY is absent", () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    expect(elevenLabsSttConfigured()).toBe(false);
    expect(elevenLabsTranscription.configured()).toBe(false);
  });

  it("unconfigured transcribe() returns the honest envelope and makes no network call", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    const fetchSpy = mockFetch(() => okResponse({}));

    const result = await elevenLabsTranscription.transcribe(AUDIO_URL);

    expect(result.ok).toBe(false);
    expect(result.status).toBe("unconfigured");
    expect(result.output).toBeNull();
    expect(result.error?.code).toBe("unconfigured");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("transcribes via Scribe and maps word timestamps (mocked fetch)", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    expect(elevenLabsTranscription.configured()).toBe(true);

    const seen: string[] = [];
    mockFetch((url) => {
      seen.push(url);
      if (url === AUDIO_URL) return okResponse({ arrayBuffer: async () => new ArrayBuffer(16) });
      return okResponse({
        json: async () => ({
          text: "hello world",
          words: [
            { text: "hello", type: "word", start: 0.0, end: 0.5 },
            { text: " ", type: "spacing", start: 0.5, end: 0.5 },
            { text: "world", type: "word", start: 0.6, end: 1.0 },
            { text: "junk", type: "word", start: "bad", end: 1.2 },
          ],
        }),
      });
    });

    const result = await elevenLabsTranscription.transcribe(AUDIO_URL);

    expect(result.ok).toBe(true);
    expect(result.status).toBe("ok");
    expect(result.model).toBe("scribe_v2");
    expect(result.output?.text).toBe("hello world");
    // spacing entries and malformed entries are filtered out
    expect(result.output?.words).toEqual([
      { start: 0, end: 0.5, text: "hello" },
      { start: 0.6, end: 1, text: "world" },
    ]);
    // audio downloaded, then the Scribe call
    expect(seen).toEqual([AUDIO_URL, "https://api.elevenlabs.io/v1/speech-to-text"]);
  });

  it("API failure surfaces as an error envelope, never a fake transcript", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    mockFetch((url) => {
      if (url === AUDIO_URL) return okResponse({ arrayBuffer: async () => new ArrayBuffer(16) });
      return {
        ok: false,
        status: 401,
        headers: new Headers(),
        text: async () => "invalid key",
      } as unknown as Response;
    });

    const result = await elevenLabsTranscription.transcribe(AUDIO_URL);

    expect(result.ok).toBe(false);
    expect(result.status).toBe("error");
    expect(result.output).toBeNull();
    expect(result.error?.code).toBe("auth");
  });
});
