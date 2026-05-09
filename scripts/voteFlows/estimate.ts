// Per-oblast Goodman ecological regression with non-negativity, then
// biproportional (RAS) scaling so the resulting matrix's row sums equal the
// from-cycle vote totals and column sums equal the to-cycle vote totals.
//
// The regression: for each section we have x_s (from-side share vector,
// length R) and y_s (to-side share vector, length C). For each to-side
// column j we fit β_j ≥ 0 such that y_s[j] ≈ x_s · β_j across sections.
// β_j[i] is then the estimated fraction of from-party-i's voters who
// went to to-party-j, in this oblast. NNLS keeps β ≥ 0; RAS forces the
// row sums of (β · diag(fromTotals)) — which is the absolute flow
// matrix — to match the published margins exactly.

import { nnls } from "./nnls";

export type OblastEstimate = {
  oblast: string;
  /** Absolute-vote flow matrix, shape [fromR][toC], indexed in fromIds/
   * toIds order from the reconcile pass. Row sums = fromTotals,
   * column sums = toTotals (within RAS tolerance). */
  flows: number[][];
  rasIterations: number;
  rasResidual: number;
};

const RAS_MAX_ITER = 500;
const RAS_TOL = 1e-8;

export const estimateOblast = ({
  oblast,
  sections,
  fromTotals,
  toTotals,
}: {
  oblast: string;
  sections: Array<{
    registeredFrom: number;
    registeredTo: number;
    from: number[];
    to: number[];
  }>;
  fromTotals: number[];
  toTotals: number[];
}): OblastEstimate => {
  // RAS can only converge when the row-sum target and column-sum target
  // share the same total mass. If they differ, distribute the gap into
  // the abstain/joined/exited pseudo-buckets — in practice the gap is
  // tiny rounding (a few hundred votes from invalid-ballot accounting
  // on cycles with very different protocols).
  const rowMass = fromTotals.reduce((s, n) => s + n, 0);
  const colMass = toTotals.reduce((s, n) => s + n, 0);
  if (Math.abs(rowMass - colMass) > 0.5 && rowMass > 0 && colMass > 0) {
    const target = (rowMass + colMass) / 2;
    const fromScale = target / rowMass;
    const toScale = target / colMass;
    for (let i = 0; i < fromTotals.length; i += 1) fromTotals[i] *= fromScale;
    for (let j = 0; j < toTotals.length; j += 1) toTotals[j] *= toScale;
  }
  const R = fromTotals.length;
  const C = toTotals.length;
  // A is sections × R, weighted by sqrt(registeredFrom) so larger sections
  // dominate the fit (variance proportional to 1/registered for a Bernoulli
  // share). Equivalent to weighted least squares with weight = registered.
  const m = sections.length;
  const A: number[][] = new Array(m);
  const weights: number[] = new Array(m);
  for (let s = 0; s < m; s += 1) {
    const w = Math.sqrt(Math.max(1, sections[s].registeredFrom));
    weights[s] = w;
    const row = new Array<number>(R);
    for (let i = 0; i < R; i += 1) row[i] = sections[s].from[i] * w;
    A[s] = row;
  }
  const beta: number[][] = new Array(R); // beta[i][j] = fraction of i → j
  for (let i = 0; i < R; i += 1) beta[i] = new Array<number>(C).fill(0);
  // Fit one column (target party) at a time.
  for (let j = 0; j < C; j += 1) {
    const b = new Array<number>(m);
    for (let s = 0; s < m; s += 1) b[s] = sections[s].to[j] * weights[s];
    const xj = nnls(A, b);
    for (let i = 0; i < R; i += 1) beta[i][j] = xj[i];
  }
  // Convert β (row-coefficients of the regression) to absolute-vote flows
  // by multiplying each row by that party's from-side total. This is the
  // "raw" flow matrix before mass-balance correction.
  const flows: number[][] = new Array(R);
  for (let i = 0; i < R; i += 1) {
    flows[i] = new Array<number>(C).fill(0);
    const ti = fromTotals[i];
    for (let j = 0; j < C; j += 1) flows[i][j] = beta[i][j] * ti;
  }

  // RAS / biproportional scaling so rowSums = fromTotals and colSums =
  // toTotals exactly. If a row/column total is 0 we leave that line at 0
  // (no mass to redistribute; happens for added/removed when not used).
  const rowSum = (M: number[][], i: number): number => {
    let s = 0;
    for (let j = 0; j < M[i].length; j += 1) s += M[i][j];
    return s;
  };
  const colSum = (M: number[][], j: number): number => {
    let s = 0;
    for (let i = 0; i < M.length; i += 1) s += M[i][j];
    return s;
  };

  // Seed any all-zero rows/columns with a tiny positive prior so RAS has
  // something to scale. Without this, a target party with 0 estimated
  // inflow gets stranded at 0 forever even though its column sum is
  // non-zero (e.g. a brand-new party that NNLS pinned to all zeros for
  // numerical reasons).
  const SEED = 1e-6;
  for (let i = 0; i < R; i += 1) {
    if (fromTotals[i] > 0 && rowSum(flows, i) === 0) {
      for (let j = 0; j < C; j += 1) if (toTotals[j] > 0) flows[i][j] = SEED;
    }
  }
  for (let j = 0; j < C; j += 1) {
    if (toTotals[j] > 0 && colSum(flows, j) === 0) {
      for (let i = 0; i < R; i += 1) if (fromTotals[i] > 0) flows[i][j] += SEED;
    }
  }

  let iter = 0;
  let residual = Infinity;
  while (iter < RAS_MAX_ITER) {
    iter += 1;
    // Row scale.
    for (let i = 0; i < R; i += 1) {
      const target = fromTotals[i];
      if (target <= 0) continue;
      const cur = rowSum(flows, i);
      if (cur <= 0) continue;
      const k = target / cur;
      for (let j = 0; j < C; j += 1) flows[i][j] *= k;
    }
    // Column scale.
    for (let j = 0; j < C; j += 1) {
      const target = toTotals[j];
      if (target <= 0) continue;
      const cur = colSum(flows, j);
      if (cur <= 0) continue;
      const k = target / cur;
      for (let i = 0; i < R; i += 1) flows[i][j] *= k;
    }
    // Residual: max |rowSum - fromTotal| + max |colSum - toTotal|, normalised
    // by total mass. Converges geometrically in well-posed cases.
    let rResid = 0;
    let cResid = 0;
    let totalMass = 0;
    for (let i = 0; i < R; i += 1) {
      totalMass += fromTotals[i];
      rResid += Math.abs(rowSum(flows, i) - fromTotals[i]);
    }
    for (let j = 0; j < C; j += 1) {
      cResid += Math.abs(colSum(flows, j) - toTotals[j]);
    }
    residual = (rResid + cResid) / Math.max(1, totalMass);
    if (residual < RAS_TOL) break;
  }

  return { oblast, flows, rasIterations: iter, rasResidual: residual };
};
