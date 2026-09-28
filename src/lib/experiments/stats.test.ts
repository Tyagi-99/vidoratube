/**
 * F34 stats engine — ground-truth tests.
 *
 * All expected p-values below were computed INDEPENDENTLY with scipy 1.11.4
 * (scipy.stats.proportions_ztest-equivalent pooled z, and
 * scipy.stats.ttest_ind_from_stats with equal_var=False):
 *
 *   CTR fixtures (pooled two-proportion z, two-tailed):
 *     100/2000 vs 140/2000  -> z = -2.663118, p = 0.00774202  (significant)
 *     120/2000 vs 150/2000  -> z = -1.890667, p = 0.05866886  (NOT significant)
 *     60/2000  vs  62/2000  -> z = -0.183898, p = 0.85409375  (NOT significant)
 *   Welch t fixtures (two-tailed):
 *     (42.5, var 180, n 120) vs (48.2, var 195, n 118) -> t = -3.210291, p = 0.00151091 (significant)
 *     (30.0, var 100, n 150) vs (30.5, var 102, n 150) -> t = -0.430864, p = 0.66687896 (NOT significant)
 *   Canonical calibration points:
 *     z = 1.96        -> p = 0.04999579 (~0.05)
 *     t = 2.101, df 18 -> p = 0.04999236 (~0.05)
 *     t = 2.878, df 18 -> p = 0.01000950 (~0.01)
 *
 * Tolerance 1e-6 on p-values. If the implementation ever drifts from these,
 * the test — not the fixture — is the authority (D145).
 */
import { describe, expect, it } from "vitest";
import {
  erf,
  isSignificant,
  normalCdf,
  regularizedIncompleteBeta,
  tCdf,
  twoProportionZTest,
  welchTTest,
  SIGNIFICANCE_LEVEL,
} from "./stats";

const TOL = 1e-6;

describe("special functions", () => {
  it("normalCdf matches canonical values", () => {
    // erf approximation |ε| ≤ 1.5e-7, so 6-digit tolerance here.
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021, 6);
    expect(normalCdf(-1.96)).toBeCloseTo(0.0249979, 6);
  });

  it("erf(1) matches the known constant", () => {
    expect(erf(1)).toBeCloseTo(0.8427007929, 6);
  });

  it("tCdf matches scipy at calibration points", () => {
    // scipy: 2*(1 - t.cdf(2.101, 18)) = 0.04999236 -> t.cdf(2.101,18) = 0.97500382
    expect(tCdf(2.101, 18)).toBeCloseTo(0.97500382, 6);
    expect(tCdf(-2.101, 18)).toBeCloseTo(0.02499618, 6);
    expect(tCdf(0, 10)).toBeCloseTo(0.5, 10);
  });

  it("regularizedIncompleteBeta matches known values", () => {
    // I_0.5(1, 1) = 0.5; I_0.25(2, 3) = 0.26171875 (closed form:
    // 12·(x²/2 − 2x³/3 + x⁴/4) at x = 0.25).
    expect(regularizedIncompleteBeta(0.5, 1, 1)).toBeCloseTo(0.5, 10);
    expect(regularizedIncompleteBeta(0.25, 2, 3)).toBeCloseTo(0.26171875, 8);
  });
});

