import { describe, expect, it } from "vitest";
import {
  computeNps,
  npsCategory,
  recentComments,
  validateNpsScore,
} from "./nps";

describe("validateNpsScore", () => {
  it("accepts integers 0-10", () => {
    expect(validateNpsScore(0)).toBe(0);
    expect(validateNpsScore(10)).toBe(10);
  });

  it("rejects anything else", () => {
    expect(() => validateNpsScore(-1)).toThrow();
    expect(() => validateNpsScore(11)).toThrow();
    expect(() => validateNpsScore(7.5)).toThrow();
    expect(() => validateNpsScore("9")).toThrow();
  });
});

describe("npsCategory", () => {
  it("classifies promoters / passives / detractors", () => {
    expect(npsCategory(9)).toBe("promoter");
    expect(npsCategory(10)).toBe("promoter");
    expect(npsCategory(7)).toBe("passive");
    expect(npsCategory(8)).toBe("passive");
    expect(npsCategory(6)).toBe("detractor");
    expect(npsCategory(0)).toBe("detractor");
  });
});

describe("computeNps", () => {
  it("returns hasData:false with no responses (never a fake 0)", () => {
    const s = computeNps([]);
    expect(s.hasData).toBe(false);
    expect(s.nps).toBeNull();
  });

  it("computes %promoters - %detractors", () => {
    // 5 promoters, 2 passives, 3 detractors -> (50 - 30) = 20
    const s = computeNps([
      ...[10, 10, 9, 10, 9].map((score) => ({ score, createdAt: "2026-09-01" })),
      ...[7, 8].map((score) => ({ score, createdAt: "2026-09-01" })),
      ...[6, 2, 0].map((score) => ({ score, createdAt: "2026-09-01" })),
    ]);
    expect(s.hasData).toBe(true);
    expect(s.total).toBe(10);
    expect(s.promoters).toBe(5);
    expect(s.passives).toBe(2);
    expect(s.detractors).toBe(3);
    expect(s.nps).toBe(20);
  });

  it("can go negative", () => {
    const s = computeNps([
      { score: 10, createdAt: "2026-09-01" },
      { score: 0, createdAt: "2026-09-01" },
      { score: 1, createdAt: "2026-09-01" },
    ]);
    expect(s.nps).toBe(-33); // (33.3 - 66.7) rounded
  });
});

describe("recentComments", () => {
  it("returns only non-empty comments, trimmed", () => {
    const out = recentComments([
      { score: 10, comment: "  Love it  ", createdAt: "2026-09-01" },
      { score: 5, comment: "", createdAt: "2026-09-01" },
      { score: 2, createdAt: "2026-09-01" },
    ]);
    expect(out).toEqual([
      { score: 10, comment: "Love it", createdAt: "2026-09-01" },
    ]);
  });
});
