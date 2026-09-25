import { describe, expect, it } from "vitest";
import { formatSrtTimecode } from "./srt";

describe("formatSrtTimecode", () => {
  it("formats zero", () => {
    expect(formatSrtTimecode(0)).toBe("00:00:00,000");
  });

  it("formats a typical cue time", () => {
    expect(formatSrtTimecode(75.25)).toBe("00:01:15,250");
  });

  it("carries into seconds instead of emitting ,1000", () => {
    // The old per-component rounding produced the invalid "00:00:01,1000".
    expect(formatSrtTimecode(1.9996)).toBe("00:00:02,000");
    expect(formatSrtTimecode(59.9999)).toBe("00:01:00,000");
  });

  it("carries into minutes and hours", () => {
    expect(formatSrtTimecode(3599.9999)).toBe("01:00:00,000");
    expect(formatSrtTimecode(3723.456)).toBe("01:02:03,456");
  });

  it("clamps negatives to zero", () => {
    expect(formatSrtTimecode(-2)).toBe("00:00:00,000");
  });
});
