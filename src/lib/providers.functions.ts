import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "./server-auth";
import { assertAdmin } from "./admin.server";

/** Provider configuration status — admin only: never returns a key, only a masked hint. */
export const getProviderStatus = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { maskKey } = await import("./providers/http.server");
    const { videoModeAvailable } = await import("./providers/video.server");
    const entry = (id: string, label: string, env: string, note: string) => ({
      id,
      label,
      env,
      note,
      configured: Boolean(process.env[env]),
      masked: maskKey(process.env[env]),
    });

    return {
      providers: [
        entry("elevenlabs", "ElevenLabs (voice)", "ELEVENLABS_API_KEY", "Required for narration in every mode."),
        entry("pexels", "Pexels (stock)", "PEXELS_API_KEY", "Primary free stock photos and video."),
        entry("pixabay", "Pixabay (stock)", "PIXABAY_API_KEY", "Fallback free stock provider."),
        {
          id: "image",
          label: "Image generation (Lovable AI)",
          env: "LOVABLE_API_KEY",
          note: "Built in — used for AI Image Mode and stock fallbacks.",
          configured: Boolean(process.env["LOVABLE_API_KEY"]),
          masked: null,
        },
        {
          id: "fal",
          label: "Complete Video Mode",
          env: "FAL_API_KEY",
          note: videoModeAvailable() ? "Configured." : "Coming soon — no provider key yet.",
          configured: videoModeAvailable(),
          masked: maskKey(process.env["FAL_API_KEY"]),
        },
      ],
    };
  });

export const listElevenLabsVoices = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { elevenLabsConfigured, listVoices } = await import("./providers/voice.server");
    if (!elevenLabsConfigured()) return { configured: false, voices: [] as { id: string; name: string }[] };
    try {
      return { configured: true, voices: await listVoices() };
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Could not reach ElevenLabs");
    }
  });

/** Fires one tiny live request per provider so key problems surface immediately. */
export const testProvider = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        provider: z.enum(["elevenlabs", "pexels", "pixabay", "image", "fal"]),
        voiceId: z.string().max(80).optional(),
        model: z.string().max(60).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    try {
      if (data.provider === "pexels" || data.provider === "pixabay") {
        const { pexels, pixabay } = await import("./providers/stock.server");
        const provider = data.provider === "pexels" ? pexels : pixabay;
        if (!provider.configured()) return { ok: false, message: "Provider not configured." };
        const results = await provider.search("mountain landscape", "photo", 3);
        return { ok: true, message: `${results.length} results returned.` };
      }

      if (data.provider === "elevenlabs") {
        const { elevenLabsConfigured, synthesize, DEFAULT_VOICE_ID, DEFAULT_VOICE_MODEL } = await import(
          "./providers/voice.server"
        );
        if (!elevenLabsConfigured()) return { ok: false, message: "Provider not configured." };
        const audio = await synthesize("Vidora voice test.", {
          voiceId: data.voiceId || DEFAULT_VOICE_ID,
          model: data.model || DEFAULT_VOICE_MODEL,
        });
        const b64 = btoa(String.fromCharCode(...new Uint8Array(audio.slice(0, audio.byteLength))));
        return { ok: true, message: "Voice generated.", audio: `data:audio/mpeg;base64,${b64}` };
      }

      if (data.provider === "image") {
        const { activeImageProvider } = await import("./providers/image.server");
        const provider = activeImageProvider();
        if (!provider.configured()) return { ok: false, message: "Provider not configured." };
        return { ok: true, message: `${provider.label} is ready.` };
      }

      const { videoModeAvailable } = await import("./providers/video.server");
      return videoModeAvailable()
        ? { ok: true, message: "Video provider configured." }
        : { ok: false, message: "Complete Video Mode is coming soon — no provider key configured." };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Test failed" };
    }
  });
