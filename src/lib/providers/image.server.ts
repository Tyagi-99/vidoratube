import { providerFetch } from "./http.server";
import { withProviderTelemetry } from "./telemetry.server";
import type { ProviderResult } from "./contracts";
import type { CostCtx } from "../api-cost";
import { GATEWAY_IMAGE_USD_PER_IMAGE } from "../api-cost";

export type ImageRequest = {
  prompt: string;
  negativePrompt?: string | undefined;
  aspectRatio: string;
};

export interface ImageProvider {
  id: string;
  label: string;
  configured(): boolean;
  generate(req: ImageRequest): Promise<Uint8Array>;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Default image provider — Lovable AI gateway (Gemini image), no extra key needed. */
export const geminiImage: ImageProvider = {
  id: "gemini",
  label: "Lovable AI (Gemini image)",
  configured: () => Boolean(process.env["LOVABLE_API_KEY"]),
  async generate({ prompt, negativePrompt, aspectRatio }) {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("AI image generation is not configured.");
    const full = [
      prompt,
      `Aspect ratio ${aspectRatio}.`,
      negativePrompt ? `Avoid: ${negativePrompt}.` : "",
      "Do not render any text, captions, watermarks or logos.",
    ]
      .filter(Boolean)
      .join(" ");

    const res = await providerFetch(
      "Lovable AI",
      "https://ai.gateway.lovable.dev/v1/images/generations",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-image",
          messages: [{ role: "user", content: full }],
          modalities: ["image", "text"],
        }),
        timeoutMs: 180_000,
      },
    );

    const payload = (await res.json()) as { data?: { b64_json?: string }[] };
    const b64 = payload.data?.[0]?.b64_json;
    if (!b64) throw new Error("The image provider returned no image.");
    return base64ToBytes(b64);
  },
};

export const IMAGE_PROVIDERS: ImageProvider[] = [geminiImage];

export function activeImageProvider(): ImageProvider {
  return IMAGE_PROVIDERS.find((p) => p.configured()) ?? geminiImage;
}

export type ImageTelemetryOptions = {
  /** When set and the call succeeds, one row is recorded to api_usage. */
  costCtx?: CostCtx | null | undefined;
  /** Extra fields merged into the api_usage row's meta. */
  meta?: Record<string, unknown> | undefined;
};

/**
 * Telemetry-wrapped image generation: same output as the active provider's
 * `generate`, but the result flows through the standard
 * {@link ProviderResult} envelope and the measured cost (model / latency) is
 * recorded to api_usage. Existing callers of `generate` are untouched.
 */
export async function generateImageWithTelemetry(
  req: ImageRequest,
  opts: ImageTelemetryOptions = {},
): Promise<ProviderResult<Uint8Array>> {
  const provider = activeImageProvider();
  return withProviderTelemetry(() => provider.generate(req), {
    provider: provider.id,
    operation: "image_generation",
    model: "google/gemini-2.5-flash-image",
    configured: provider.configured(),
    estimate: { units: 1, unitCostUsd: GATEWAY_IMAGE_USD_PER_IMAGE },
    usage: { images: 1 },
    meta: { cost_basis: "gateway-passthrough-estimate", ...(opts.meta ?? {}) },
    costCtx: opts.costCtx ?? null,
  });
}
