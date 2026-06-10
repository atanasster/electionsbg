// Parametric earnings distribution for the tax-policy simulator's bracket
// scoring — built because no Bulgarian institution publishes insured-persons
// counts by income band (НОИ's own actuarial model runs on averages; NSI
// wage micro-data is Infostat-walled). The model is fitted to four
// independent open anchors and validated by reproducing the НАП employment
// PIT line (the κ gate in run_policy_baseline.ts):
//
//   shape, below cap   split log-normal — σ for each half from the SES
//                      decile ratios (earn_ses_hourly: D5/D1 lower, D9/D5
//                      upper). The split captures the minimum-wage floor
//                      compressing the lower half (D5/D1 1.83 vs D9/D5 2.45
//                      in 2022). Hourly ≈ monthly shape is acceptable for
//                      Bulgaria specifically: part-time employment is ~2%,
//                      the lowest in the EU.
//   level              the median m solves the capped-mean equation
//                      E[min(W, cap)] = НОИ's average insurable income for
//                      трета-категория employees (СОД).
//   headcount          N = insurable base B ÷ (12 × capped mean), with B
//                      from Eurostat D613CE — employees only, consistent
//                      with the СОД anchor.
//   tail               Pareto above the cap; α follows in closed form from
//                      the above-cap wage mass E recovered by the
//                      PIT-vs-insurable-base identity:
//                        E = N · P(W>cap) · cap/(α−1)  ⇒  α = 1 + N·P·cap/E
//
// Output is a quantile-spaced discretization (~120 bands of {grossEur,
// workers}) — the client scores arbitrary bracket schedules by summing over
// bands, and because scenario and baseline share the same grid the
// discretization error cancels in the Δ.

export interface EarningsFitInput {
  /** ln(D5/D1) / 1.2816 — lower-half log-normal σ from SES. */
  sigmaLower: number;
  /** ln(D9/D5) / 1.2816 — upper-half log-normal σ from SES. */
  sigmaUpper: number;
  /** Average monthly insurable income of employees (НОИ СОД), EUR. */
  cappedMeanEur: number;
  /** Capped insurable base (employees), EUR per year — D613CE ÷ rate. */
  insurableBaseEur: number;
  /** Above-cap wage mass, EUR per year — the identity's E. */
  aboveCapMassEur: number;
  /** МОД cap in force at the anchor year, EUR per month. */
  capEur: number;
}

export interface EarningsBand {
  /** Band-representative gross monthly wage, EUR. */
  grossEur: number;
  /** Workers the band represents. */
  workers: number;
}

export interface EarningsFit {
  medianEur: number;
  nEmployees: number;
  alpha: number;
  shareAboveCap: number;
  bands: EarningsBand[];
}

// Standard normal CDF via the Abramowitz–Stegun erf approximation (~1e-7) —
// plenty for a model whose anchors carry percent-level uncertainty.
const phi = (x: number): number => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p =
    d *
    t *
    (0.31938153 +
      t *
        (-0.356563782 +
          t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
};

// Acklam's rational approximation of the standard normal quantile (~1e-9).
const phiInv = (p: number): number => {
  if (p <= 0 || p >= 1) throw new Error(`phiInv domain: ${p}`);
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269,
    -30.66479806614716, 2.506628277459239,
  ];
  const b = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866,
    66.80131188771972, -13.28068155288572,
  ];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    0.007784695709041462, 0.3224671290700398, 2.445134137142996,
    3.754408661907416,
  ];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
      q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
};

// Split log-normal around median m: each half is log-normal with its own σ,
// carrying probability mass 1/2.
const splitCdf = (
  w: number,
  m: number,
  sigmaL: number,
  sigmaU: number,
): number => {
  if (w <= 0) return 0;
  const z = Math.log(w / m);
  return w < m ? phi(z / sigmaL) : phi(z / sigmaU);
};

const splitQuantile = (
  p: number,
  m: number,
  sigmaL: number,
  sigmaU: number,
): number => {
  const z = phiInv(p);
  return m * Math.exp(z * (p < 0.5 ? sigmaL : sigmaU));
};

// E[min(W, cap)] for the split log-normal, by numeric quadrature over
// quantiles (2000 strata — exact to <0.01% for these σ).
const cappedMean = (
  m: number,
  sigmaL: number,
  sigmaU: number,
  cap: number,
): number => {
  const N = 2000;
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const p = (i + 0.5) / N;
    sum += Math.min(splitQuantile(p, m, sigmaL, sigmaU), cap);
  }
  return sum / N;
};

