import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyCheckError, probeElevenLabsUser } from "./status.functions";

describe("classifyCheckError", () => {
  it("maps not_configured: prefix", () => {
    expect(classifyCheckError("not_configured:ELEVENLABS_API_KEY is not set")).toEqual({
      status: "not_configured",
      detail: "ELEVENLABS_API_KEY is not set",
    });
  });

  it("maps degraded: prefix", () => {
    expect(classifyCheckError("degraded:account probe returned 401")).toEqual({
      status: "degraded",
      detail: "account probe returned 401",
    });
  });

  it("maps anything else to down", () => {
    expect(classifyCheckError("ElevenLabs returned 500")).toEqual({
      status: "down",
      detail: "ElevenLabs returned 500",
    });
  });
});

describe("probeElevenLabsUser", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports 401 as a degraded error, not down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    await expect(
      probeElevenLabsUser("restricted-key", new AbortController().signal),
    ).rejects.toThrow(/^degraded:account probe returned 401/);
  });

  it("reports other failures as down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    await expect(
      probeElevenLabsUser("key", new AbortController().signal),
    ).rejects.toThrow("ElevenLabs returned 500");
  });

  it("passes on 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    );
    await expect(probeElevenLabsUser("key", new AbortController().signal)).resolves.toBe(
      "ElevenLabs reachable",
    );
  });
});
