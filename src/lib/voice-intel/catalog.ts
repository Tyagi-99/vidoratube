/**
 * Voice Intelligence catalog — curated voice characters, languages,
 * categories and model metadata (D327).
 *
 * HONESTY RULES (do not weaken):
 * - `providerVoiceId` is set ONLY for ids already present in this codebase
 *   (Adam → pNInz6obpgDQGcFmaJgB, Elli → MF3mGyEYCl7XYWb3QV9V). Every other
 *   character is `providerVoiceId: null` + `status: "unmapped"`.
 * - `status: "mapped"` means "id from the codebase", NOT "verified live".
 *   Only a successful provider check flips a voice to "verified".
 * - `score` values are the spec's curated scores — the UI must label them
 *   ESTIMATE, never a measured quality metric.
 * - `categoryTags` are ordered strongest-affinity first; the recommendation
 *   engine weights earlier tags higher.
 */
import type {
  VoiceCategory,
  VoiceCharacter,
  VoiceLanguage,
  VoiceModel,
} from "./types";

/* ── Languages ─────────────────────────────────────────────────────────── */

export const VOICE_LANGUAGES: VoiceLanguage[] = [
  {
    code: "en",
    name: "English",
    flag: "🇺🇸",
    status: "active",
    defaultCharacterId: "adam",
    previewSample:
      "Some stories change the way we see the world. This is one of them.",
    charsPerMinute: 800,
  },
  {
    code: "hi",
    name: "Hindi",
    flag: "🇮🇳",
    status: "active",
    defaultCharacterId: "niraj",
    previewSample:
      "कुछ कहानियाँ हमारी सोच हमेशा के लिए बदल देती हैं। यह उन्हीं में से एक है।",
    charsPerMinute: 750,
  },
  {
    code: "es",
    name: "Spanish",
    flag: "🇪🇸",
    status: "active",
    defaultCharacterId: "miguel",
    previewSample:
      "Algunas historias cambian nuestra forma de ver el mundo. Esta es una de ellas.",
    charsPerMinute: 800,
  },
  {
    code: "de",
    name: "German",
    flag: "🇩🇪",
    status: "active",
    defaultCharacterId: "leon-stern",
    previewSample:
      "Manche Geschichten verändern für immer unsere Sicht auf die Welt. Dies ist eine davon.",
    charsPerMinute: 750,
  },
  // Planned — selectable UI stays disabled until a default voice + quality
  // gate exist. Adding a language = one entry here + characters below.
  { code: "fr", name: "French", flag: "🇫🇷", status: "planned", defaultCharacterId: null, previewSample: "", charsPerMinute: 800 },
  { code: "pt", name: "Portuguese", flag: "🇵🇹", status: "planned", defaultCharacterId: null, previewSample: "", charsPerMinute: 800 },
  { code: "it", name: "Italian", flag: "🇮🇹", status: "planned", defaultCharacterId: null, previewSample: "", charsPerMinute: 800 },
  { code: "ar", name: "Arabic", flag: "🇸🇦", status: "planned", defaultCharacterId: null, previewSample: "", charsPerMinute: 700 },
  { code: "ja", name: "Japanese", flag: "🇯🇵", status: "planned", defaultCharacterId: null, previewSample: "", charsPerMinute: 700 },
  { code: "ko", name: "Korean", flag: "🇰🇷", status: "planned", defaultCharacterId: null, previewSample: "", charsPerMinute: 700 },
  { code: "id", name: "Indonesian", flag: "🇮🇩", status: "planned", defaultCharacterId: null, previewSample: "", charsPerMinute: 800 },
  { code: "tr", name: "Turkish", flag: "🇹🇷", status: "planned", defaultCharacterId: null, previewSample: "", charsPerMinute: 800 },
];

export const ACTIVE_VOICE_LANGUAGES = VOICE_LANGUAGES.filter((l) => l.status === "active");

export function voiceLanguage(code: string | null | undefined): VoiceLanguage | undefined {
  return VOICE_LANGUAGES.find((l) => l.code === code);
}

/* ── Categories ────────────────────────────────────────────────────────── */

