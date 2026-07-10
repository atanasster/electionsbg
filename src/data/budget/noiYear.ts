// The single completeness guard for data/budget/noi/funds.json.
//
// The NOI B1 ingest publishes a new fiscal year mid-cycle as a partial/shell
// record: `funds: []`, `totals.revenue.amountEur === 0`, and an `expenditure`
// that is really just the pension yearbook's grand total rather than gross
// expenditure. A shell year is structurally indistinguishable from a complete
// one unless you look, so every reader used to re-derive the test by hand —
// and one of them (run_policy_baseline.ts) simply took the last array element
// and silently fed a partial pension mass into the /budget/simulator levers.
//
// The producer now stamps `complete` (see buildNoiFundsFile in
// scripts/budget/noi/parse_b1_xls.ts). This module is the one place that
// interprets it. Import it; do not re-derive the predicate.
//
// `complete` is optional on the read side on purpose: the artifact is served
// from the GCS data bucket, so a deploy can transiently serve a funds.json
// written before the flag existed. We fall back to the structural test that
// every reader previously inlined, which is exactly what the producer stamps.

/** The minimal shape the guard needs — satisfied by both the frontend's
 *  NoiFundsFile["years"][number] and the leaner inline types the offline
 *  scripts use with readJson(). */
export interface NoiYearLike {
  fiscalYear: number;
  complete?: boolean;
  funds: unknown[];
  totals: { revenue: { amountEur: number } };
}

/** True when the year carries real B1 per-fund detail. */
export const isCompleteNoiYear = (y: NoiYearLike): boolean =>
  y.complete ?? (y.funds.length > 0 && y.totals.revenue.amountEur > 0);

/** The complete year with the highest fiscalYear, or null when none qualify.
 *  Never trust array order — the artifact's year ordering is not contractual. */
export const latestCompleteNoiYear = <T extends NoiYearLike>(
  years: readonly T[],
): T | null => {
  const usable = years.filter(isCompleteNoiYear);
  if (!usable.length) return null;
  return [...usable].sort((a, b) => b.fiscalYear - a.fiscalYear)[0];
};
