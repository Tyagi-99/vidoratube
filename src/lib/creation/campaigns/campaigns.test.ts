/**
 * Stream A — F25 campaign builder unit tests. Pure logic; no fabricated data.
 */
import { describe, expect, it } from "vitest";
import {
  assertCampaignTransition,
  buildCampaignPlan,
  CAMPAIGN_FORMATS,
  linkCampaignItemRef,
  type CampaignItem,
} from "./campaigns";

const base = {
  ideaId: "idea-1",
  ideaTitle: "Night Trains",
  ideaHook: "Nobody talks about the secret mistake that killed night trains.",
};

describe("buildCampaignPlan", () => {
  it("builds one item per requested format, deterministically", () => {
    const a = buildCampaignPlan({ ...base, formats: ["longform", "shorts", "titles"] });
    const b = buildCampaignPlan({ ...base, formats: ["longform", "shorts", "titles"] });
    expect(a).toEqual(b);
    expect(a.items.map((i) => i.kind)).toEqual(["script_draft", "shorts_plan", "title_variants"]);
  });

  it("emits all five formats when requested", () => {
    const plan = buildCampaignPlan({ ...base, formats: [...CAMPAIGN_FORMATS] });
    expect(plan.items).toHaveLength(5);
    expect(plan.formats).toEqual([...CAMPAIGN_FORMATS]);
  });

  it("dedupes formats and rejects empty/unknown formats", () => {
    const plan = buildCampaignPlan({
      ...base,
      formats: ["shorts", "shorts", "bogus" as never],
    });
    expect(plan.formats).toEqual(["shorts"]);
    expect(() => buildCampaignPlan({ ...base, formats: [] })).toThrow(/At least one format/);
    expect(() => buildCampaignPlan({ ...base, formats: ["bogus" as never] })).toThrow(
      /At least one format/,
    );
  });

  it("sketches the requested number of shorts (clamped 1..10)", () => {
    const three = buildCampaignPlan({ ...base, formats: ["shorts"] });
    expect(three.items[0]!.detail).toContain("1. Hook cut");
    expect(three.items[0]!.detail).toContain("3. Beat 3");
    const clamped = buildCampaignPlan({ ...base, formats: ["shorts"], shortsCount: 99 });
    expect(clamped.items[0]!.label).toContain("(10 cuts)");
  });

  it("starts every item as planned with a null ref (nothing fabricated)", () => {
    const plan = buildCampaignPlan({ ...base, formats: [...CAMPAIGN_FORMATS] });
    for (const item of plan.items) {
      expect(item.status).toBe("planned");
      expect(item.ref).toBeNull();
    }
  });

  it("wires dependency edges between items", () => {
    const plan = buildCampaignPlan({
      ...base,
      formats: ["longform", "shorts", "titles", "thumbnail_set", "metadata"],
    });
    const byId = Object.fromEntries(plan.items.map((i) => [i.id, i]));
    expect(byId["shorts-plan"]!.dependsOn).toContain("longform-script");
    expect(byId["thumbnail-set"]!.dependsOn).toContain("title-variants");
    expect(byId["metadata-pack"]!.dependsOn).toContain("longform-script");
  });

  it("names the campaign after the idea", () => {
    const plan = buildCampaignPlan({ ...base, formats: ["titles"] });
    expect(plan.name).toBe("Night Trains — campaign");
  });
});

describe("assertCampaignTransition", () => {
  it("allows the draft → in_production → ready flow", () => {
    expect(() => assertCampaignTransition("draft", "in_production")).not.toThrow();
    expect(() => assertCampaignTransition("in_production", "ready")).not.toThrow();
  });

  it("rejects skips and backwards moves", () => {
    expect(() => assertCampaignTransition("draft", "ready")).toThrow(/Illegal campaign transition/);
    expect(() => assertCampaignTransition("ready", "draft")).toThrow(/Illegal campaign transition/);
    expect(() => assertCampaignTransition("ready", "in_production")).toThrow(
      /Illegal campaign transition/,
    );
  });
});

describe("linkCampaignItemRef", () => {
  const items: CampaignItem[] = buildCampaignPlan({ ...base, formats: ["longform"] }).items;

  it("attaches a real ref and flips the item to created", () => {
    const updated = linkCampaignItemRef(items, "longform-script", {
      type: "script",
      id: "script-1",
    });
    const item = updated.find((i) => i.id === "longform-script")!;
    expect(item.status).toBe("created");
    expect(item.ref).toEqual({ type: "script", id: "script-1" });
  });

  it("throws on unknown item ids", () => {
    expect(() => linkCampaignItemRef(items, "nope", { type: "script", id: "x" })).toThrow(
      /Unknown campaign item/,
    );
  });

  it("does not mutate the input array", () => {
    linkCampaignItemRef(items, "longform-script", { type: "script", id: "s1" });
    expect(items[0]!.status).toBe("planned");
  });
});
