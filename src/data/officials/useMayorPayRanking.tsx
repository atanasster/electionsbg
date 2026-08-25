// The full mayor-pay ranking behind /governance/mayor-pay, served from
// `mayor_pay_ranking()` (migration 186) via /api/db/mayor-pay-ranking.
//
// Not a DbDataTable, same reasoning as `useMunicipalFiscalRanking`: the whole
// corpus is ~260 rows, small enough to arrive in one request and sort/filter
// instantly client-side. Registering a resource would add a view, a column
// registry and a search fold to serve a set that fits in memory.

import { useQuery } from "@tanstack/react-query";

/** SNAKE_CASE, matching the wire — this hand-written route does not camelCase
 *  its projection the way the `/api/db/table` registry engine does. */
export interface MayorPayRankingRow {
  obshtina: string;
  name_bg: string;
  name_en: string | null;
  oblast_code: string | null;
  mayor_name: string;
  mayor_slug: string | null;
  declaration_id: number | null;
  fiscal_year: number | null;
  source_url: string | null;
  /** The mayor's own "Годишна данъчна основа от трудови доходи" row — never a
   *  household total. NULL means "not on file", never €0. */
  income_eur: number | null;
  population: number | null;
  /** Deliberately INVERTED from every other per-capita figure on the site: a
   *  SMALL population makes this LARGE. See the SQL header (186) before
   *  reusing this pattern anywhere a "smaller is better" reading applies. */
  income_per_1000_residents_eur: number | null;
}

export const useMayorPayRanking = () => {
  const { data, isPending, isError } = useQuery({
    queryKey: ["mayor_pay_ranking"] as [string],
    queryFn: async (): Promise<MayorPayRankingRow[]> => {
      const r = await fetch("/api/db/mayor-pay-ranking?limit=1000");
      // Throw rather than degrade: an empty list here is indistinguishable
      // from "no mayor declared any pay", the opposite of the fact this page
      // exists to publish.
      if (!r.ok) throw new Error(`mayor-pay-ranking: ${r.status}`);
      return r.json();
    },
    staleTime: Infinity,
  });
  return { rows: data ?? [], isPending, isError };
};
