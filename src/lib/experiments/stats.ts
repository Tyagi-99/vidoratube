/**
 * F34 — Experiment stats engine (pure, dependency-free).
 *
 * Pinned stats discipline (docs/PHASE4_CONTRACTS.md):
 *   - two-proportion z-test for CTR, p < 0.05
 *   - Welch's t-test for continuous metrics, p < 0.05
 *
 * Implemented from scratch (D136): erf via Abramowitz–Stegun 7.1.26
 * (|ε| ≤ 1.5e-7), t-CDF via the regularized incomplete beta function
 * (Numerical Recipes continued fraction), log-gamma via Lanczos.
 * No native deps, deterministic, worker/edge-safe.
 *
 * Ground-truth fixtures in stats.test.ts were computed independently with
 * scipy 1.11.4 — this engine must match them to 1e-6. The fixtures are the
 * contract, not this implementation.
 */

export const SIGNIFICANCE_LEVEL = 0.05;

/* ------------------------------------------------------------------ */
/* Special functions                                                   */
/* ------------------------------------------------------------------ */

/** Error function — Abramowitz & Stegun 7.1.26 (|ε| ≤ 1.5e-7). */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  // Coefficients for 1 - erf(x) approximation.
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

/** Standard normal CDF. */
export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/** Log-gamma via the Lanczos approximation (g=7, 9 coefficients). */
export function logGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    // Reflection formula.
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const z = x - 1;
  let a = c[0]!;
  for (let i = 1; i < 9; i++) a += c[i]! / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * Continued fraction for the incomplete beta function (Numerical Recipes
 * `betacf`). Returns the fraction value; callers scale it.
 */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-12;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betaContinuedFraction(a, b, x)) / a;
  }
  return 1 - (bt * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Student's t CDF with df degrees of freedom. */
export function tCdf(t: number, df: number): number {
  if (df <= 0 || !Number.isFinite(t)) return NaN;
  const x = df / (df + t * t);
  const ib = regularizedIncompleteBeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - ib / 2 : ib / 2;
}

/* ------------------------------------------------------------------ */
/* Hypothesis tests                                                    */
/* ------------------------------------------------------------------ */

export interface TwoProportionZTestResult {
  method: "two-proportion-z";
  /** z-statistic (control − variant; negative means variant is higher). */
  z: number;
  /** Two-tailed p-value. */
  pValue: number;
  /** True when inputs are degenerate (no information) — p forced to 1. */
  degenerate: boolean;
}

/**
 * Two-proportion z-test with pooled standard error (two-tailed).
 * successesX/trialsX are e.g. clicks/impressions for control (A) and variant (B).
 * Degenerate inputs (no trials, or zero pooled variance) yield p = 1:
 * "no evidence", never "significant".
 */
export function twoProportionZTest(
  successesA: number,
  trialsA: number,
  successesB: number,
  trialsB: number,
): TwoProportionZTestResult {
  if (
    !Number.isFinite(successesA) ||
    !Number.isFinite(trialsA) ||
    !Number.isFinite(successesB) ||
    !Number.isFinite(trialsB) ||
    trialsA <= 0 ||
    trialsB <= 0 ||
    successesA < 0 ||
    successesB < 0 ||
    successesA > trialsA ||
    successesB > trialsB
  ) {
    return { method: "two-proportion-z", z: 0, pValue: 1, degenerate: true };
  }
  const pooled = (successesA + successesB) / (trialsA + trialsB);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / trialsA + 1 / trialsB));
  if (se === 0) {
    return { method: "two-proportion-z", z: 0, pValue: 1, degenerate: true };
  }
  const z = (successesA / trialsA - successesB / trialsB) / se;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  return {
    method: "two-proportion-z",
    z,
    pValue: Math.min(1, Math.max(0, pValue)),
    degenerate: false,
  };
}

export interface WelchTTestResult {
  method: "welch-t";
  /** t-statistic (A − B; negative means B's mean is higher). */
  t: number;
  /** Welch–Satterthwaite degrees of freedom. */
  df: number;
  /** Two-tailed p-value. */
  pValue: number;
  /** True when inputs are degenerate — p forced to 1. */
  degenerate: boolean;
}

/**
 * Welch's two-sample t-test (unequal variances, two-tailed).
 * Degenerate inputs (n < 2 on either side, non-finite or negative variance)
 * yield p = 1: "no evidence", never "significant".
 */
export function welchTTest(
  meanA: number,
  varA: number,
  nA: number,
  meanB: number,
  varB: number,
  nB: number,
): WelchTTestResult {
  const degenerate = (): WelchTTestResult => ({
    method: "welch-t",
    t: 0,
    df: 1,
    pValue: 1,
    degenerate: true,
  });
  for (const v of [meanA, varA, nA, meanB, varB, nB]) {
    if (!Number.isFinite(v)) return degenerate();
  }
  if (nA < 2 || nB < 2 || varA < 0 || varB < 0) return degenerate();
  const se2 = varA / nA + varB / nB;
  if (se2 <= 0) return degenerate();
  const t = (meanA - meanB) / Math.sqrt(se2);
  const num = se2 * se2;
  const den = (varA / nA) ** 2 / (nA - 1) + (varB / nB) ** 2 / (nB - 1);
  const df = den > 0 ? num / den : 1;
  const pValue = 2 * (1 - tCdf(Math.abs(t), df));
  return {
    method: "welch-t",
    t,
    df,
    pValue: Math.min(1, Math.max(0, pValue)),
    degenerate: false,
  };
}

/** Convenience: is this p-value significant at the pinned α = 0.05? */
export function isSignificant(pValue: number): boolean {
  return Number.isFinite(pValue) && pValue < SIGNIFICANCE_LEVEL;
}
