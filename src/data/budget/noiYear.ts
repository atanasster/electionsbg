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

import { toEur } from "@/lib/currency";

/** The minimal shape the guard needs — satisfied by both the frontend's
 *  NoiFundsFile["years"][number] and the leaner inline types the offline
 *  scripts use with readJson(). */
export interface NoiYearLike {
  fiscalYear: number;
  complete?: boolean;
  funds: unknown[];
  totals: { revenue: { amountEur: number } };
}

/** True when the year carries real B1 per-fund detail.
 *
 *  The structural fallback is optional-chained throughout because callers run
 *  it at MODULE scope over a freshly-parsed artifact (sector_stats.ts does), so
 *  a throw here fires at import time — before any preflight exists to turn it
 *  into a skip. A malformed year is "not complete", never an aborted chain. */
export const isCompleteNoiYear = (y: NoiYearLike): boolean =>
  y.complete ??
  ((y.funds?.length ?? 0) > 0 && (y.totals?.revenue?.amountEur ?? 0) > 0);

/** The complete year with the highest fiscalYear, or null when none qualify.
 *  Never trust array order — the artifact's year ordering is not contractual. */
export const latestCompleteNoiYear = <T extends NoiYearLike>(
  years: readonly T[],
): T | null => {
  const usable = years.filter(isCompleteNoiYear);
  if (!usable.length) return null;
  return [...usable].sort((a, b) => b.fiscalYear - a.fiscalYear)[0];
};

/** ДОО — Държавно обществено осигуряване, the pension fund proper. The other
 *  two B1 funds in the artifact are 5591 (Учителски пенсионен фонд) and 5592
 *  (ГВРС, which pays no pensions at all). */
export const DOO_FUND_CODE = "5500";

/** The minimal per-fund shape dooPensionsEur needs. `pensionsBgn` is stored in
 *  whole leva only — the precomputed `amountEur` exists on the rollup `totals`,
 *  not per fund, which is exactly the trap below. */
export interface NoiFundLike {
  fundCode: string;
  pensionsBgn?: number | null;
}

/** One fund's pension outlay in EUR, or null when it publishes no pension line.
 *  The rounding rule lives here and nowhere else, so every surface showing
 *  "pensions paid" rounds the same way. */
export const fundPensionsEur = (f: NoiFundLike | undefined): number | null => {
  if (!f || f.pensionsBgn == null) return null;
  const eur = toEur(f.pensionsBgn, "BGN");
  return eur == null ? null : Math.round(eur);
};

/** The year's ДОО pension outlay in EUR, or null when it carries no 5500
 *  snapshot (a shell year has `funds: []`, so it always returns null).
 *
 *  ⚠️ The ONE producer of ДОО pensions paid — for any surface that says „ДОО"
 *  or links to /pensions: the pack in useNoi.tsx and the /governance/sectors
 *  hub tile. Do NOT substitute `totals.pensions` there. That is the THREE-fund
 *  rollup (ДОО + УчПФ + ГВРС), €52,502,905 / 0.47% larger on 2024 — measured,
 *  all of it Учителски пенсионен фонд (5591; ГВРС pays €0). The hub tile read
 *  the rollup while /pensions read ДОО, so the tile and the page it links to
 *  published two different figures for what a reader takes to be one quantity.
 *
 *  The rollup stays CORRECT, and must NOT be "fixed" to this, on the surfaces
 *  that are about the social funds collectively: BudgetSocialFundsTile,
 *  BudgetFlowSocialFundsDrilldown, CabinetFiscalFootprintTile, and
 *  run_policy_baseline's pension mass. */
export const dooPensionsEur = (year: {
  funds: readonly NoiFundLike[];
}): number | null =>
  fundPensionsEur(year.funds.find((f) => f.fundCode === DOO_FUND_CODE));
