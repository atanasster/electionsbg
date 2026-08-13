// One município's liability stocks, from `municipal_fiscal_by_obshtina()`
// (migration 149) via /api/db/municipal-fiscal.
//
// The payload is snake_case throughout, matching the columns it is built from —
// the `/api/db/table` registry engine camelCases its projection, the
// hand-written routes do not.
//
// The route DEGRADES a missing corpus to `null`, so the tile self-suppresses on
// a database that never ran the loader rather than erroring. That is the right
// failure for a tile nobody is watching, and it is why the route logs
// `mf:not-built` once per process: latency cannot be the signal, because an
// absent corpus is fast.

import { useQuery } from "@tanstack/react-query";

export interface MunicipalFiscalSeriesPoint {
  fiscal_year: number;
  quarter: number;
  commitments_eur: number | null;
  expense_obligations_eur: number | null;
  arrears_eur: number | null;
  cash_on_hand_eur: number | null;
  suppressed_fields: string[] | null;
}

export interface MunicipalFiscalPayload {
  obshtina: string;
  mf_code: number;
  /** The period the headline figures describe. NOT always the newest quarter:
   *  the SQL prefers the newest row that actually HAS commitments, because a
   *  frozen column would otherwise return null for the one number this pillar
   *  exists to publish — and null reads as „nothing contracted". */
  fiscal_year: number;
  quarter: number;
  name_bg: string;
  name_en: string | null;
  oblast_code: string | null;
  currency: string | null;

  commitments_eur: number | null;
  expense_obligations_eur: number | null;
  arrears_eur: number | null;
  revenue_eur: number | null;
  expenditure_eur: number | null;
  budget_balance_eur: number | null;
  cash_on_hand_eur: number | null;
  debt_stock_eur: number | null;
  expenditure_avg4y_eur: number | null;

  /** Percent, not a fraction (295.03 = 295%). */
  arrears_pct: number | null;
  obligations_pct: number | null;
  commitments_pct: number | null;
  /** Which denominator the SOURCE used per ratio — at Q4 the three differ. */
  arrears_basis: string | null;
  obligations_basis: string | null;
  commitments_basis: string | null;

  collection_dni_pct: number | null;
  collection_dprs_pct: number | null;
  collection_avg_pct: number | null;

  /** WHICH of the six чл. 130а criteria are met, and which could be evaluated
   *  at all. Only 3 of the 6 are computable from the quarterly return, so
   *  „2 met" may be „2 of 3 checked" — and the ≥3 rule turns on exactly that. */
  criteria_met: number[] | null;
  criteria_evaluable: number[] | null;
  meets_threshold: boolean | null;
  /** A separate ADMINISTRATIVE fact (a чл. 130д procedure), never derived from
   *  the criteria above. The two must not be merged into one „distressed" flag. */
  in_recovery_procedure: boolean | null;

  suppressed_fields: string[] | null;

  population: number | null;
  commitments_per_capita_eur: number | null;
  /** Rank among the municipalities that published commitments in the SAME
   *  period. NULL when this município did not, or when there is no cohort. */
  per_capita_rank: number | null;
  per_capita_ranked_count: number | null;
  /** Median, not mean — the distribution is long-tailed, so a mean would sit
   *  above almost every município. */
  per_capita_median_eur: number | null;

  series: MunicipalFiscalSeriesPoint[] | null;
}

export const useMunicipalFiscal = (obshtina?: string, year?: number) => {
  const { data, isPending } = useQuery({
    queryKey: ["municipal_fiscal", obshtina ?? "", year ?? "latest"] as [
      string,
      string,
      number | string,
    ],
    enabled: !!obshtina,
    queryFn: async (): Promise<MunicipalFiscalPayload | null> => {
      const qs = new URLSearchParams({ obshtina: obshtina! });
      if (year != null) qs.set("year", String(year));
      const r = await fetch(`/api/db/municipal-fiscal?${qs}`);
      if (!r.ok) throw new Error(`municipal-fiscal: ${r.status}`);
      return r.json();
    },
    staleTime: Infinity,
  });
  return { data: data ?? null, isPending };
};
