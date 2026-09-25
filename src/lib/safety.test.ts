import { describe, expect, it } from "vitest";
import {
  SAFETY_DISCLAIMER,
  SAFETY_SCORE_VERSION,
  bandForScore,
  computeSafetyScore,
  scoreAdvertiser,
  scoreMetadata,
  scorePolicy,
  textSimilarity,
  type SafetyInputs,
} from "./safety";

const CLEAN_SCRIPT = `Welcome back to the channel. Today we are exploring how the
ancient Romans built aqueducts that carried fresh water across entire cities.
Engineers used gravity and precise stone arches. In my opinion, this remains
one of the most impressive achievements of the ancient world. Let's break down
exactly how the gradient worked and what this means for modern plumbing.`;

const BASE_INPUTS: SafetyInputs = {
  script: CLEAN_SCRIPT,
  title: "How Roman Aqueducts Carried Water Across Cities",
  description: "An educational look at Roman engineering. AI-generated visuals.",
  primaryKeyword: "Roman aqueducts",
  assets: [
    { kind: "image", provider: "lovable-gateway", license: "ai-generated" },
    { kind: "voice", provider: "elevenlabs", license: "commercial" },
  ],
  sourceTexts: [],
  madeForKids: false,
  syntheticDisclosed: true,
  hasDisclaimer: false,
};

describe("bandForScore", () => {
  it("maps boundaries correctly", () => {
    expect(bandForScore(100)).toBe("safe");
    expect(bandForScore(90)).toBe("safe");
    expect(bandForScore(89)).toBe("minor");
    expect(bandForScore(70)).toBe("minor");
    expect(bandForScore(69)).toBe("at-risk");
    expect(bandForScore(50)).toBe("at-risk");
    expect(bandForScore(49)).toBe("high-risk");
    expect(bandForScore(0)).toBe("high-risk");
  });
});

describe("computeSafetyScore — fixtures", () => {
  it("clean educational script scores 90+ (safe)", () => {
    const r = computeSafetyScore(BASE_INPUTS);
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.band).toBe("safe");
    expect(r.version).toBe(SAFETY_SCORE_VERSION);
    expect(Number.isInteger(r.score)).toBe(true);
  });

  it("profanity-saturated script drops to at-risk (limited ads likely)", () => {
    const r = computeSafetyScore({
      ...BASE_INPUTS,
      script:
        "What the fuck is up guys. This shit is fucking crazy, these damn aqueducts are a bitch to build. What a hell of a crap project.",
      title: "FUCKING CRAZY AQUEDUCTS YOU WON'T BELIEVE!!!",
    });
    // Heavy profanity = limited ads (at-risk), not a full takedown.
    expect(r.score).toBeGreaterThanOrEqual(50);
    expect(r.score).toBeLessThan(70);
    expect(r.band).toBe("at-risk");
    expect(r.issues.some((i) => i.dimension === "advertiser")).toBe(true);
  });

  it("sexual + violent content drops below 50 (high-risk)", () => {
    const r = computeSafetyScore({
      ...BASE_INPUTS,
      script:
        "This porn-style video shows graphic gore and dismemberment. The torture scenes are bloody and gruesome, a total bloodbath.",
      title: "SHOCKING GORE COMPILATION GONE WRONG",
      description: "",
    });
    expect(r.score).toBeLessThan(50);
    expect(r.band).toBe("high-risk");
    expect(
      r.issues.some((i) => i.dimension === "advertiser" && i.severity === "critical")
    ).toBe(true);
  });

  it("borderline script lands in the 70s (minor)", () => {
    const r = computeSafetyScore({
      ...BASE_INPUTS,
      script: CLEAN_SCRIPT + " This damn project took forever, hell, it was hard work. What crap luck.",
      title: "Shocking Roman Aqueduct Secrets You Won't Believe!",
      description: "",
      madeForKids: null,
    });
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.score).toBeLessThan(90);
    expect(r.band).toBe("minor");
  });

  it("unlicensed assets tank the copyright dimension", () => {
    const r = computeSafetyScore({
      ...BASE_INPUTS,
      assets: [
        { kind: "image", provider: "unknown" },
        { kind: "music", provider: "random-site", license: "unknown" },
      ],
    });
    const copyright = r.dimensions.find((d) => d.dimension === "copyright")!;
    expect(copyright.points).toBeLessThan(copyright.maxPoints);
    expect(r.issues.some((i) => i.dimension === "copyright" && i.severity === "critical")).toBe(true);
  });

  it("near-duplicate of a source tanks originality", () => {
    const source = CLEAN_SCRIPT;
    const r = computeSafetyScore({
      ...BASE_INPUTS,
      sourceTexts: [source],
    });
    const originality = r.dimensions.find((d) => d.dimension === "originality")!;
    expect(originality.points).toBeLessThan(originality.maxPoints);
  });

  it("missing madeForKids deducts policy points", () => {
    const r = computeSafetyScore({ ...BASE_INPUTS, madeForKids: null });
    const policy = r.dimensions.find((d) => d.dimension === "policy")!;
    expect(policy.points).toBeLessThan(policy.maxPoints);
    expect(r.issues.some((i) => i.message.includes("Made-for-kids"))).toBe(true);
  });

  it("medical advice without disclaimer is critical", () => {
    const r = computeSafetyScore({
      ...BASE_INPUTS,
      script: "This cure will treat your disease. Take this dosage daily for best results.",
    });
    expect(r.issues.some((i) => i.message.includes("Medical advice"))).toBe(true);
  });

  it("all dimensions sum to max 100", () => {
    const r = computeSafetyScore(BASE_INPUTS);
    const max = r.dimensions.reduce((s, d) => s + d.maxPoints, 0);
    expect(max).toBe(100);
  });

  it("disclaimer text is honest (no guarantee language)", () => {
    expect(SAFETY_DISCLAIMER).not.toMatch(/guaranteed monetization|100% safe|always approved/i);
    expect(SAFETY_DISCLAIMER).toMatch(/not a guarantee/i);
  });
});

