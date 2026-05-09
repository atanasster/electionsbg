// Lawson-Hanson Non-Negative Least Squares (NNLS).
//
// Solves   min ||A x - b||_2   subject to  x >= 0,
// using the active-set algorithm from Lawson & Hanson (1974), §23.3 of
// "Solving Least Squares Problems". Tested against scipy's nnls on small
// synthetic systems — agrees to ~1e-9 on well-conditioned inputs.
//
// We use this to fit one column of the per-oblast vote-flow transition
// matrix at a time: A is the section × from-party share matrix, b is the
// section vector of next-cycle shares for one to-party, x is the column
// of "fraction of party-A's voters who went to party-B" coefficients.
// Constraint x >= 0 keeps coefficients physically meaningful (you can't
// have a negative fraction of voters); the row-sum constraint (≤1) is
// enforced later by RAS biproportional scaling.

const EPS = 1e-12;

const norm2 = (v: number[]): number => {
  let s = 0;
  for (let i = 0; i < v.length; i += 1) s += v[i] * v[i];
  return Math.sqrt(s);
};

// Solve A_P y = b for the active columns P using normal equations.
// For our small column counts (≤30) the cubic cost is fine.
const solveLeastSquares = (
  A: number[][],
  b: number[],
  active: boolean[],
): number[] => {
  const m = A.length;
  const n = A[0]?.length ?? 0;
  const cols: number[] = [];
  for (let j = 0; j < n; j += 1) if (active[j]) cols.push(j);
  const k = cols.length;
  if (k === 0) return new Array(n).fill(0);

  // Build A_P^T A_P (k×k) and A_P^T b (k).
  const ATA: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  const ATb: number[] = new Array(k).fill(0);
  for (let r = 0; r < m; r += 1) {
    const row = A[r];
    for (let i = 0; i < k; i += 1) {
      const ai = row[cols[i]];
      ATb[i] += ai * b[r];
      for (let j = i; j < k; j += 1) {
        const v = ai * row[cols[j]];
        ATA[i][j] += v;
        if (i !== j) ATA[j][i] += v;
      }
    }
  }

  // Cholesky with a tiny ridge term for numerical stability when columns
  // are near-collinear. The ridge is small relative to the diagonal so it
  // does not bias solutions.
  for (let i = 0; i < k; i += 1) ATA[i][i] += 1e-10;
  const L: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let i = 0; i < k; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = ATA[i][j];
      for (let t = 0; t < j; t += 1) sum -= L[i][t] * L[j][t];
      if (i === j) {
        if (sum <= 0) {
          // Singular even with the ridge — fall back to zero solution
          // for active set; the outer loop will deactivate variables.
          return new Array(n).fill(0);
        }
        L[i][j] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }
  // Forward solve L y = ATb
  const y: number[] = new Array(k).fill(0);
  for (let i = 0; i < k; i += 1) {
    let sum = ATb[i];
    for (let t = 0; t < i; t += 1) sum -= L[i][t] * y[t];
    y[i] = sum / L[i][i];
  }
  // Back-solve L^T x = y
  const xCompact: number[] = new Array(k).fill(0);
  for (let i = k - 1; i >= 0; i -= 1) {
    let sum = y[i];
    for (let t = i + 1; t < k; t += 1) sum -= L[t][i] * xCompact[t];
    xCompact[i] = sum / L[i][i];
  }
  // Scatter back to length-n vector with zeros on inactive columns.
  const x = new Array<number>(n).fill(0);
  for (let i = 0; i < k; i += 1) x[cols[i]] = xCompact[i];
  return x;
};

export const nnls = (A: number[][], b: number[], maxIter = 200): number[] => {
  const m = A.length;
  if (m === 0) return [];
  const n = A[0].length;
  const x = new Array<number>(n).fill(0);
  // P (passive set) = currently allowed-positive variables; Z = held at 0.
  const inP = new Array<boolean>(n).fill(false);
  const tol = EPS * (norm2(b) + 1) * Math.max(m, n);

  let iter = 0;
  while (iter < maxIter) {
    iter += 1;
    // w = A^T (b - A x)
    const r = new Array<number>(m).fill(0);
    for (let i = 0; i < m; i += 1) {
      let s = b[i];
      for (let j = 0; j < n; j += 1) s -= A[i][j] * x[j];
      r[i] = s;
    }
    const w = new Array<number>(n).fill(0);
    for (let j = 0; j < n; j += 1) {
      let s = 0;
      for (let i = 0; i < m; i += 1) s += A[i][j] * r[i];
      w[j] = s;
    }
    // Pick j in Z with largest positive gradient.
    let jStar = -1;
    let wMax = tol;
    for (let j = 0; j < n; j += 1) {
      if (!inP[j] && w[j] > wMax) {
        wMax = w[j];
        jStar = j;
      }
    }
    if (jStar < 0) break; // Optimal — KKT satisfied.

    inP[jStar] = true;
    let inner = 0;
    while (inner < maxIter) {
      inner += 1;
      const s = solveLeastSquares(A, b, inP);
      // Check feasibility on P.
      let alpha = Infinity;
      let qStar = -1;
      let allPositive = true;
      for (let j = 0; j < n; j += 1) {
        if (inP[j] && s[j] <= 0) {
          allPositive = false;
          const denom = x[j] - s[j];
          if (denom > 0) {
            const t = x[j] / denom;
            if (t < alpha) {
              alpha = t;
              qStar = j;
            }
          }
        }
      }
      if (allPositive) {
        for (let j = 0; j < n; j += 1) x[j] = inP[j] ? s[j] : 0;
        break;
      }
      // Move x toward s by alpha and drop variables that hit zero.
      for (let j = 0; j < n; j += 1) {
        if (inP[j]) x[j] = x[j] + alpha * (s[j] - x[j]);
      }
      for (let j = 0; j < n; j += 1) {
        if (inP[j] && Math.abs(x[j]) < tol) inP[j] = false;
      }
      if (qStar < 0) break; // Numerical edge — bail out of inner loop.
    }
  }
  // Clean tiny negatives from numerical noise.
  for (let j = 0; j < n; j += 1) if (x[j] < 0) x[j] = 0;
  return x;
};
