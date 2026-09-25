import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  brandName,
  entityLine,
  governingLawLine,
  hasGrievanceOfficer,
  legalConfig,
} from "./legal";

/**
 * Legal config guardrails.
 *
 * Until the founder fills in docs/FOUNDER_TODO.md items, every field is
 * empty — and public pages must still read naturally. These tests pin the
 * neutral fallbacks and forbid placeholder text ("[FILL]", "TODO", "XXX")
 * from ever reaching Terms/Privacy.
 */
describe("legal config", () => {
  it("brand name always has a safe value", () => {
    expect(brandName()).toBeTruthy();
    expect(brandName()).not.toMatch(/\[FILL\]/i);
  });

  it("entity line is neutral when the entity is unknown", () => {
    const line = entityLine();
    expect(line).toBeTruthy();
    expect(line).not.toMatch(/\[FILL\]|TODO|XXX/i);
    if (!legalConfig.entityName) {
      expect(line).toBe("Vidora AI");
    }
  });

  it("governing law defaults to India with no placeholders", () => {
    const line = governingLawLine();
    expect(line).toContain("India");
    expect(line).not.toMatch(/\[FILL\]|TODO|XXX/i);
  });

  it("grievance officer is unset until configured", () => {
    if (!legalConfig.grievanceName || !legalConfig.grievanceEmail) {
      expect(hasGrievanceOfficer()).toBe(false);
    } else {
      expect(hasGrievanceOfficer()).toBe(true);
    }
  });

  it("Terms and Privacy contain no placeholder text", () => {
    const src = resolve(process.cwd(), "src");
    for (const route of ["terms.tsx", "privacy.tsx"]) {
      const text = readFileSync(join(src, "routes", route), "utf8");
      expect(text, `${route} must not contain [FILL]`).not.toMatch(/\[FILL\]/);
      // Placeholder-looking TODOs in rendered copy (code comments are fine,
      // but none of these files should have them either).
      expect(text, `${route} must not contain TODO placeholders`).not.toMatch(/TODO:/);
    }
  });
});
