/**
 * Complete Video Mode provider registry.
 * Deliberately inert: with no key configured nothing here makes a network call.
 */

export interface VideoProvider {
  id: string;
  label: string;
  envKey: string;
  configured(): boolean;
  generateClip(prompt: string, seconds: number): Promise<string>;
}

function notConfigured(label: string): never {
  throw new Error(`${label} is not configured — Complete Video Mode is still coming soon.`);
}

export const falProvider: VideoProvider = {
  id: "fal",
  label: "fal.ai",
  envKey: "FAL_API_KEY",
  configured: () => Boolean(process.env["FAL_API_KEY"]),
  async generateClip() {
    return notConfigured("fal.ai");
  },
};

export const VIDEO_PROVIDERS: VideoProvider[] = [falProvider];

export function videoModeAvailable(): boolean {
  return VIDEO_PROVIDERS.some((p) => p.configured());
}
