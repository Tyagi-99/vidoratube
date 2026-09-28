/**
 * Phase 4 Stream D: comment intelligence primitive tests.
 * Rule-based classifiers must be deterministic and honest — no invented
 * confidence, no network.
 */
import { describe, expect, it } from "vitest";
import { classifySentiment, isQuestion, mineAudienceRequest } from "./sentiment";

describe("classifySentiment", () => {
  it("detects positive comments", () => {
    expect(classifySentiment("This video is amazing, thank you so much!")).toBe("positive");
    expect(classifySentiment("Loved every second of this. Brilliant work.")).toBe("positive");
  });

  it("detects negative comments", () => {
    expect(classifySentiment("This was terrible and boring, worst video ever")).toBe("negative");
    expect(classifySentiment("Clickbait trash, unsubscribed")).toBe("negative");
  });

  it("returns neutral when nothing fires", () => {
    expect(classifySentiment("First")).toBe("neutral");
    expect(classifySentiment("")).toBe("neutral");
    expect(classifySentiment("watching this at 3am")).toBe("neutral");
  });

  it("returns mixed when positive and negative signals are both strong", () => {
    expect(classifySentiment("Amazing editing but the audio was terrible and boring")).toBe(
      "mixed",
    );
  });

  it("is deterministic across repeated calls", () => {
    const t = "I love this channel, best content on YouTube";
    expect(classifySentiment(t)).toBe(classifySentiment(t));
  });
});

describe("isQuestion", () => {
  it("flags explicit question marks", () => {
    expect(isQuestion("What camera do you use?")).toBe(true);
  });

  it("flags question starters without a question mark", () => {
    expect(isQuestion("how do i enable captions on this")).toBe(true);
    expect(isQuestion("can you share the preset")).toBe(true);
  });

  it("flags question phrases", () => {
    expect(isQuestion("does anyone know the song name")).toBe(true);
    expect(isQuestion("please explain the ending")).toBe(true);
  });

  it("does not flag statements", () => {
    expect(isQuestion("Great video, keep it up")).toBe(false);
    expect(isQuestion("")).toBe(false);
  });
});

describe("mineAudienceRequest", () => {
  it("detects 'can you make a video about X' requests with the topic", () => {
    const r = mineAudienceRequest("Can you please make a video about night trains in India");
    expect(r).not.toBeNull();
    expect(r!.topic.toLowerCase()).toContain("night trains");
  });

  it("detects 'would love a video' requests", () => {
    const r = mineAudienceRequest("Would love a video on budget microphones!");
    expect(r).not.toBeNull();
    expect(r!.topic.toLowerCase()).toContain("budget microphones");
  });

  it("detects part-2 requests", () => {
    expect(mineAudienceRequest("part 2 please!!")).not.toBeNull();
  });

  it("returns null for non-requests — never invents a request", () => {
    expect(mineAudienceRequest("Great video")).toBeNull();
    expect(mineAudienceRequest("What camera is this?")).toBeNull();
    expect(mineAudienceRequest("")).toBeNull();
  });
});
