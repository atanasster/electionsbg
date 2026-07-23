// Shared formatting for the demographic-cleavages dot plots (home tile +
// /party-demographics page).

/** Signed two-decimal correlation, e.g. 0.62 → "+0.62", -0.3 → "-0.30". */
export const fmtR = (r: number) => `${r > 0 ? "+" : ""}${r.toFixed(2)}`;

/** Maps r in [-1, 1] to a 0..100 horizontal position in the row track. */
export const xPct = (r: number) => 50 + Math.max(-1, Math.min(1, r)) * 50;
