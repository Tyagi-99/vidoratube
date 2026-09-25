import { useCallback, useEffect, useState } from "react";

/**
 * Minimal i18n (P3). English + Hindi dictionaries, language persisted in
 * localStorage. Scoped to the research UI for now — P9 will expand this
 * into a full app-wide framework.
 */

export type Lang = "en" | "hi";

const STORAGE_KEY = "vidora-lang";

export function getLang(): Lang {
  if (typeof localStorage === "undefined") return "en";
  return localStorage.getItem(STORAGE_KEY) === "hi" ? "hi" : "en";
}

export function setLang(lang: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // ignore
  }
}

const en = {
  research_title: "Research",
  research_subtitle: "Find your niche, spot outliers, generate ideas.",
  new_research: "New research",
  topic_placeholder: "e.g. personal finance India",
  explore: "Explore",
  exploring: "Exploring…",
  niches: "Niches",
  outliers: "Outliers",
  ideas: "Ideas",
  import_outliers: "Import outliers",
  video_urls_placeholder: "Paste YouTube video URLs (one per line)",
  channel_placeholder: "Or a channel @handle / ID / URL",
  import: "Import",
  importing: "Importing…",
  outlier_score: "outlier",
  generate_ideas: "Generate ideas",
  generating: "Generating…",
  save: "Save",
  dismiss: "Dismiss",
  use_idea: "Use this idea",
  using: "Creating project…",
  saved: "Saved",
  no_ideas: "No ideas yet. Generate some above.",
  no_outliers: "No outliers yet. Import videos or a channel above.",
  quota_used: "YouTube quota used",
  hook_label: "Hook",
  angle_label: "Angle",
  back_to_research: "Back to research",
  idea_saved: "Idea saved",
  idea_dismissed: "Idea dismissed",
  project_created: "Project created — opening studio…",
  // P4: Studio v2
  style: "Style",
  style_hint: "Style hint — not a generated preview",
  characters: "Characters",
  new_character: "New character",
  character_name: "Character name",
  character_description: "Description (appearance, clothing, age…)",
  character_created: "Character created",
  character_deleted: "Character deleted",
  no_characters: "No characters yet. Create one to keep them consistent across scenes.",
  voices: "Voices",
  preview_voice: "Preview",
  previewing: "Playing preview…",
  music: "Music",
  music_mood: "Mood",
  no_music: "No tracks yet. Search Jamendo to build your music library.",
  search_music: "Search music",
  searching_music: "Searching…",
  connect_jamendo: "Add a free Jamendo client ID to enable music search.",
  music_volume: "Music volume",
  music_ducking: "Duck music under voice",
  provenance: "Provenance",
  made_with: "Made with",
  no_provenance: "No provenance recorded yet. Generate an asset to see its origin.",
  download_provenance: "Download provenance JSON",
  per_scene_voice: "Voice for this scene",
  use_project_voice: "Use project voice",
  publish_tab: "Publish",
  thumbnail_studio: "Thumbnail studio",
  generate_thumbnails: "Generate thumbnails",
  generating_thumbnails: "Generating…",
  thumbnail_headline: "Headline text",
  thumbnail_font: "Font",
  thumbnail_color: "Text color",
  thumbnail_position: "Position",
  seo_studio: "SEO studio",
  generate_seo: "Generate SEO",
  generating_seo: "Generating…",
  suggested_titles: "Suggested titles",
  description_label: "Description",
  tags_label: "Tags",
  schedule_label: "Schedule (optional)",
  publish_now: "Publish now",
  schedule_publish: "Schedule publish",
  approve_publish: "Approve & publish",
  approving: "Publishing…",
  review_publish: "Review before publishing",
  publish_history: "Publish history",
  made_for_kids_q: "Is this video made for kids?",
  // P6: Monetization Safety Score
  safety_title: "Monetization Safety",
  safety_subtitle: "Pre-publish demonetization risk check. 1 credit per check.",
  safety_run: "Run safety check",
  safety_recheck: "Re-check",
  safety_check_done: "Safety check complete",
  safety_empty: "No safety check yet. Run one before publishing to catch demonetization risks early.",
  safety_checked_at: "Checked",
  safety_issues: "Issues found",
  safety_fix_with_ai: "Fix with AI",
  safety_fix_applied: "Rewrite applied — re-run the safety check",
  safety_deep_review: "AI deep review (1 credit)",
  safety_deep_done: "AI deep review complete",
  safety_ai_review_title: "AI deep review",
  safety_history: "Score history",
  safety_gate_blocked: "Safety score is high-risk. Fix the issues above or acknowledge the risk to publish.",
  safety_override_label: "I understand this video has a high demonetization risk and I publish at my own risk.",
  safety_badge_ok: "Safety",
  loading: "Loading…",
} as const;