export const fitEarnings = (input: EarningsFitInput): EarningsFit => {
  const { sigmaLower, sigmaUpper, capEur } = input;

  // Median: bisection on the capped-mean equation. The capped mean is
  // strictly increasing in m, so bisection is safe.
  let lo = input.cappedMeanEur * 0.3;
  let hi = input.cappedMeanEur * 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (cappedMean(mid, sigmaLower, sigmaUpper, capEur) < input.cappedMeanEur)
      lo = mid;
    else hi = mid;
  }
  const medianEur = (lo + hi) / 2;

  const nEmployees = input.insurableBaseEur / (12 * input.cappedMeanEur);
  const shareAboveCap = 1 - splitCdf(capEur, medianEur, sigmaLower, sigmaUpper);
  // Pareto excess mean above the cap is cap/(α−1):
  //   E = N · share · 12 · cap/(α−1)
  const alpha =
    1 + (nEmployees * shareAboveCap * 12 * capEur) / input.aboveCapMassEur;
  if (!(alpha > 1.2 && alpha < 6)) {
    throw new Error(
      `fitted Pareto α=${alpha.toFixed(2)} outside [1.2, 6] — anchors inconsistent`,
    );
  }

  // ---- discretize -----------------------------------------------------
  // Below the cap: 80 equal-probability strata of [0, P(cap)], each
  // represented at its quantile midpoint. Above: 39 strata over the bottom
  // 99.9% of the Pareto tail + one top stratum at its conditional mean.
  const bands: EarningsBand[] = [];
  const pCap = 1 - shareAboveCap;
  const BELOW = 80;
  for (let i = 0; i < BELOW; i++) {
    const p = (pCap * (i + 0.5)) / BELOW;
    bands.push({
      grossEur: splitQuantile(p, medianEur, sigmaLower, sigmaUpper),
      workers: (nEmployees * pCap) / BELOW,
    });
  }
  const ABOVE = 39;
  const TOP_SHARE = 0.001; // of the tail
  // Each tail stratum is represented at its CONDITIONAL MEAN, not its
  // quantile midpoint — the Pareto quantile is convex, so midpoints would
  // systematically understate the excess mass (~4% at these α). The
  // conditional mean over a Pareto segment [x1, x2) is closed-form:
  //   α/(α−1) · (x1^{1−α} − x2^{1−α}) / (x1^{−α} − x2^{−α})
  const paretoSegmentMean = (x1: number, x2: number): number =>
    ((alpha / (alpha - 1)) *
      (Math.pow(x1, 1 - alpha) - Math.pow(x2, 1 - alpha))) /
    (Math.pow(x1, -alpha) - Math.pow(x2, -alpha));
  const tailX = (u: number): number => capEur * Math.pow(1 - u, -1 / alpha);
  for (let i = 0; i < ABOVE; i++) {
    const u1 = ((1 - TOP_SHARE) * i) / ABOVE;
    const u2 = ((1 - TOP_SHARE) * (i + 1)) / ABOVE;
    bands.push({
      grossEur: paretoSegmentMean(tailX(u1), tailX(u2)),
      workers: (nEmployees * shareAboveCap * (1 - TOP_SHARE)) / ABOVE,
    });
  }
  // Top stratum: starts at the tail's 99.9th percentile; its conditional
  // mean is x·α/(α−1).
  const xTop = capEur * Math.pow(TOP_SHARE, -1 / alpha);
  bands.push({
    grossEur: (xTop * alpha) / (alpha - 1),
    workers: nEmployees * shareAboveCap * TOP_SHARE,
  });

  // ---- discretization self-checks --------------------------------------
  let cm = 0;
  let excess = 0;
  let n = 0;
  for (const b of bands) {
    n += b.workers;
    cm += b.workers * Math.min(b.grossEur, capEur);
    excess += b.workers * Math.max(0, b.grossEur - capEur);
  }
  cm /= n;
  const cmErr = Math.abs(cm - input.cappedMeanEur) / input.cappedMeanEur;
  if (cmErr > 0.005)
    throw new Error(
      `band grid drifts from the capped mean by ${(cmErr * 100).toFixed(2)}%`,
    );
  const exErr =
    Math.abs(excess * 12 - input.aboveCapMassEur) / input.aboveCapMassEur;
  if (exErr > 0.02)
    throw new Error(
      `band grid drifts from the above-cap mass by ${(exErr * 100).toFixed(2)}%`,
    );

  return {
    medianEur,
    nEmployees,
    alpha,
    shareAboveCap,
    bands: bands.map((b) => ({
      grossEur: Math.round(b.grossEur * 100) / 100,
      workers: Math.round(b.workers),
    })),
  };
};