export const VOICE_CATEGORIES: VoiceCategory[] = [
  { id: "cinematic", label: "Cinematic", icon: "🎬", blurb: "Epic, dramatic narration", sort: 1 },
  { id: "storytelling", label: "Storytelling", icon: "📖", blurb: "Warm narrative voices", sort: 2 },
  { id: "emotional", label: "Emotional", icon: "❤️", blurb: "Heartfelt delivery", sort: 3 },
  { id: "documentary", label: "Documentary", icon: "🎥", blurb: "Authoritative factual tone", sort: 4 },
  { id: "crime_mystery", label: "Crime & Mystery", icon: "🔍", blurb: "Dark, suspenseful", sort: 5 },
  { id: "horror", label: "Horror", icon: "👻", blurb: "Chilling atmosphere", sort: 6 },
  { id: "business_finance", label: "Business & Finance", icon: "💼", blurb: "Sharp and credible", sort: 7 },
  { id: "educational", label: "Educational", icon: "🧠", blurb: "Clear teaching voices", sort: 8 },
  { id: "shorts_reels", label: "Shorts & Reels", icon: "⚡", blurb: "Punchy and fast", sort: 9 },
  { id: "news", label: "News / Informational", icon: "📰", blurb: "Crisp and neutral", sort: 10 },
  { id: "motivational", label: "Motivational", icon: "🔥", blurb: "Driving energy", sort: 11 },
  { id: "conversational", label: "Conversational", icon: "💬", blurb: "Natural and casual", sort: 12 },
  { id: "podcast", label: "Podcast", icon: "🎙", blurb: "Long-listen comfort", sort: 13 },
  { id: "soft_calm", label: "Soft / Calm", icon: "🌸", blurb: "Gentle and soothing", sort: 14 },
  { id: "entertainment", label: "Casual / Entertainment", icon: "😂", blurb: "Fun and lively", sort: 15 },
  { id: "lifestyle_beauty", label: "Lifestyle / Beauty", icon: "💄", blurb: "Friendly and modern", sort: 16 },
  { id: "technology_ai", label: "Technology / AI", icon: "🚀", blurb: "Smart and precise", sort: 17 },
];

export function voiceCategory(id: string | null | undefined): VoiceCategory | undefined {
  return VOICE_CATEGORIES.find((c) => c.id === id);
}

/* ── Voice characters ──────────────────────────────────────────────────── */

const ELEVENLABS_MODELS = [
  "eleven_multilingual_v2",
  "eleven_flash_v2_5",
  "eleven_turbo_v2_5",
  "eleven_v3",
];

function c(v: Omit<VoiceCharacter, "provider" | "supportedModels" | "status" | "providerVoiceId"> & {
  providerVoiceId?: string | null;
  status?: VoiceCharacter["status"];
}): VoiceCharacter {
  return {
    provider: "elevenlabs",
    supportedModels: ELEVENLABS_MODELS,
    ...v,
    // Computed AFTER the spread: an explicit status wins, otherwise a
    // present providerVoiceId means "mapped" (not verified), else "unmapped".
    status: v.status ?? (v.providerVoiceId ? "mapped" : "unmapped"),
    providerVoiceId: v.providerVoiceId ?? null,
  } as VoiceCharacter;
}

