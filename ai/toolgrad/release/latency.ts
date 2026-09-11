export function distribution(values: number[]) {
  if (!values.length) return { n: 0, medianMs: null, p95Ms: null, maxMs: null };
  if (values.some((v) => !Number.isFinite(v) || v < 0))
    throw new Error("Invalid timing sample");
  const v = [...values].sort((a, b) => a - b),
    m = Math.floor(v.length / 2);
  return {
    n: v.length,
    medianMs: v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2,
    p95Ms: v[Math.ceil(v.length * 0.95) - 1],
    maxMs: v[v.length - 1],
  };
}
