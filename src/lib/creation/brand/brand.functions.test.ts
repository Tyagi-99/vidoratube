/**
 * Stream A — F13 server-function unit tests (pure pieces: schemas,
 * vocabulary normalization, Stream-B binding helper with a fake AdminDb).
 */
import { describe, expect, it } from "vitest";
import {
  createBrandProfileSchema,
  normalizeVocabulary,
  resolveBrandProfileForUser,
  updateBrandProfileSchema,
  type BrandProfileRow,
} from "./brand.functions";
import type { AdminDb } from "../../intelligence/youtube-api.server";

const profile = (id: string, user: string): BrandProfileRow => ({
  id,
  user_id: user,
  workspace_id: null,
  name: `Profile ${id}`,
  tone: "bold",
  vocabulary: { preferred: ["cinematic"] },
  persona: "",
  do_list: [],
  dont_list: [],
  sample_text: "",
  created_at: "2026-09-28T00:00:00Z",
  updated_at: "2026-09-28T00:00:00Z",
});

/** Minimal fake AdminDb serving canned profile rows. */
function fakeAdmin(rows: BrandProfileRow[]): AdminDb {
  const terminal = {
    // resolveBrandProfileForUser: select().eq().limit()
    limit: () => Promise.resolve({ data: rows, error: null }),
    // ownProfile: select().eq().eq().maybeSingle()
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
  };
  const chainable = {
    ...terminal,
    eq: () => chainable,
  };
  return {
    from: () => ({ select: () => chainable }),
  } as unknown as AdminDb;
}

describe("normalizeVocabulary", () => {
  it("splits comma-separated strings into lists", () => {
    expect(normalizeVocabulary({ preferred: "cinematic, punchy ", avoid: ["clickbait"] })).toEqual({
      preferred: ["cinematic", "punchy"],
      avoid: ["clickbait"],
    });
  });

  it("defaults to empty lists and keeps extras", () => {
    expect(normalizeVocabulary({ extra: { register: "formal" } })).toEqual({
      preferred: [],
      avoid: [],
      register: "formal",
    });
  });
});

describe("schemas", () => {
  it("createBrandProfileSchema requires a name and caps lengths", () => {
    expect(() => createBrandProfileSchema.parse({ name: "" })).toThrow();
    expect(() => createBrandProfileSchema.parse({ name: "x".repeat(81) })).toThrow();
    const ok = createBrandProfileSchema.parse({ name: "Documentary" });
    expect(ok.doList).toEqual([]);
    expect(ok.vocabulary).toEqual({});
  });

  it("createBrandProfileSchema rejects oversized do/dont lists", () => {
    expect(() =>
      createBrandProfileSchema.parse({ name: "x", doList: Array(51).fill("a") }),
    ).toThrow();
  });

  it("updateBrandProfileSchema allows partial patches", () => {
    const ok = updateBrandProfileSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      tone: "warm",
    });
    expect(ok.tone).toBe("warm");
    expect(ok.name).toBeUndefined();
  });
});

describe("resolveBrandProfileForUser (Stream B binding)", () => {
  const user = "22222222-2222-4222-8222-222222222222";

  it("returns the requested profile when owned", async () => {
    const admin = fakeAdmin([profile("a", user), profile("b", user)]);
    const resolved = await resolveBrandProfileForUser(admin, user, "b");
    expect(resolved?.id).toBe("b");
  });

  it("returns null for a requested id the user does not own", async () => {
    const admin = fakeAdmin([profile("a", user)]);
    expect(await resolveBrandProfileForUser(admin, user, "zzz")).toBeNull();
  });

  it("returns the single profile when none is requested", async () => {
    const admin = fakeAdmin([profile("a", user)]);
    expect((await resolveBrandProfileForUser(admin, user))?.id).toBe("a");
  });

  it("returns null (ask the user) when several exist and none requested", async () => {
    const admin = fakeAdmin([profile("a", user), profile("b", user)]);
    expect(await resolveBrandProfileForUser(admin, user)).toBeNull();
  });

  it("returns null when the user has no profiles", async () => {
    const admin = fakeAdmin([]);
    expect(await resolveBrandProfileForUser(admin, user)).toBeNull();
  });
});