export const VOICE_CHARACTERS: VoiceCharacter[] = [
  /* ── English ── */
  c({
    id: "adam", name: "Adam", languageCode: "en", gender: "masculine", accent: null,
    personalityTags: ["deep", "dark", "cinematic", "authoritative", "dramatic"],
    categoryTags: ["cinematic", "storytelling", "crime_mystery", "documentary", "motivational", "shorts_reels"],
    description: "Powerful cinematic narrator suited for dramatic stories and high-retention YouTube content.",
    recommendedFor: ["Faceless YouTube videos", "Business stories", "Mystery channels", "Motivational videos", "Documentaries"],
    score: 9.8, isDefault: true, providerVoiceId: "pNInz6obpgDQGcFmaJgB",
  }),
  c({
    id: "sawyer", name: "Sawyer", languageCode: "en", gender: "masculine", accent: null,
    personalityTags: ["dark", "atmospheric", "serious", "mysterious"],
    categoryTags: ["crime_mystery", "horror", "documentary", "storytelling"],
    description: "Dark, atmospheric narrator built for suspense-driven storytelling. Ideal for longer mystery formats.",
    recommendedFor: ["True crime", "Dark history", "Reddit stories", "Horror narration"],
    score: 9.6, isDefault: false,
  }),
  c({
    id: "darian", name: "Darian", languageCode: "en", gender: "masculine", accent: null,
    personalityTags: ["warm", "grounded", "natural", "storyteller"],
    categoryTags: ["storytelling", "emotional", "documentary", "podcast"],
    description: "Warm, grounded storyteller — excellent for 10–30 minute narration.",
    recommendedFor: ["Biographies", "Human-interest stories", "Emotional stories", "Long-form videos"],
    score: 9.5, isDefault: false,
  }),
  c({
    id: "finley", name: "Finley", languageCode: "en", gender: "masculine", accent: null,
    personalityTags: ["articulate", "professional", "authoritative", "informative"],
    categoryTags: ["documentary", "business_finance", "educational", "technology_ai", "news"],
    description: "Articulate professional narrator for documentary, history and explainers.",
    recommendedFor: ["History", "Science", "Business", "News-style narration"],
    score: 9.4, isDefault: false,
  }),
  c({
    id: "jade", name: "Jade", languageCode: "en", gender: "feminine", accent: null,
    personalityTags: ["energetic", "modern", "friendly", "upbeat"],
    categoryTags: ["lifestyle_beauty", "shorts_reels", "entertainment", "conversational"],
    description: "Energetic modern voice for Shorts, Reels and social content.",
    recommendedFor: ["Beauty", "Lifestyle", "Social media", "UGC-style content"],
    score: 9.3, isDefault: false,
  }),
  c({
    id: "elara", name: "Elara", languageCode: "en", gender: "feminine", accent: null,
    personalityTags: ["clear", "professional", "modern", "crisp"],
    categoryTags: ["technology_ai", "educational", "documentary", "conversational"],
    description: "Crisp professional voice for tech, AI and product explainers.",
    recommendedFor: ["SaaS", "Tutorials", "Product explainers", "Education"],
    score: 9.2, isDefault: false,
  }),
  c({
    id: "talia", name: "Talia", languageCode: "en", gender: "feminine", accent: null,
    personalityTags: ["warm", "soft", "friendly", "calm"],
    categoryTags: ["lifestyle_beauty", "soft_calm", "educational", "storytelling"],
    description: "Warm, soft narrator for wellness, lifestyle and calm storytelling.",
    recommendedFor: ["Wellness", "Meditation", "Beauty", "Soft storytelling"],
    score: 9.1, isDefault: false,
  }),
  c({
    id: "lawrence", name: "Lawrence", languageCode: "en", gender: "masculine", accent: null,
    personalityTags: ["bright", "informative", "clear"],
    categoryTags: ["educational", "technology_ai", "shorts_reels", "news"],
    description: "Bright, informative voice for tutorials and fact content.",
    recommendedFor: ["Tutorials", "Facts", "Educational Shorts", "Informational videos"],
    score: 9.0, isDefault: false,
  }),
  c({
    id: "warren", name: "Warren", languageCode: "en", gender: "masculine", accent: null,
    personalityTags: ["casual", "young", "cool", "natural"],
    categoryTags: ["shorts_reels", "entertainment", "conversational"],
    description: "Casual creator-style narrator for entertainment and social video.",
    recommendedFor: ["Entertainment", "Conversational videos", "Social content", "Shorts"],
    score: 8.9, isDefault: false,
  }),
  c({
    id: "florence", name: "Florence", languageCode: "en", gender: "feminine", accent: null,
    personalityTags: ["atmospheric", "emotional", "cinematic", "soft"],
    categoryTags: ["emotional", "storytelling", "cinematic", "crime_mystery"],
    description: "Atmospheric, emotional narrator for romance, mystery and audiobook-style stories.",
    recommendedFor: ["Emotional storytelling", "Romance", "Mystery", "Fantasy", "Female narration"],
    score: 8.8, isDefault: false,
  }),

  /* ── Hindi ── */
  c({
    id: "niraj", name: "Niraj", languageCode: "hi", gender: "masculine", accent: null,
    personalityTags: ["smooth", "emotional", "cinematic", "warm"],
    categoryTags: ["storytelling", "emotional", "cinematic", "motivational", "soft_calm"],
    description: "Smooth, emotional cinematic narrator — the default Hindi storyteller.",
    recommendedFor: ["Village stories", "Dramatic stories", "Emotional stories", "Romance", "Motivational videos"],
    score: 9.7, isDefault: true,
  }),
  c({
    id: "raju", name: "Raju", languageCode: "hi", gender: "masculine", accent: null,
    personalityTags: ["natural", "warm", "human", "friendly"],
    categoryTags: ["storytelling", "documentary", "soft_calm", "educational"],
    description: "Natural, warm human narrator for stories that feel personal.",
    recommendedFor: ["Moral stories", "Documentary", "Long-form narration", "Educational"],
    score: 9.5, isDefault: false,
  }),
  c({
    id: "aakash", name: "Aakash", languageCode: "hi", gender: "masculine", accent: null,
    personalityTags: ["professional", "narrative", "balanced"],
    categoryTags: ["storytelling", "documentary", "educational", "podcast"],
    description: "Professional, balanced narrator for long-form Hindi content.",
    recommendedFor: ["Audiobooks", "Hindi explainers", "Documentary", "Educational narration"],
    score: 9.4, isDefault: false,
  }),
  c({
    id: "bunty", name: "Bunty", languageCode: "hi", gender: "masculine", accent: null,
    personalityTags: ["punchy", "fast", "energetic", "attention-grabbing"],
    categoryTags: ["shorts_reels", "entertainment", "news", "conversational"],
    description: "Punchy, fast voice built for viral Hindi Shorts and Reels.",
    recommendedFor: ["Shorts", "Reels", "Viral hooks", "Facts", "Fast storytelling"],
    score: 9.3, isDefault: false,
  }),
  c({
    id: "monika-sogam", name: "Monika Sogam", languageCode: "hi", gender: "feminine", accent: null,
    personalityTags: ["warm", "calm", "natural"],
    categoryTags: ["emotional", "storytelling", "lifestyle_beauty", "educational"],
    description: "Warm, calm natural female narrator.",
    recommendedFor: ["Emotional stories", "Lifestyle", "Education", "Female narration"],
    score: 9.2, isDefault: false,
  }),
  c({
    id: "kali-devi", name: "Kali Devi", languageCode: "hi", gender: "feminine", accent: null,
    personalityTags: ["expressive", "cinematic"],
    categoryTags: ["emotional", "cinematic", "storytelling"],
    description: "Expressive cinematic female storyteller.",
    recommendedFor: ["Emotional stories", "Dramatic narration", "Cultural stories", "Cinematic content"],
    score: 9.1, isDefault: false,
  }),
  c({
    id: "krishna-gupta", name: "Krishna Gupta", languageCode: "hi", gender: "masculine", accent: null,
    personalityTags: ["modern", "energetic", "social-media friendly"],
    categoryTags: ["shorts_reels", "entertainment", "news", "conversational"],
    description: "Modern, energetic voice for Hindi social media.",
    recommendedFor: ["Shorts", "Reels", "Facts", "Entertainment", "Social media"],
    score: 9.0, isDefault: false,
  }),
  c({
    id: "devi", name: "Devi", languageCode: "hi", gender: "feminine", accent: null,
    personalityTags: ["positive", "warm", "motivating"],
    categoryTags: ["motivational", "educational", "soft_calm", "storytelling"],
    description: "Positive, warm motivating narrator.",
    recommendedFor: ["Motivational videos", "Positive stories", "Education", "Wellness"],
    score: 8.9, isDefault: false,
  }),
  c({
    id: "vikram", name: "Vikram", languageCode: "hi", gender: "masculine", accent: null,
    personalityTags: ["clear", "professional", "informative"],
    categoryTags: ["educational", "technology_ai", "news", "conversational"],
    description: "Clear, professional voice for Hindi tutorials and explainers.",
    recommendedFor: ["Tutorials", "Education", "Technology", "Informational videos"],
    score: 8.8, isDefault: false,
  }),
  c({
    id: "vikrant", name: "Vikrant", languageCode: "hi", gender: "masculine", accent: null,
    personalityTags: ["direct", "clear", "instructional"],
    categoryTags: ["educational", "technology_ai", "conversational"],
    description: "Direct, instructional narrator for how-to content.",
    recommendedFor: ["How-to videos", "Education", "Tutorials", "Tech"],
    score: 8.7, isDefault: false,
  }),

  /* ── Spanish ── */
  c({
    id: "miguel", name: "Miguel", languageCode: "es", gender: "masculine", accent: null,
    personalityTags: ["deep", "rich", "cinematic", "dramatic"],
    categoryTags: ["cinematic", "documentary", "crime_mystery", "emotional", "storytelling"],
    description: "Deep, rich cinematic narrator — the default Spanish storyteller.",
    recommendedFor: ["Documentary", "Mystery", "Crime", "History", "Emotional storytelling"],
    score: 9.8, isDefault: true,
  }),
  c({
    id: "alberto-rodriguez", name: "Alberto Rodríguez", languageCode: "es", gender: "masculine", accent: null,
    personalityTags: ["serious", "professional", "narrative"],
    categoryTags: ["documentary", "business_finance", "crime_mystery", "storytelling"],
    description: "Serious, professional narrator for long-form Spanish content.",
    recommendedFor: ["Biography", "Business", "History", "True crime"],
    score: 9.7, isDefault: false,
  }),
  c({
    id: "david-martin", name: "David Martin", languageCode: "es", gender: "masculine", accent: null,
    personalityTags: ["confident", "balanced", "professional"],
    categoryTags: ["documentary", "educational", "business_finance", "storytelling"],
    description: "Confident, balanced professional narrator.",
    recommendedFor: ["Educational", "Business", "General storytelling", "Spain-focused narration"],
    score: 9.5, isDefault: false,
  }),
  c({
    id: "carmelo", name: "Carmelo", languageCode: "es", gender: "masculine", accent: null,
    personalityTags: ["mature", "mysterious", "dark", "clear"],
    categoryTags: ["horror", "crime_mystery", "documentary"],
    description: "Mature, mysterious voice for dark Spanish storytelling.",
    recommendedFor: ["Horror", "Mystery", "Crime", "Dark history", "Suspense"],
    score: 9.4, isDefault: false,
  }),
  c({
    id: "fernando-martinez", name: "Fernando Martínez", languageCode: "es", gender: "masculine", accent: null,
    personalityTags: ["fast", "persuasive", "energetic"],
    categoryTags: ["shorts_reels", "entertainment", "news", "conversational"],
    description: "Fast, persuasive voice for high-energy Spanish content.",
    recommendedFor: ["Shorts", "Reels", "Advertising", "Facts", "Fast-paced videos"],
    score: 9.3, isDefault: false,
  }),
  c({
    id: "enrique-mondragon", name: "Enrique Mondragón", languageCode: "es", gender: "masculine", accent: "Mexican Spanish",
    personalityTags: ["natural", "narrative"],
    categoryTags: ["storytelling", "documentary", "entertainment", "podcast"],
    description: "Natural Mexican Spanish narrator.",
    recommendedFor: ["Mexican storytelling", "Documentary", "Entertainment", "Long-form videos"],
    score: 9.2, isDefault: false,
  }),
  c({
    id: "antonio", name: "Antonio", languageCode: "es", gender: "masculine", accent: "Mexican Spanish",
    personalityTags: ["conversational", "friendly", "casual"],
    categoryTags: ["conversational", "podcast", "entertainment", "shorts_reels"],
    description: "Friendly, casual Mexican Spanish conversationalist.",
    recommendedFor: ["Podcasts", "Entertainment", "Social videos", "Conversational content"],
    score: 9.1, isDefault: false,
  }),
  c({
    id: "agustin", name: "Agustín", languageCode: "es", gender: "masculine", accent: "Argentine",
    personalityTags: ["relaxed", "conversational"],
    categoryTags: ["conversational", "entertainment", "podcast"],
    description: "Relaxed Argentine conversational narrator.",
    recommendedFor: ["Casual storytelling", "Entertainment", "Podcasts", "Social content"],
    score: 9.0, isDefault: false,
  }),
  c({
    id: "sara-martin", name: "Sara Martin", languageCode: "es", gender: "feminine", accent: null,
    personalityTags: ["clear", "professional", "friendly"],
    categoryTags: ["educational", "documentary", "lifestyle_beauty", "conversational"],
    description: "Clear, professional friendly female voice.",
    recommendedFor: ["Education", "Documentary", "Lifestyle", "Female narration"],
    score: 8.9, isDefault: false,
  }),
  c({
    id: "el-faraon", name: "El Faraon", languageCode: "es", gender: "masculine", accent: "Latin-American",
    personalityTags: ["deep", "strong"],
    categoryTags: ["storytelling", "motivational", "cinematic", "documentary"],
    description: "Deep, strong Latin-American narrator.",
    recommendedFor: ["History", "Motivational", "Cinematic narration", "Storytelling"],
    score: 8.8, isDefault: false,
  }),

  /* ── German ── */
  c({
    id: "leon-stern", name: "Leon Stern", languageCode: "de", gender: "masculine", accent: null,
    personalityTags: ["rich", "deep", "cinematic", "authoritative"],
    categoryTags: ["documentary", "crime_mystery", "business_finance", "cinematic", "storytelling"],
    description: "Rich, deep cinematic narrator — the default German storyteller.",
    recommendedFor: ["Documentary", "History", "Crime", "Mystery", "Business"],
    score: 9.7, isDefault: true,
  }),
  c({
    id: "helmut-stieglbauer", name: "Helmut Stieglbauer", languageCode: "de", gender: "masculine", accent: null,
    personalityTags: ["deep", "dynamic", "dramatic"],
    categoryTags: ["documentary", "crime_mystery", "cinematic", "storytelling"],
    description: "Deep, dynamic dramatic narrator.",
    recommendedFor: ["History", "Crime", "Cinematic", "Dramatic storytelling"],
    score: 9.6, isDefault: false,
  }),
  c({
    id: "christian", name: "Christian", languageCode: "de", gender: "masculine", accent: null,
    personalityTags: ["warm", "captivating", "natural"],
    categoryTags: ["storytelling", "documentary", "educational", "conversational"],
    description: "Warm, captivating natural narrator.",
    recommendedFor: ["Long-form storytelling", "Biography", "Travel", "Educational stories"],
    score: 9.5, isDefault: false,
  }),
  c({
    id: "otto", name: "Otto", languageCode: "de", gender: "masculine", accent: null,
    personalityTags: ["casual", "natural", "creator-like"],
    categoryTags: ["conversational", "entertainment", "shorts_reels", "educational"],
    description: "Casual, creator-like German narrator.",
    recommendedFor: ["YouTube narration", "Conversational videos", "Explainers", "Shorts"],
    score: 9.4, isDefault: false,
  }),
  c({
    id: "mila", name: "Mila", languageCode: "de", gender: "feminine", accent: null,
    personalityTags: ["confident", "professional"],
    categoryTags: ["documentary", "news", "educational", "shorts_reels"],
    description: "Confident professional female narrator.",
    recommendedFor: ["Documentary", "Commentary", "News", "Educational"],
    score: 9.3, isDefault: false,
  }),
  c({
    id: "benjamin", name: "Benjamin", languageCode: "de", gender: "masculine", accent: null,
    personalityTags: ["clear", "educational", "professional"],
    categoryTags: ["educational", "technology_ai", "conversational"],
    description: "Clear, professional voice for German education and tech.",
    recommendedFor: ["Education", "Tutorials", "Explainers", "Technology"],
    score: 9.1, isDefault: false,
  }),
  c({
    id: "toby", name: "Toby", languageCode: "de", gender: "masculine", accent: null,
    personalityTags: ["casual", "friendly", "conversational"],
    categoryTags: ["entertainment", "podcast", "conversational"],
    description: "Casual, friendly conversational narrator.",
    recommendedFor: ["Entertainment", "Podcasts", "Casual storytelling", "Social content"],
    score: 9.0, isDefault: false,
  }),
  c({
    id: "sissi", name: "Sissi", languageCode: "de", gender: "feminine", accent: null,
    personalityTags: ["energetic", "expressive"],
    categoryTags: ["shorts_reels", "lifestyle_beauty", "entertainment"],
    description: "Energetic, expressive female voice.",
    recommendedFor: ["Shorts", "Reels", "Lifestyle", "Entertainment"],
    score: 8.9, isDefault: false,
  }),
  c({
    id: "elli", name: "Elli", languageCode: "de", gender: "feminine", accent: null,
    personalityTags: ["friendly", "soft", "conversational"],
    categoryTags: ["lifestyle_beauty", "educational", "conversational", "storytelling"],
    description: "Friendly, soft conversational narrator.",
    recommendedFor: ["Lifestyle", "Education", "Conversational videos", "Female storytelling"],
    score: 8.8, isDefault: false, providerVoiceId: "MF3mGyEYCl7XYWb3QV9V",
  }),
  c({
    id: "thorsten", name: "Thorsten", languageCode: "de", gender: "masculine", accent: null,
    personalityTags: ["expressive", "character-driven"],
    categoryTags: ["entertainment", "storytelling", "conversational"],
    description: "Expressive, character-driven narrator.",
    recommendedFor: ["Animation", "Characters", "Comedy", "Storytelling"],
    score: 8.7, isDefault: false,
  }),
];

