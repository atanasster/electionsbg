// One fiscal year's headline figures, for /budget/execution.
//
// Plan: docs/plans/budget-hub-v1.md T6.7. `/api/db/budget-year` returns all five
// КФП series at all three bases in one ~400-byte object, which is the whole
// reason this page needs no artifact fetch.

import { useQuery } from "@tanstack/react-query";

/** actual / planned / projected for one series. `projected` is NULL throughout
 *  the corpus today — a slot the ingest can fill, not a figure to render as 0. */
export interface BudgetFigure {
  actual: number | null;
  planned: number | null;
  projected: number | null;
}

export type BudgetSeriesKey =
  | "revenue"
  | "expenditure"
  | "euContribution"
  | "balance"
  | "financing";

export interface BudgetYear {
  fiscalYear?: number | null;
  asOf?: string | null;
  basis?: string | null;
  /** Whether the year has CLOSED. Never inferred from „is this the newest year",
   *  which disagrees every January. */
  complete?: boolean | null;
  gdpEur?: number | null;
  population?: number | null;
  figures?: Partial<Record<BudgetSeriesKey, BudgetFigure>> | null;
  yearsAvailable?: number[] | null;
}

const fetchYear = async (fy: number): Promise<BudgetYear | null> => {
  try {
    const res = await fetch(`/api/db/budget-year?fy=${fy}`);
    if (!res.ok) return null;
    const body = (await res.json()) as BudgetYear & { error?: string };
    // `/api/db/<unknown>` answers `{"error": …}` at a 200, so a mistyped route
    // is not an error any consumer sees — it is a page that quietly shows
    // nothing. Same trap that cost /budget/law a build.
    if (body?.error || body?.figures == null) return null;
    return body;
  } catch {
    return null;
  }
};

export const useBudgetYear = (fy: number | null) => {
  const { data, isLoading } = useQuery({
    queryKey: ["budget-year", fy] as const,
    queryFn: () => (fy == null ? null : fetchYear(fy)),
    enabled: fy != null,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  return { year: data ?? null, isLoading };
};
