/**
 * Stream A — F25 server-function unit tests (pure pieces: metadata builder,
 * input schemas).
 */
import { describe, expect, it } from "vitest";
import {
  advanceCampaignSchema,
  buildPackageMetadata,
  createCampaignSchema,
  linkCampaignItemSchema,
} from "./campaigns.functions";

const idea = { id: "idea-1", title: "Night Trains", hook: "A hook." };
const items = [
  {
    id: "longform-script",
    kind: "script_draft" as const,
    label: "Long-form script draft",
    detail: "d",
    status: "planned" as const,
    ref: null,
    dependsOn: [],
  },
];

describe("buildPackageMetadata", () => {
  it("embeds the idea snapshot and items with stream provenance", () => {
    const meta = buildPackageMetadata(idea, items);
    expect(meta.idea).toEqual(idea);
    expect(meta.items).toEqual(items);
    expect(meta.stream).toBe("phase3/stream-a");
  });
});

describe("schemas", () => {
  const ideaId = "11111111-1111-4111-8111-111111111111";
  const campaignId = "22222222-2222-4222-8222-222222222222";

  it("createCampaignSchema requires an idea and 1–5 valid formats", () => {
    const ok = createCampaignSchema.parse({ ideaId, formats: ["longform", "shorts"] });
    expect(ok.shortsCount).toBe(3);
    expect(() => createCampaignSchema.parse({ ideaId, formats: [] })).toThrow();
    expect(() => createCampaignSchema.parse({ ideaId, formats: ["bogus"] })).toThrow();
  });

  it("advanceCampaignSchema only allows pinned statuses", () => {
    expect(advanceCampaignSchema.parse({ campaignId, to: "in_production" }).to).toBe(
      "in_production",
    );
    expect(() => advanceCampaignSchema.parse({ campaignId, to: "published" })).toThrow();
  });

  it("linkCampaignItemSchema validates the artifact ref", () => {
    const ok = linkCampaignItemSchema.parse({
      campaignId,
      itemId: "longform-script",
      ref: { type: "script", id: ideaId },
    });
    expect(ok.ref.type).toBe("script");
    expect(() =>
      linkCampaignItemSchema.parse({
        campaignId,
        itemId: "x",
        ref: { type: "bogus", id: ideaId },
      }),
    ).toThrow();
  });
});
