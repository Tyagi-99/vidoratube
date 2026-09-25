import { describe, expect, it } from "vitest";
import {
  CREATION_MODES,
  creationModeHref,
  parseCreateMode,
  studioSearchFromUnknown,
} from "./creation-modes";

describe("home creation modes", () => {
  it("exposes three home links that open a page, not a dialog", () => {
    expect(CREATION_MODES.map((mode) => mode.id)).toEqual(["script", "voiceover", "auto_edit"]);
    expect(CREATION_MODES.every((mode) => mode.href.startsWith("/studio?create="))).toBe(true);
    expect(creationModeHref("script")).toBe("/studio?create=script");
  });

  it("ignores unknown create query values", () => {
    expect(parseCreateMode("script")).toBe("script");
    expect(parseCreateMode("nope")).toBeNull();
    expect(parseCreateMode(null)).toBeNull();
  });

  it("reads create from router search on the first render", () => {
    expect(studioSearchFromUnknown({ create: "script" })).toEqual({ create: "script" });
    expect(studioSearchFromUnknown({ create: "voiceover" })).toEqual({ create: "voiceover" });
    expect(studioSearchFromUnknown({})).toEqual({});
    expect(studioSearchFromUnknown({ create: ["script"] })).toEqual({});
  });

  it("whitelists the YouTube OAuth callback params and strips everything else", () => {
    // The callback redirects to /studio?youtube=connected|error&reason=…
    expect(studioSearchFromUnknown({ youtube: "connected" })).toEqual({ youtube: "connected" });
    expect(studioSearchFromUnknown({ youtube: "error", reason: "access_denied" })).toEqual({
      youtube: "error",
      reason: "access_denied",
    });
    // Invalid values are stripped, not passed through.
    expect(studioSearchFromUnknown({ youtube: "hacked" })).toEqual({});
    // reason is only kept for the error case.
    expect(studioSearchFromUnknown({ youtube: "connected", reason: "x" })).toEqual({
      youtube: "connected",
    });
    // Unrelated params never leak through.
    expect(studioSearchFromUnknown({ create: "script", foo: "bar" })).toEqual({ create: "script" });
  });
});
