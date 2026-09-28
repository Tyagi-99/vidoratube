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
  it("English + Crime & Mystery → Sawyer, Adam, then best residual (Florence)", () => {
    // Spec's headline order for the top two; the third slot goes to the
    // highest-scoring remaining voice by the same rule (Florence carries
    // the crime_mystery tag and outranks Finley here).
    expect(ids("en", "crime_mystery")).toEqual(["sawyer", "adam", "florence"]);
  });

  it("English + Beauty → Jade, Talia, then best residual (Adam)", () => {
    expect(ids("en", "lifestyle_beauty")).toEqual(["jade", "talia", "adam"]);
  });

  it("Hindi + Shorts → Bunty, Krishna Gupta, then best residual (Niraj)", () => {
    expect(ids("hi", "shorts_reels")).toEqual(["bunty", "krishna-gupta", "niraj"]);
  });

  it("Spanish + Documentary top-3 set is Miguel, Alberto, David", () => {
    const got = new Set(ids("es", "documentary"));
    expect(got).toEqual(new Set(["miguel", "alberto-rodriguez", "david-martin"]));
  });

  it("German + Cinematic top-3 set is Leon, Helmut, Christian", () => {
    const got = new Set(ids("de", "cinematic"));
    expect(got).toEqual(new Set(["leon-stern", "helmut-stieglbauer", "christian"]));
  });

  it("Hindi + Emotional ranks Niraj first", () => {
    const top = topVoices("hi", "emotional");
    expect(top[0]!.character.id).toBe("niraj");
    expect(top.map((r) => r.character.id)).toContain("monika-sogam");
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
