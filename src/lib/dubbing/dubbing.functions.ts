import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "../server-auth";
import { createPublicSupabase } from "../public.server";
import {
  resolveDubLanguage,
  selectDubVoice,
  betaLabel,
  quoteDubbing,
  type LanguageRow,
  type LanguageVoiceSlot,
} from "./dubbing";

/**
 * Languages available for dubbing, with per-language voice readiness.
 *
 * Public data (languages + language_voices are public-read tables): the
 * quote UI is visible to any visitor; only queueing requires credits.
 * Every row carries the honest Beta label and whether a verified voice
 * exists — the UI must show both.
 */
export const listDubLanguages = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = createPublicSupabase();
  const [{ data: languages, error: langError }, { data: slots, error: slotError }] =
    await Promise.all([
      supabase
        .from("languages")
        .select("code, name_en, name_native, status, caption_max_chars, rtl, font_stack")
        .order("code"),
      supabase
        .from("language_voices")
        .select("language_code, name, provider, provider_voice_id, verified, selectable"),
    ]);
  if (langError) throw new Error(langError.message);
  if (slotError) throw new Error(slotError.message);

  const rows: LanguageRow[] = (languages ?? []).map((l) => ({
    code: l.code,
    nameEn: l.name_en,
    nameNative: l.name_native,
    status: l.status as LanguageRow["status"],
    captionMaxChars: l.caption_max_chars,
    rtl: l.rtl,
    fontStack: l.font_stack,
  }));
  const voiceSlots: LanguageVoiceSlot[] = (slots ?? []).map((s) => ({
    languageCode: s.language_code,
    name: s.name,
    provider: s.provider as LanguageVoiceSlot["provider"],
    providerVoiceId: s.provider_voice_id,
    verified: s.verified,
    selectable: s.selectable,
  }));

  return rows.map((language) => {
    let verifiedVoices = 0;
    try {
      selectDubVoice(language.code, { voiceSlots });
      verifiedVoices = voiceSlots.filter(
        (s) => s.languageCode === language.code && s.verified && s.providerVoiceId,
      ).length;
    } catch {
      verifiedVoices = 0;
    }
    return {
      code: language.code,
      nameEn: language.nameEn,
      nameNative: language.nameNative,
      status: language.status,
      beta: betaLabel(language.status),
      canDub: verifiedVoices > 0,
      verifiedVoices,
      captionMaxChars: language.captionMaxChars,
    };
  });
});

/**
 * Exact dub quote for a finished render + language codes. Pure pricing over
 * the validated language rows — the same numbers planDubRender would use.
 * Shown BEFORE enqueue; no credits move here.
 */
export const quoteDubRender = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        renderId: z.string().uuid(),
        languages: z.array(z.string().max(10)).min(1).max(11),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: render, error } = await supabase
      .from("renders")
      .select("id, duration, project_id")
      .eq("id", data.renderId)
      .eq("user_id", userId)
      .eq("status", "completed")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!render) throw new Error("Completed render not found");

    // Validate every code against the languages table — unknown codes fail
    // the whole quote instead of silently mapping to another language.
    const languages = (await createPublicSupabase()
      .from("languages")
      .select("code, name_en, name_native, status, caption_max_chars, rtl, font_stack")
      .in("code", data.languages)) as {
      data: Array<{
        code: string;
        name_en: string;
        name_native: string;
        status: string;
        caption_max_chars: number;
        rtl: boolean;
        font_stack: string;
      }> | null;
    };
    const rows: LanguageRow[] = (languages.data ?? []).map((l) => ({
      code: l.code,
      nameEn: l.name_en,
      nameNative: l.name_native,
      status: l.status as LanguageRow["status"],
      captionMaxChars: l.caption_max_chars,
      rtl: l.rtl,
      fontStack: l.font_stack,
    }));
    const validated = data.languages.map((code) => resolveDubLanguage(code, rows));

    const durationSeconds = Number(render.duration) || 0;
    const quote = quoteDubbing(durationSeconds, validated.length);
    return {
      renderId: render.id,
      minutes: quote.minutes,
      credits: quote.credits,
      languages: validated.map((l) => ({
        code: l.code,
        nameEn: l.nameEn,
        beta: betaLabel(l.status),
      })),
    };
  });
