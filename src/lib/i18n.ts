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
