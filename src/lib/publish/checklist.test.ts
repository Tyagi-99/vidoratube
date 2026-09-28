/**
 * Phase 6 Stream E (P6) — packaging checklist pure tests.
 */
import { describe, expect, it } from "vitest";
import {
  CHECKLIST_RULES,
  CHECKLIST_VERSION,
  evaluateChecklist,
  openFindings,
} from "./checklist";

const full = {
  title: "Night Trains of Europe: The Untold Story",
  description:
    "We ride the sleeper trains across Europe — routes, prices, and what nobody tells you. Chapters below.",
  tags: ["night trains", "europe", "travel"],
  privacy: "public",
  safety_score: 82,
  scheduled_for: null,
};

describe("checklist rules", () => {
  it("pins a version and stable rule ids", () => {
    expect(CHECKLIST_VERSION).toBe(1);
    const ids = CHECKLIST_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("tags_count");
    expect(ids).toContain("title_present");
  });

  it("passes a fully packaged job", () => {
    const findings = evaluateChecklist(full);
    expect(openFindings(findings)).toEqual([]);
    expect(findings).toHaveLength(CHECKLIST_RULES.length);
  });

  it("fails missing title/description/privacy as fails", () => {
    const findings = evaluateChecklist({ ...full, title: "", description: "", privacy: null });
    const fails = openFindings(findings).filter((f) => f.severity === "fail");
    expect(fails.map((f) => f.id)).toEqual(
      expect.arrayContaining(["title_present", "description_present", "privacy_set"]),
    );
  });

  it("warns on thin packaging (tags, description length, safety unscored)", () => {
    const findings = evaluateChecklist({
      ...full,
      tags: ["one"],
      description: "short",
      safety_score: null,
    });
    const open = openFindings(findings);
    expect(open.map((f) => f.id)).toEqual(
      expect.arrayContaining(["tags_count", "description_length", "safety_scored"]),
    );
    expect(open.every((f) => f.severity === "warn")).toBe(true);
  });

  it("warns on a schedule in the past, not on unscheduled", () => {
    const past = evaluateChecklist({
      ...full,
      scheduled_for: "2020-01-01T00:00:00.000Z",
    });
    expect(openFindings(past).some((f) => f.id === "schedule_future")).toBe(true);
    const unscheduled = evaluateChecklist({ ...full, scheduled_for: null });
    expect(openFindings(unscheduled).some((f) => f.id === "schedule_future")).toBe(false);
  });

  it("never invents values — details report the actual input", () => {
    const findings = evaluateChecklist({ ...full, tags: [] });
    const tags = findings.find((f) => f.id === "tags_count");
    expect(tags?.detail).toBe("0 tags");
  });

  it("is deterministic", () => {
    expect(evaluateChecklist(full)).toEqual(evaluateChecklist(full));
  });
});