const hi: Record<keyof typeof en, string> = {
  research_title: "रिसर्च",
  research_subtitle: "अपना नीश खोजें, आउटलायर पहचानें, आइडिया बनाएं।",
  new_research: "नई रिसर्च",
  topic_placeholder: "जैसे: पर्सनल फाइनेंस इंडिया",
  explore: "एक्सप्लोर करें",
  exploring: "एक्सप्लोर हो रहा है…",
  niches: "नीश",
  outliers: "आउटलायर",
  ideas: "आइडिया",
  import_outliers: "आउटलायर इम्पोर्ट करें",
  video_urls_placeholder: "YouTube वीडियो URL पेस्ट करें (हर लाइन में एक)",
  channel_placeholder: "या चैनल @handle / ID / URL",
  import: "इम्पोर्ट करें",
  importing: "इम्पोर्ट हो रहा है…",
  outlier_score: "आउटलायर",
  generate_ideas: "आइडिया बनाएं",
  generating: "बन रहे हैं…",
  save: "सेव करें",
  dismiss: "हटाएं",
  use_idea: "इस आइडिया का उपयोग करें",
  using: "प्रोजेक्ट बन रहा है…",
  saved: "सेव हो गया",
  no_ideas: "अभी कोई आइडिया नहीं। ऊपर से बनाएं।",
  no_outliers: "अभी कोई आउटलायर नहीं। ऊपर वीडियो या चैनल इम्पोर्ट करें।",
  quota_used: "YouTube कोटा उपयोग",
  hook_label: "हुक",
  angle_label: "एंगल",
  back_to_research: "रिसर्च पर वापस",
  idea_saved: "आइडिया सेव हो गया",
  idea_dismissed: "आइडिया हटा दिया गया",
  project_created: "प्रोजेक्ट बन गया — स्टूडियो खुल रहा है…",
  // P4: Studio v2
  style: "स्टाइल",
  style_hint: "स्टाइल हिंट — जेनरेटेड प्रीव्यू नहीं",
  characters: "कैरेक्टर्स",
  new_character: "नया कैरेक्टर",
  character_name: "कैरेक्टर का नाम",
  character_description: "विवरण (दिखावट, कपड़े, उम्र…)",
  character_created: "कैरेक्टर बन गया",
  character_deleted: "कैरेक्टर हटा दिया",
  no_characters: "अभी कोई कैरेक्टर नहीं। सीन में एक जैसा रखने के लिए बनाएं।",
  voices: "आवाज़ें",
  preview_voice: "सुनें",
  previewing: "चल रहा है…",
  music: "म्यूज़िक",
  music_mood: "मूड",
  no_music: "अभी कोई ट्रैक नहीं। म्यूज़िक लाइब्रेरी बनाने के लिए खोजें।",
  search_music: "म्यूज़िक खोजें",
  searching_music: "खोज रहे हैं…",
  connect_jamendo: "म्यूज़िक खोज के लिए मुफ़्त Jamendo क्लाइंट ID जोड़ें।",
  music_volume: "म्यूज़िक वॉल्यूम",
  music_ducking: "आवाज़ के नीचे म्यूज़िक दबाएं",
  provenance: "स्रोत जानकारी",
  made_with: "बनाया गया",
  no_provenance: "अभी कोई स्रोत जानकारी नहीं। एसेट बनाएं तो दिखेगा।",
  download_provenance: "स्रोत JSON डाउनलोड करें",
  per_scene_voice: "इस सीन की आवाज़",
  use_project_voice: "प्रोजेक्ट की आवाज़ इस्तेमाल करें",
  publish_tab: "पब्लिश",
  thumbnail_studio: "थंबनेल स्टूडियो",
  generate_thumbnails: "थंबनेल बनाएं",
  generating_thumbnails: "बन रहा है…",
  thumbnail_headline: "हेडलाइन टेक्स्ट",
  thumbnail_font: "फ़ॉन्ट",
  thumbnail_color: "टेक्स्ट का रंग",
  thumbnail_position: "स्थिति",
  seo_studio: "SEO स्टूडियो",
  generate_seo: "SEO बनाएं",
  generating_seo: "बन रहा है…",
  suggested_titles: "सुझाए गए टाइटल",
  description_label: "विवरण",
  tags_label: "टैग",
  schedule_label: "शेड्यूल (वैकल्पिक)",
  publish_now: "अभी पब्लिश करें",
  schedule_publish: "शेड्यूल पब्लिश",
  approve_publish: "अप्रूव और पब्लिश करें",
  approving: "पब्लिश हो रहा है…",
  review_publish: "पब्लिश से पहले जांचें",
  publish_history: "पब्लिश इतिहास",
  made_for_kids_q: "क्या यह वीडियो बच्चों के लिए है?",
  // P6: मोनेटाइज़ेशन सेफ्टी स्कोर
  safety_title: "मोनेटाइज़ेशन सेफ्टी",
  safety_subtitle: "पब्लिश से पहले डिमोनेटाइज़ेशन जोखिम जांच। प्रति जांच 1 क्रेडिट।",
  safety_run: "सेफ्टी जांच चलाएं",
  safety_recheck: "फिर से जांचें",
  safety_check_done: "सेफ्टी जांच पूरी हुई",
  safety_empty: "अभी कोई सेफ्टी जांच नहीं हुई। पब्लिश से पहले एक जांच चलाएं।",
  safety_checked_at: "जांच समय",
  safety_issues: "मिली समस्याएं",
  safety_fix_with_ai: "AI से ठीक करें",
  safety_fix_applied: "सुधार लागू हुआ — सेफ्टी जांच फिर से चलाएं",
  safety_deep_review: "AI गहन समीक्षा (1 क्रेडिट)",
  safety_deep_done: "AI गहन समीक्षा पूरी हुई",
  safety_ai_review_title: "AI गहन समीक्षा",
  safety_history: "स्कोर इतिहास",
  safety_gate_blocked: "सेफ्टी स्कोर उच्च जोखिम वाला है। ऊपर की समस्याएं ठीक करें या जोखिम स्वीकार करके पब्लिश करें।",
  safety_override_label: "मैं समझता हूं कि इस वीडियो में डिमोनेटाइज़ेशन का उच्च जोखिम है और मैं अपने जोखिम पर पब्लिश कर रहा हूं।",
  safety_badge_ok: "सेफ्टी",
  loading: "लोड हो रहा है…",
};

export type I18nKey = keyof typeof en;

export function translate(lang: Lang, key: I18nKey): string {
  return (lang === "hi" ? hi[key] : en[key]) ?? en[key];
}

/** React hook: current language + t() + setter (re-renders on change). */
export function useI18n() {
  const [lang, setLangState] = useState<Lang>(() => getLang());
  useEffect(() => {
    const onStorage = () => setLangState(getLang());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const changeLang = useCallback((l: Lang) => {
    setLang(l);
    setLangState(l);
  }, []);
  const t = useCallback((key: I18nKey) => translate(lang, key), [lang]);
  return { lang, setLang: changeLang, t };
}
