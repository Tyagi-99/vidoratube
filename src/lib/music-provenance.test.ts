import { describe, expect, it } from "vitest";
import {
  filterProvenCatalogTracks,
  hasMusicProvenance,
  provenanceGap,
  PROVENANCE_EQUIVALENT_LICENSES,
} from "./music-provenance";

const full = {
  provider: "jamendo",
  license: "Creative Commons (see license_url)",
  license_url: "https://creativecommons.org/licenses/by/3.0/",
};

describe("music provenance gate", () => {
  it("accepts a track with full provenance", () => {
    expect(hasMusicProvenance(full)).toBe(true);
    expect(provenanceGap(full)).toBeNull();
  });

  it("excludes a track with a missing license_url", () => {
    const track = { ...full, license_url: null };
    expect(hasMusicProvenance(track)).toBe(false);
    expect(provenanceGap(track)).toBe("missing license_url");
  });

  it("excludes a track with a blank license_url", () => {
    expect(hasMusicProvenance({ ...full, license_url: "  " })).toBe(false);
  });

  it("excludes tracks missing provider or license", () => {
    expect(provenanceGap({ ...full, provider: null })).toBe("missing provider");
    expect(provenanceGap({ ...full, provider: " " })).toBe("missing provider");
    expect(provenanceGap({ ...full, license: null })).toBe("missing license");
    expect(provenanceGap({ ...full, license: "" })).toBe("missing license");
  });

  it("accepts documented equivalents without a license_url", () => {
    for (const license of PROVENANCE_EQUIVALENT_LICENSES) {
      expect(hasMusicProvenance({ provider: "catalog", license, license_url: null })).toBe(true);
    }
  });

  it("splits rows into selectable and excluded with reasons", () => {
    const rows = [
      { id: "a", ...full },
      { id: "b", ...full, license_url: null },
      { id: "c", ...full, provider: "" },
    ];
    const { selectable, excluded } = filterProvenCatalogTracks(rows);
    expect(selectable.map((t) => t.id)).toEqual(["a"]);
    expect(excluded.map((e) => e.track.id)).toEqual(["b", "c"]);
    expect(excluded[0]!.reason).toBe("missing license_url");
    expect(excluded[1]!.reason).toBe("missing provider");
  });

  it("every selectable track has provenance", () => {
    const rows = [
      { ...full },
      { ...full, license_url: null },
      { provider: "jamendo", license: "Public domain", license_url: null },
    ];
    const { selectable } = filterProvenCatalogTracks(rows);
    expect(selectable.length).toBeGreaterThan(0);
    for (const t of selectable) expect(hasMusicProvenance(t)).toBe(true);
  });
});
