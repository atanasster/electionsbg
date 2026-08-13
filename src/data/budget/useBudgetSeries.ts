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

const fetchSeries = async (series: string): Promise<BudgetSeries | null> => {
  try {
    const res = await fetch(`/api/db/budget-series?series=${series}`);
    if (!res.ok) return null;
    return (await res.json()) as BudgetSeries | null;
  } catch {
    return null;
  }
};

export const useBudgetSeries = (series: string) => {
  const { data, isLoading } = useQuery({
    queryKey: ["budget-series", series] as const,
    queryFn: () => fetchSeries(series),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  return { series: data ?? null, isLoading };
};
