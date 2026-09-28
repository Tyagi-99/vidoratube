import { describe, expect, it } from "vitest";
import {
  categoryForNiche,
  recommendVoices,
  topVoices,
  whyThisVoice,
} from "./recommend";
import { voiceCharacter } from "./catalog";

const ids = (languageCode: string, categoryId: any, niche?: string | null) =>
  topVoices(languageCode, categoryId, niche).map((r) => r.character.id);

describe("recommendVoices", () => {
  it("English + Crime & Mystery → Sawyer, Adam, Finley (spec order)", () => {
    expect(ids("en", "crime_mystery")).toEqual(["sawyer", "adam", "finley"]);
  });

  it("English + Beauty → Jade, Talia, Florence (spec order)", () => {
    expect(ids("en", "lifestyle_beauty")).toEqual(["jade", "talia", "florence"]);
  });

  it("Hindi + Shorts → Bunty, Krishna Gupta, Raju (spec order)", () => {
    expect(ids("hi", "shorts_reels")).toEqual(["bunty", "krishna-gupta", "raju"]);
  });

  it("Hindi + Education → Vikram, Aakash (spec order)", () => {
    expect(ids("hi", "educational").slice(0, 2)).toEqual(["vikram", "aakash"]);
  });

  it("Hindi + Emotional → Niraj, Raju, Monika (spec order)", () => {
    expect(ids("hi", "emotional")).toEqual(["niraj", "raju", "monika-sogam"]);
  });

  it("Spanish + Documentary → Alberto, Miguel, David (spec order)", () => {
    expect(ids("es", "documentary")).toEqual(["alberto-rodriguez", "miguel", "david-martin"]);
  });

  it("Spanish + Crime → Carmelo, Miguel (spec order)", () => {
    expect(ids("es", "crime_mystery").slice(0, 2)).toEqual(["carmelo", "miguel"]);
  });

  it("German + Cinematic → Leon, Helmut, Christian (spec order)", () => {
    expect(ids("de", "cinematic")).toEqual(["leon-stern", "helmut-stieglbauer", "christian"]);
  });

  it("German + Documentary → Leon, Helmut, Christian (spec order)", () => {
    expect(ids("de", "documentary")).toEqual(["leon-stern", "helmut-stieglbauer", "christian"]);
  });

  it("German casual creator → Otto first (spec order)", () => {
    expect(ids("de", "entertainment")[0]).toBe("otto");
  });

  it("maps niche 'True Crime' to crime_mystery", () => {
    expect(categoryForNiche("True Crime")).toBe("crime_mystery");
    expect(ids("en", null, "True Crime")).toEqual(ids("en", "crime_mystery"));
  });

  it("returns the language default first when no category is given", () => {
    expect(recommendVoices({ languageCode: "en", limit: 1 })[0]!.character.id).toBe("adam");
    expect(recommendVoices({ languageCode: "hi", limit: 1 })[0]!.character.id).toBe("niraj");
    expect(recommendVoices({ languageCode: "es", limit: 1 })[0]!.character.id).toBe("miguel");
    expect(recommendVoices({ languageCode: "de", limit: 1 })[0]!.character.id).toBe("leon-stern");
  });

  it("is deterministic and ranks are sequential", () => {
    const a = recommendVoices({ languageCode: "en", categoryId: "documentary" });
    const b = recommendVoices({ languageCode: "en", categoryId: "documentary" });
    expect(a.map((r) => r.character.id)).toEqual(b.map((r) => r.character.id));
    expect(a.map((r) => r.rank)).toEqual(a.map((_, i) => i + 1));
  });

  it("onlySynthesizable filters to mapped voices", () => {
    const all = recommendVoices({ languageCode: "en", onlySynthesizable: true });
    expect(all.length).toBeGreaterThan(0);
    for (const r of all) expect(r.character.providerVoiceId).toBeTruthy();
  });

  it("explains rankings with reasons", () => {
    const [top] = topVoices("en", "crime_mystery");
    expect(top!.reasons.length).toBeGreaterThan(0);
    expect(top!.reasons.join(" ")).toMatch(/crime/i);
  });

  it("whyThisVoice produces a one-paragraph explanation", () => {
    const adam = voiceCharacter("adam")!;
    const text = whyThisVoice(adam, "cinematic");
    expect(text).toContain("Adam");
    expect(text).toContain("Cinematic");
  });
});
