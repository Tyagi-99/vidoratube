/**
 * P4 voice catalog — 10 built-in voices (English-first ordering), plus
 * runtime-resolved library voices.
 *
 * Built-in voices use verified provider IDs already in the codebase.
 * Entries marked `library: true` are resolved at runtime via ElevenLabs
 * listVoices() (requires ELEVENLABS_API_KEY) — their IDs are NOT hardcoded
 * here because library contents vary per account.
 *
 * Vidora is language-neutral: English is the default. Language behaviour
 * (fonts, RTL, caption rules, LLM instructions) comes from the `languages`
 * table, never from hardcoded branches in components.
 */

export type VoiceProvider = "elevenlabs" | "gateway";

export interface CatalogVoice {
  /** Stable Vidora voice id used in project settings / scene overrides. */
  id: string;
  name: string;
  nameHi?: string;
  language: string; // "Hindi" | "English" | ...
  languageCode: string; // "hi" | "en" | ...
  gender: "masculine" | "feminine" | "neutral";
  provider: VoiceProvider;
  /** Concrete provider voice id. Null = resolved at runtime via library. */
  providerVoiceId: string | null;
  /** True when the voice comes from the user's ElevenLabs library. */
  library?: boolean;
  /**
   * False = BETA placeholder: provider id unverified, must NOT appear in the
   * UI picker. Undefined/true = user-selectable (see userSelectableVoices).
   */
  selectable?: boolean;
  description: string;
}