export function voiceCharacter(id: string | null | undefined): VoiceCharacter | undefined {
  return VOICE_CHARACTERS.find((v) => v.id === id);
}

export function charactersForLanguage(languageCode: string): VoiceCharacter[] {
  return VOICE_CHARACTERS.filter((v) => v.languageCode === languageCode);
}

export function defaultCharacterForLanguage(languageCode: string): VoiceCharacter | undefined {
  return VOICE_CHARACTERS.find((v) => v.languageCode === languageCode && v.isDefault);
}

/* ── Voice models ──────────────────────────────────────────────────────── */
/**
 * Configurable seed — mirrors the `voice_models` table. The server refreshes
 * from the ElevenLabs /v1/models endpoint when a key is configured; this
 * seed is the honest fallback, never a permanently-hardcoded truth.
 */
export const VOICE_MODELS: VoiceModel[] = [
  {
    id: "eleven_multilingual_v2",
    provider: "elevenlabs",
    label: "Eleven Multilingual v2",
    quality: 4, speed: "medium", expressiveness: "high",
    multilingual: true,
    supportedLanguages: ["en", "hi", "es", "de", "fr", "pt", "it", "ar", "ja", "ko", "id", "tr"],
    bestFor: "Long-form documentaries — quality and voice consistency",
    costMultiplier: 2,
    supportedParams: ["stability", "similarity_boost", "style", "speed", "speaker_boost"],
    maturity: "stable", isActive: true,
  },
  {
    id: "eleven_flash_v2_5",
    provider: "elevenlabs",
    label: "Eleven Flash v2.5",
    quality: 4, speed: "very_fast", expressiveness: "medium",
    multilingual: true,
    supportedLanguages: ["en", "hi", "es", "de", "fr", "pt", "it", "ar", "ja", "ko", "id", "tr"],
    bestFor: "Shorts & Reels — fastest generation, low latency",
    costMultiplier: 1,
    supportedParams: ["stability", "similarity_boost", "style", "speed", "speaker_boost"],
    maturity: "stable", isActive: true,
  },
  {
    id: "eleven_turbo_v2_5",
    provider: "elevenlabs",
    label: "Eleven Turbo v2.5",
    quality: 3, speed: "fast", expressiveness: "low",
    multilingual: true,
    supportedLanguages: ["en", "hi", "es", "de", "fr", "pt", "it"],
    bestFor: "Drafts and high-volume generation where speed beats nuance",
    costMultiplier: 1,
    supportedParams: ["stability", "similarity_boost", "style", "speed", "speaker_boost"],
    maturity: "stable", isActive: true,
  },
  {
    id: "eleven_v3",
    provider: "elevenlabs",
    label: "Eleven v3 (alpha)",
    quality: 5, speed: "medium", expressiveness: "very_high",
    multilingual: true,
    supportedLanguages: ["en", "hi", "es", "de"],
    bestFor: "Cinematic storytelling — maximum expressiveness",
    costMultiplier: 2,
    supportedParams: ["stability", "similarity_boost", "style", "speed", "speaker_boost"],
    maturity: "alpha", isActive: true,
  },
  {
    id: "openai_tts_1",
    provider: "openai",
    label: "OpenAI TTS-1",
    quality: 3, speed: "very_fast", expressiveness: "low",
    multilingual: true,
    supportedLanguages: ["en", "es", "de", "fr", "pt", "it"],
    bestFor: "Fallback provider — only used when ElevenLabs is unavailable",
    costMultiplier: 1,
    supportedParams: ["speed"],
    maturity: "stable", isActive: true,
  },
];

export function voiceModel(id: string | null | undefined): VoiceModel | undefined {
  return VOICE_MODELS.find((m) => m.id === id);
}

export function modelsForCharacter(character: VoiceCharacter): VoiceModel[] {
  return VOICE_MODELS.filter(
    (m) => m.isActive && character.supportedModels.includes(m.id),
  );
}
