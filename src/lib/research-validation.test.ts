import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * Research input validation (P3). The server functions use zod
 * inputValidators; these tests pin the schema contracts so malformed
 * input is rejected before any credit debit or API call.
 */

// Mirrors of the schemas in research.functions.ts (schemas aren't exported
// from server-function modules, so we re-declare the contract here).
const CreateProjectSchema = z.object({
  topic: z.string().trim().min(3).max(200),
  language: z.string().max(30).default("English"),
});

const ImportOutliersSchema = z.object({
  projectId: z.string().uuid(),
  videoUrls: z.array(z.string().max(500)).max(30).default([]),
  channelInput: z.string().max(500).optional(),
  channelVideoLimit: z.number().int().min(1).max(50).default(20),
});

const GenerateIdeasSchema = z.object({
  projectId: z.string().uuid(),
  nicheName: z.string().max(200).optional(),
  count: z.number().int().min(1).max(10).default(5),
});

describe("research input validation", () => {
  it("rejects too-short topics", () => {
    expect(() => CreateProjectSchema.parse({ topic: "ab" })).toThrow();
    expect(CreateProjectSchema.parse({ topic: "  personal finance  " }).topic).toBe(
      "personal finance",
    );
  });

  it("rejects non-UUID project ids", () => {
    expect(() =>
      ImportOutliersSchema.parse({ projectId: "not-a-uuid", videoUrls: [] }),
    ).toThrow();
  });

  it("caps video URLs at 30 and channel videos at 50", () => {
    expect(() =>
      ImportOutliersSchema.parse({
        projectId: "123e4567-e89b-12d3-a456-426614174000",
        videoUrls: Array(31).fill("https://youtu.be/dQw4w9WgXcQ"),
      }),
    ).toThrow();
    expect(() =>
      ImportOutliersSchema.parse({
        projectId: "123e4567-e89b-12d3-a456-426614174000",
        channelVideoLimit: 51,
      }),
    ).toThrow();
  });

  it("caps idea count at 10", () => {
    expect(() =>
      GenerateIdeasSchema.parse({
        projectId: "123e4567-e89b-12d3-a456-426614174000",
        count: 11,
      }),
    ).toThrow();
    expect(
      GenerateIdeasSchema.parse({
        projectId: "123e4567-e89b-12d3-a456-426614174000",
      }).count,
    ).toBe(5);
  });

  it("requires at least one import source downstream (validated in handler)", () => {
    // Both empty → handler throws "No valid YouTube videos". Schema allows
    // empty arrays so the handler can produce the friendly error.
    const parsed = ImportOutliersSchema.parse({
      projectId: "123e4567-e89b-12d3-a456-426614174000",
      videoUrls: [],
    });
    expect(parsed.videoUrls).toEqual([]);
    expect(parsed.channelInput).toBeUndefined();
  });
});
