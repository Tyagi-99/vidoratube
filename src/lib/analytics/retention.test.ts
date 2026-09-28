import { describe, expect, it } from "vitest";
import { diagnoseRetention, MIN_RETENTION_POINTS } from "./retention";

const scenes = [
  { id: "s1", scene_number: 1 },
  { id: "s2", scene_number: 2 },
  { id: "s3", scene_number: 3 },
  { id: "s4", scene_number: 4 },
];

describe("diagnoseRetention", () => {
  it("returns insufficient_data when there are too few points (no invented points)", () => {
    const d = diagnoseRetention(
      [{ t: 0, r: 100, scene_id: "s1" }, { t: 10, r: 90, scene_id: "s2" }],
      scenes,
    );
    expect(d.status).toBe("insufficient_data");
    expect(d.pointCount).toBe(2);
    expect(d.weakestScene).toBeNull();
  });

  it("requires at least MIN_RETENTION_POINTS", () => {
    expect(MIN_RETENTION_POINTS).toBeGreaterThanOrEqual(4);
  });

  it("diagnoses the scene with the biggest drop below the hook baseline", () => {
    const d = diagnoseRetention(
      [
        { t: 0, r: 100, scene_id: "s1" },
        { t: 15, r: 95, scene_id: "s1" },
        { t: 30, r: 92, scene_id: "s2" },
        { t: 45, r: 60, scene_id: "s2" }, // big drop here
        { t: 60, r: 58, scene_id: "s3" },
        { t: 90, r: 40, scene_id: "s4" },
      ],
      scenes,
    );
    expect(d.status).toBe("ok");
    // hook baseline = (100+95+92)/3 ≈ 95.7; biggest drop is the 40 @ t=90 → scene 4
    expect(d.weakestScene?.scene_id).toBe("s4");
    expect(d.weakestScene?.scene_number).toBe(4);
    expect(d.weakestScene?.atSeconds).toBe(90);
    expect(d.weakestScene?.dropPoints).toBeCloseTo(95.667 - 40, 2);
    expect(d.weakestScene?.diagnosis).toMatch(/scene 4/i);
    expect(d.weakestScene?.diagnosis).toMatch(/late/i); // 90/90 → late-video template
  });

  it("uses the early-drop template for drops in the first quarter", () => {
    const d = diagnoseRetention(
      [
        { t: 0, r: 100, scene_id: "s1" },
        { t: 5, r: 98, scene_id: "s1" },
        { t: 10, r: 96, scene_id: "s1" },
        { t: 15, r: 50, scene_id: "s2" },
        { t: 60, r: 60, scene_id: "s3" },
        { t: 120, r: 58, scene_id: "s4" },
      ],
      scenes,
    );
    expect(d.weakestScene?.scene_id).toBe("s2");
    expect(d.weakestScene?.diagnosis).toMatch(/hook/i);
  });

  it("reports no weakest scene when retention never dips below the hook", () => {
    const d = diagnoseRetention(
      [
        { t: 0, r: 90, scene_id: "s1" },
        { t: 10, r: 90, scene_id: "s2" },
        { t: 20, r: 90, scene_id: "s3" },
        { t: 30, r: 90, scene_id: "s4" },
      ],
      scenes,
    );
    expect(d.status).toBe("ok");
    expect(d.weakestScene).toBeNull();
  });

  it("counts unattributed points and skips malformed entries without inventing data", () => {
    const d = diagnoseRetention(
      [
        { t: 0, r: 100, scene_id: "s1" },
        { t: 10, r: 95 }, // no scene_id
        { t: 20, r: 90, scene_id: "s2" },
        { t: 30, r: 40, scene_id: "s2" },
        { t: "bad", r: 10, scene_id: "s3" }, // malformed — dropped
      ],
      scenes,
    );
    expect(d.pointCount).toBe(4);
    expect(d.unattributedPoints).toBe(1);
    expect(d.weakestScene?.scene_id).toBe("s2");
  });

  it("handles scenes unknown to the project (null scene_number, still honest)", () => {
    const d = diagnoseRetention(
      [
        { t: 0, r: 100, scene_id: "s1" },
        { t: 10, r: 98, scene_id: "s1" },
        { t: 20, r: 96, scene_id: "s1" },
        { t: 30, r: 30, scene_id: "ghost" },
      ],
      scenes,
    );
    expect(d.weakestScene?.scene_id).toBe("ghost");
    expect(d.weakestScene?.scene_number).toBeNull();
    expect(d.weakestScene?.diagnosis).toMatch(/this section/);
  });
});