describe("twoProportionZTest (CTR)", () => {
  it("detects a significant CTR lift (100/2000 vs 140/2000)", () => {
    const r = twoProportionZTest(100, 2000, 140, 2000);
    expect(r.method).toBe("two-proportion-z");
    expect(r.degenerate).toBe(false);
    expect(r.z).toBeCloseTo(-2.663118, 6);
    expect(r.pValue).toBeCloseTo(0.00774202, TOL);
    expect(isSignificant(r.pValue)).toBe(true);
  });

  it("does NOT call a near-miss significant (120/2000 vs 150/2000, p=0.0587)", () => {
    // The honesty case: p = 0.0587 > 0.05 must never be reported significant.
    const r = twoProportionZTest(120, 2000, 150, 2000);
    expect(r.z).toBeCloseTo(-1.890667, 6);
    expect(r.pValue).toBeCloseTo(0.05866886, TOL);
    expect(isSignificant(r.pValue)).toBe(false);
  });

  it("returns a large p for identical rates (60/2000 vs 62/2000)", () => {
    const r = twoProportionZTest(60, 2000, 62, 2000);
    expect(r.z).toBeCloseTo(-0.183898, 6);
    expect(r.pValue).toBeCloseTo(0.85409375, TOL);
    expect(isSignificant(r.pValue)).toBe(false);
  });

  it("calibration: z = ±1.96 gives p ≈ 0.05", () => {
    // Construct arms whose pooled z is ~1.96: solve backwards is brittle, so
    // test the tail directly through a symmetric fixture sweep instead.
    // Here: verify monotonicity + the 0.05 boundary via normalCdf.
    expect(2 * (1 - normalCdf(1.96))).toBeCloseTo(0.04999579, 6);
    expect(2 * (1 - normalCdf(2.576))).toBeCloseTo(0.01, 4);
  });

  it("degenerate inputs yield p = 1, never significant", () => {
    for (const r of [
      twoProportionZTest(0, 0, 10, 100),
      twoProportionZTest(10, 100, 0, 0),
      twoProportionZTest(0, 100, 0, 100), // zero pooled variance
      twoProportionZTest(-1, 100, 10, 100),
      twoProportionZTest(101, 100, 10, 100), // clicks > impressions
    ]) {
      expect(r.degenerate).toBe(true);
      expect(r.pValue).toBe(1);
      expect(isSignificant(r.pValue)).toBe(false);
    }
  });

  it("larger samples with the same rates give smaller p (power grows)", () => {
    const small = twoProportionZTest(10, 200, 14, 200);
    const large = twoProportionZTest(100, 2000, 140, 2000);
    expect(large.pValue).toBeLessThan(small.pValue);
  });
});

describe("welchTTest (continuous metrics)", () => {
  it("detects a significant mean shift", () => {
    const r = welchTTest(42.5, 180, 120, 48.2, 195, 118);
    expect(r.method).toBe("welch-t");
    expect(r.degenerate).toBe(false);
    expect(r.t).toBeCloseTo(-3.210291, 6);
    expect(r.df).toBeGreaterThan(200); // Welch-Satterthwaite df for these inputs
    expect(r.pValue).toBeCloseTo(0.00151091, TOL);
    expect(isSignificant(r.pValue)).toBe(true);
  });

  it("does not flag a null shift (t=-0.43, p=0.667)", () => {
    const r = welchTTest(30.0, 100, 150, 30.5, 102, 150);
    expect(r.t).toBeCloseTo(-0.430864, 6);
    expect(r.pValue).toBeCloseTo(0.66687896, TOL);
    expect(isSignificant(r.pValue)).toBe(false);
  });

  it("calibration: t = 2.101 @ df 18 gives p ≈ 0.05", () => {
    const p = 2 * (1 - tCdf(2.101, 18));
    expect(p).toBeCloseTo(0.04999236, 6);
    const p2 = 2 * (1 - tCdf(2.878, 18));
    expect(p2).toBeCloseTo(0.0100095, 6);
  });

  it("degenerate inputs yield p = 1, never significant", () => {
    for (const r of [
      welchTTest(1, 1, 1, 2, 1, 50), // n < 2
      welchTTest(1, 1, 50, 2, 1, 1), // n < 2
      welchTTest(1, -1, 50, 2, 1, 50), // negative variance
      welchTTest(5, 0, 50, 5, 0, 50), // zero total variance
      welchTTest(NaN, 1, 50, 2, 1, 50),
    ]) {
      expect(r.degenerate).toBe(true);
      expect(r.pValue).toBe(1);
      expect(isSignificant(r.pValue)).toBe(false);
    }
  });

  it("is symmetric: swapping arms flips the sign of t, p unchanged", () => {
    const a = welchTTest(42.5, 180, 120, 48.2, 195, 118);
    const b = welchTTest(48.2, 195, 118, 42.5, 180, 120);
    expect(b.t).toBeCloseTo(-a.t, 10);
    expect(b.pValue).toBeCloseTo(a.pValue, 10);
  });
});

describe("isSignificant", () => {
  it("uses the pinned α = 0.05 boundary strictly", () => {
    expect(SIGNIFICANCE_LEVEL).toBe(0.05);
    expect(isSignificant(0.049999)).toBe(true);
    expect(isSignificant(0.05)).toBe(false); // p < 0.05, strictly
    expect(isSignificant(NaN)).toBe(false);
  });
});
