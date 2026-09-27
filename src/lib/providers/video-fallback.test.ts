import { afterEach, describe, expect, it, vi } from "vitest";
import { generateVideoWithFallback, resolveVideoChain, type VideoProvider } from "./video.server";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function fakeProvider(id: string, calls: string[], behavior: () => Promise<string>): VideoProvider {
  return {
    id,
    label: `Fake ${id}`,
    envKey: `FAKE_${id}`,
    configured: () => true,
    generateClip: async (prompt: string, seconds: number) => {
      calls.push(`${id}:${prompt}:${seconds}`);
      return behavior();
    },
  };
}

describe("generateVideoWithFallback", () => {
  it("primary fails -> fallback succeeds, exactly one attempt per provider", async () => {
    const calls: string[] = [];
    const primary = fakeProvider("fake-primary", calls, async () => {
      throw new Error("primary exploded");
    });
    const fallback = fakeProvider(
      "fake-fallback",
      calls,
      async () => "https://cdn.example/clip.mp4",
    );

    const result = await generateVideoWithFallback("a cat", 5, {
      providers: [primary, fallback],
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("ok");
    expect(result.output).toBe("https://cdn.example/clip.mp4");
    expect(result.usage).toMatchObject({ seconds: 5 });
    // No blind retry: each provider attempted exactly once.
    expect(calls).toEqual(["fake-primary:a cat:5", "fake-fallback:a cat:5"]);
  });

  it("primary success -> fallback never attempted", async () => {
    const calls: string[] = [];
    const primary = fakeProvider("fake-primary", calls, async () => "https://cdn.example/ok.mp4");
    const fallback = fakeProvider(
      "fake-fallback",
      calls,
      async () => "https://cdn.example/other.mp4",
    );

    const result = await generateVideoWithFallback("a dog", 4, {
      providers: [primary, fallback],
    });

    expect(result.ok).toBe(true);
    expect(result.output).toBe("https://cdn.example/ok.mp4");
    expect(calls).toEqual(["fake-primary:a dog:4"]);
  });

  it("all providers fail -> honest error envelope, no blind retry", async () => {
    const calls: string[] = [];
    const primary = fakeProvider("p1", calls, async () => {
      throw new Error("first down");
    });
    const fallback = fakeProvider("p2", calls, async () => {
      throw new Error("second down");
    });

    const result = await generateVideoWithFallback("x", 3, {
      providers: [primary, fallback],
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("error");
    expect(result.output).toBeNull();
    // Honest: the last provider's failure is reported.
    expect(result.error?.message).toContain("second down");
    expect(calls).toEqual(["p1:x:3", "p2:x:3"]);
  });

  it("empty chain -> honest unconfigured envelope", async () => {
    const result = await generateVideoWithFallback("x", 3, { providers: [] });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("unconfigured");
    expect(result.error?.code).toBe("unconfigured");
    expect(result.output).toBeNull();
  });

  it("env fallback id names a registered adapter; unknown ids are ignored", async () => {
    vi.stubEnv("FAL_API_KEY", "");
    vi.stubEnv("VIDEO_FALLBACK_PROVIDER", "definitely-not-registered");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const chain = resolveVideoChain();
    expect(chain.map((p) => p.id)).toEqual(["fal"]);
    expect(warn).toHaveBeenCalled();

    // fal unconfigured + unknown fallback -> honest unconfigured envelope
    const result = await generateVideoWithFallback("x", 3);
    expect(result.ok).toBe(false);
    expect(result.status).toBe("unconfigured");
  });

  it("env fallback naming fal keeps a single-entry chain (no duplicate attempt)", async () => {
    vi.stubEnv("VIDEO_FALLBACK_PROVIDER", "fal");
    const chain = resolveVideoChain();
    expect(chain.filter((p) => p.id === "fal")).toHaveLength(1);
  });
});
