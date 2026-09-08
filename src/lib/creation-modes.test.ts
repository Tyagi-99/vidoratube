import { describe, expect, it } from "vitest";
import { CREATION_MODES, creationModeHref, parseCreateMode } from "./creation-modes";

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
});