describe("scoreAdvertiser", () => {
  it("records spans for the first hit", () => {
    const d = scoreAdvertiser("This damn thing broke.", "Title", "");
    expect(d.issues.length).toBeGreaterThan(0);
    expect(d.issues[0]!.span).toBeDefined();
  });

  it("caps deductions at the dimension max", () => {
    const d = scoreAdvertiser("fuck ".repeat(50), "shit damn hell", "");
    expect(d.points).toBeGreaterThanOrEqual(0);
  });
});

describe("scoreMetadata", () => {
  it("flags ALL CAPS titles", () => {
    const d = scoreMetadata("THIS IS ALL CAPS TITLE HERE", CLEAN_SCRIPT);
    expect(d.issues.some((i) => i.message.includes("ALL CAPS"))).toBe(true);
  });

  it("flags title/content mismatch", () => {
    const d = scoreMetadata(
      "Quantum Banana Crypto Trading Secrets",
      CLEAN_SCRIPT
    );
    expect(d.issues.some((i) => i.message.includes("barely appear"))).toBe(true);
  });

  it("penalizes classic clickbait", () => {
    const d = scoreMetadata("You won't believe what happened", CLEAN_SCRIPT);
    expect(d.issues.some((i) => i.severity === "critical")).toBe(true);
  });
});

describe("textSimilarity", () => {
  it("identical texts score 1", () => {
    expect(textSimilarity(CLEAN_SCRIPT, CLEAN_SCRIPT)).toBe(1);
  });

  it("unrelated texts score near 0", () => {
    expect(
      textSimilarity("cats love warm sunny windowsills", "quantum physics equations derive energy")
    ).toBeLessThan(0.1);
  });

  it("empty inputs score 0", () => {
    expect(textSimilarity("", CLEAN_SCRIPT)).toBe(0);
  });
});

describe("scorePolicy", () => {
  it("financial advice without disclaimer is critical", () => {
    const d = scorePolicy({
      script: "Invest in this crypto for guaranteed returns, start trading today.",
      madeForKids: false,
      syntheticDisclosed: true,
    });
    expect(d.issues.some((i) => i.message.includes("Financial advice"))).toBe(true);
  });

  it("full compliance keeps full points", () => {
    const d = scorePolicy({
      script: "A calm educational script.",
      madeForKids: false,
      syntheticDisclosed: true,
    });
    expect(d.points).toBe(d.maxPoints);
  });
});
