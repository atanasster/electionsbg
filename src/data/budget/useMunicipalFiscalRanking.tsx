// The 265-município year-end ranking behind /governance/municipal-finance,
// served from `municipal_fiscal_ranking()` (migration 149) via
// /api/db/municipal-fiscal-ranking.
//
// **Not a DbDataTable, and the reason is the cardinality.** The plan (T10.1)
// specified the shared registry engine "so search / sort / paging cost nothing
// new" — an argument that holds for the 82k-row contracts browser and does not
// hold here: the whole corpus is 265 rows and ~90 KB, so it arrives in one
// request and every sort and filter is instant in the browser. Registering a
// resource would add a view, a column registry and a search fold to serve a set
// small enough to hold in memory. Revisit if the T15 backfill turns this into a
// year × município browse (2,385 rows at nine year-ends — still small).
//
// YEAR-END ONLY, by construction. The чл. 130а ratios are annual („налични към
// края на ГОДИНАТА"), so the SQL restricts to Q4: ranking an interim quarter
// against a year-end one compares two different denominators.

import { useQuery } from "@tanstack/react-query";

/** SNAKE_CASE, matching the wire. The `/api/db/table` registry engine camelCases
 *  its projection; the hand-written `/api/db/*` routes — these three included —
 *  return the row as Postgres names it. Typing it any other way here would
 *  compile and then read `undefined` at runtime for every column. */
export interface MunicipalFiscalRankingRow {
  obshtina: string;
  name_bg: string;
  name_en: string | null;
  oblast_code: string | null;
  fiscal_year: number;
  quarter: number;
  /** The three nested stocks, in EUR. Any of them may be NULL — МФ freezes a
   *  column between releases and the ingest withholds it rather than carrying a
   *  stale figure forward, so NULL means „not published", never zero. */
  commitments_eur: number | null;
  /** Percent of the four-year average expenditure — the чл. 130а т. 3 ratio,
   *  re-derived. STORED AS A PERCENT (295.03 = 295%), not a fraction. */
  commitments_pct: number | null;
  expense_obligations_eur: number | null;
  obligations_pct: number | null;
  arrears_eur: number | null;
  arrears_pct: number | null;
  cash_on_hand_eur: number | null;
  debt_stock_eur: number | null;
  /** TRUE when ≥3 criteria are met, FALSE only when all six were evaluable and
   *  fewer than three were met, and NULL when too few could be evaluated to
   *  decide. The ≥3 rule is monotone, so „3 met" is decisive whatever the
   *  unchecked ones say — but „2 met of 4 evaluable" decides nothing. */
  meets_threshold: boolean | null;
  /** A separate, ADMINISTRATIVE fact: the município is in a чл. 130д recovery
   *  procedure. Never conflate it with `meetsThreshold`, which is our own
   *  re-derivation of the чл. 130а criteria. */
  in_recovery_procedure: boolean | null;
  /** WHICH of the six criteria are met, and which could be evaluated at all —
   *  arrays, not counts, so the UI can mark the individual criteria. */
  criteria_met: number[] | null;
  criteria_evaluable: number[] | null;
  /** NSI Census 2021, the município's own figure. NULL only if the census has
   *  no row, which the loader refuses to publish. */
  population: number | null;
  /** The only cross-município comparable. Absolute commitments put Столична
   *  община first every year by construction, which tells a reader nothing. */
  commitments_per_capita_eur: number | null;
  /** Fields withheld for this row, by name. A figure absent from the row and
   *  named here is „frozen upstream"; absent and NOT named is „never
   *  published". */
  suppressed_fields: string[] | null;
}

/** @param year year-end to rank; omit for the newest the corpus carries. */
export const useMunicipalFiscalRanking = (year?: number) => {
  const { data, isPending, isError } = useQuery({
    queryKey: ["municipal_fiscal_ranking", year ?? "latest"] as [
      string,
      number | string,
    ],
    queryFn: async (): Promise<MunicipalFiscalRankingRow[]> => {
      const qs = new URLSearchParams({ limit: "1000" });
      if (year != null) qs.set("year", String(year));
      const r = await fetch(`/api/db/municipal-fiscal-ranking?${qs}`);
      // Throw rather than degrade: an empty table here is indistinguishable
      // from „no município has commitments", which is the opposite of the fact
      // this page exists to publish.
      if (!r.ok) throw new Error(`municipal-fiscal-ranking: ${r.status}`);
      return r.json();
    },
    staleTime: Infinity,
  });
  // `isError` is surfaced deliberately. The throw above keeps „the fetch failed"
  // distinct from „the corpus is empty" at the query layer; a consumer that only
  // reads `rows` collapses them again, and then a 500 renders as „no município
  // has commitments".
  return { rows: data ?? [], isPending, isError };
};
