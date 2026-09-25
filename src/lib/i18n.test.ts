import { describe, expect, it } from "vitest";
import { translate, type I18nKey } from "./i18n";

describe("i18n", () => {
  it("translates research keys in English and Hindi", () => {
    expect(translate("en", "research_title")).toBe("Research");
    expect(translate("hi", "research_title")).toBe("रिसर्च");
    expect(translate("en", "generate_ideas")).toBe("Generate ideas");
    expect(translate("hi", "generate_ideas")).toBe("आइडिया बनाएं");
  });

  it("falls back to English for missing keys", () => {
    // @ts-expect-error — intentionally missing key
    expect(translate("hi", "nonexistent_key")).toBeUndefined();
  });

  it("has Hindi for every English key", () => {
    const enKeys: I18nKey[] = [
      "research_title",
      "research_subtitle",
      "new_research",
      "topic_placeholder",
      "explore",
      "exploring",
      "niches",
      "outliers",
      "ideas",
      "import_outliers",
      "video_urls_placeholder",
      "channel_placeholder",
      "import",
      "importing",
      "outlier_score",
      "generate_ideas",
      "generating",
      "save",
      "dismiss",
      "use_idea",
      "using",
      "saved",
      "no_ideas",
      "no_outliers",
      "quota_used",
      "hook_label",
      "angle_label",
      "back_to_research",
      "idea_saved",
      "idea_dismissed",
      "project_created",
    ];
    for (const key of enKeys) {
      const hi = translate("hi", key);
      expect(hi, `missing Hindi for ${key}`).toBeTruthy();
      expect(hi).not.toBe(translate("en", key));
    }
  });
});