export const VOICE_CATALOG: CatalogVoice[] = [
  // ---- English built-ins (12): depth first ----
  {
    id: "george",
    name: "George",
    language: "English",
    languageCode: "en",
    gender: "masculine",
    provider: "elevenlabs",
    providerVoiceId: "JBFqnCBsd6RMkjVDRZzb",
    description: "Default English narrator, warm and clear",
  },
  {
    id: "sarah",
    name: "Sarah",
    language: "English",
    languageCode: "en",
    gender: "feminine",
    provider: "elevenlabs",
    providerVoiceId: "EXAVITQu4vr4xnSDxMaL",
    description: "Expressive English voice, great for stories",
  },
  {
    id: "rachel",
    name: "Rachel",
    language: "English",
    languageCode: "en",
    gender: "feminine",
    provider: "elevenlabs",
    providerVoiceId: "21m00Tcm4TlvDq8ikWAM",
    description: "Warm English narrator, documentary tone",
  },
  {
    id: "domi",
    name: "Domi",
    language: "English",
    languageCode: "en",
    gender: "feminine",
    provider: "elevenlabs",
    providerVoiceId: "AZnzlk1XvdvUeBnXmlld",
    description: "Expressive English voice, strong presence",
  },
  {
    id: "elli",
    name: "Elli",
    language: "English",
    languageCode: "en",
    gender: "feminine",
    provider: "elevenlabs",
    providerVoiceId: "MF3mGyEYCl7XYWb3QV9V",
    description: "Bright English voice, energetic hosting",
  },
  {
    id: "josh",
    name: "Josh",
    language: "English",
    languageCode: "en",
    gender: "masculine",
    provider: "elevenlabs",
    providerVoiceId: "TxGEqnHWrfWFTfGW9XjX",
    description: "Conversational English voice, natural pacing",
  },
  {
    id: "arnold",
    name: "Arnold",
    language: "English",
    languageCode: "en",
    gender: "masculine",
    provider: "elevenlabs",
    providerVoiceId: "VR6AewLTigWG4xSOukaG",
    description: "Deep English voice, documentary gravity",
  },
  {
    id: "antoni",
    name: "Antoni",
    language: "English",
    languageCode: "en",
    gender: "masculine",
    provider: "elevenlabs",
    providerVoiceId: "ErXwobaYiN019PkySvjV",
    description: "Calm English voice, sleep and stories",
  },
  {
    id: "alloy",
    name: "Alloy",
    language: "English",
    languageCode: "en",
    gender: "neutral",
    provider: "gateway",
    providerVoiceId: "alloy",
    description: "Balanced gateway voice",
  },
  {
    id: "echo",
    name: "Echo",
    language: "English",
    languageCode: "en",
    gender: "masculine",
    provider: "gateway",
    providerVoiceId: "echo",
    description: "Gateway voice, steady",
  },
  {
    id: "fable",
    name: "Fable",
    language: "English",
    languageCode: "en",
    gender: "feminine",
    provider: "gateway",
    providerVoiceId: "fable",
    description: "Gateway voice, storybook warmth",
  },
  {
    id: "nova",
    name: "Nova",
    language: "English",
    languageCode: "en",
    gender: "feminine",
    provider: "gateway",
    providerVoiceId: "nova",
    description: "Gateway voice, bright and modern",
  },
  // ---- Hindi built-ins (4) ----
  {
    id: "aisha",
    name: "Aisha",
    nameHi: "आइशा",
    language: "Hindi",
    languageCode: "hi",
    gender: "feminine",
    provider: "elevenlabs",
    providerVoiceId: "21m00Tcm4TlvDq8ikWAM", // Rachel — clear multilingual
    description: "Warm Hindi narration, clear and friendly",
  },
  {
    id: "arjun",
    name: "Arjun",
    nameHi: "अर्जुन",
    language: "Hindi",
    languageCode: "hi",
    gender: "masculine",
    provider: "elevenlabs",
    providerVoiceId: "pNInz6obpgDQGcFmaJgB", // Adam — deep multilingual
    description: "Deep Hindi voiceover, authoritative",
  },
  {
    id: "kavya",
    name: "Kavya",
    nameHi: "काव्या",
    language: "Hindi",
    languageCode: "hi",
    gender: "feminine",
    provider: "gateway",
    providerVoiceId: "shimmer",
    description: "Bright Hindi voice via AI gateway",
  },
  {
    id: "vikram",
    name: "Vikram",
    nameHi: "विक्रम",
    language: "Hindi",
    languageCode: "hi",
    gender: "masculine",
    provider: "gateway",
    providerVoiceId: "onyx",
    description: "Steady Hindi narration via AI gateway",
  },
  // ---- Library voices (resolved at runtime via ElevenLabs) ----
  // These slots document the picker's capacity; actual voices load from
  // the user's ElevenLabs library when a key is configured.
  ...(
    [
      ["hi", "Hindi", "feminine"],
      ["hi", "Hindi", "masculine"],
      ["en", "English", "feminine"],
      ["en", "English", "masculine"],
      ["es", "Spanish", "feminine"],
      ["es", "Spanish", "masculine"],
      ["fr", "French", "feminine"],
      ["de", "German", "masculine"],
      ["pt", "Portuguese", "feminine"],
      ["ta", "Tamil", "feminine"],
      ["te", "Telugu", "masculine"],
      ["bn", "Bengali", "feminine"],
      ["mr", "Marathi", "masculine"],
      ["pa", "Punjabi", "feminine"],
      ["gu", "Gujarati", "masculine"],
    ] as const
  ).map(([code, language, gender], i) => ({
    id: `library-${code}-${gender}-${i}`,
    name: `${language} ${gender === "feminine" ? "Voice" : "Voice"} (Library)`,
    language,
    languageCode: code,
    gender,
    provider: "elevenlabs" as VoiceProvider,
    providerVoiceId: null,
    library: true as const,
    description: `From your ElevenLabs library — connect a key to load`,
  })),
];

/** English voices first, then the rest (stable order). Vidora is language-neutral. */
export function sortedVoices(voices: CatalogVoice[] = VOICE_CATALOG): CatalogVoice[] {
  const rank = (v: CatalogVoice) =>
    v.languageCode === "en" ? 0 : 1;
  return [...voices].sort((a, b) => rank(a) - rank(b));
}

export function voiceById(id: string | null | undefined): CatalogVoice | undefined {
  return VOICE_CATALOG.find((v) => v.id === id);
}
