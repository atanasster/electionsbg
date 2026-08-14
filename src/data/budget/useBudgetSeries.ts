// The КФП time series behind every /budget page's „how it changes" panel.
//
// Plan: docs/plans/budget-hub-v1.md §7.1 panel 3.

import { useQuery } from "@tanstack/react-query";

export interface BudgetSeriesPoint {
  fiscalYear: number;
  period: string;
  series: string;
  executedEur: number | null;
  plannedEur: number | null;
}

export interface BudgetSeries {
  basis: string;
  /** ALWAYS true for this feed, and carried in the payload rather than left to
   *  a consumer's memory: КФП lines are cumulative year-to-date, so summing
   *  periods double-counts by roughly n(n+1)/2. */
  cumulative: boolean;
  points: BudgetSeriesPoint[];
}

const fetchSeries = async (
  series: string | null,
): Promise<BudgetSeries | null> => {
  try {
    // No `series` means EVERY series, which is what the SQL already does with a
    // NULL third argument. The trend chart needs revenue, expenditure, the EU
    // contribution and the balance together — three separate calls would give
    // it three independently-cached windows, and the projection is only
    // coherent when all four come from one read.
    const res = await fetch(
      `/api/db/budget-series${series ? `?series=${encodeURIComponent(series)}` : ""}`,
    );
    if (!res.ok) return null;
    return (await res.json()) as BudgetSeries | null;
  } catch {
    return null;
  }
};

export const useBudgetSeries = (series: string | null) => {
  const { data, isLoading } = useQuery({
    queryKey: ["budget-series", series ?? "all"] as const,
    queryFn: () => fetchSeries(series),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  return { series: data ?? null, isLoading };
};
