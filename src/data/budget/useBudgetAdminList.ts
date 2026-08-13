// The spending-unit list behind /budget/ministries and the hub finder.
//
// Plan: docs/plans/budget-hub-v1.md T6.2. Server-ranked by amount (migration
// 155 orders inside the LIMIT — ranking outside it returns an arbitrary n).

import { useQuery } from "@tanstack/react-query";

export interface BudgetAdminRow {
  nodeId: string;
  nameBg: string | null;
  nameEn: string | null;
  eik: string | null;
  amount: number | null;
  /** Whether this unit reported execution IN THE REQUESTED YEAR — the SQL's
   *  LEFT JOIN is already year-filtered, so this is per-year and not all-time.
   *  NOT a quality signal: 8 of 48 units have one in the best year, and none at
   *  all in a year that has not closed, so its absence is the ministry's
   *  silence — or simply the calendar. */
  hasExecution: boolean;
}

const fetchList = async (
  fy: number,
  q: string | null,
): Promise<BudgetAdminRow[]> => {
  const params = new URLSearchParams({ fy: String(fy) });
  if (q) params.set("q", q);
  try {
    const res = await fetch(`/api/db/budget-ministries?${params}`);
    if (!res.ok) return [];
    const body = (await res.json()) as { rows?: BudgetAdminRow[] } | null;
    return body?.rows ?? [];
  } catch {
    return [];
  }
};

export const useBudgetAdminList = (fy: number | null, q: string | null) => {
  const { data, isLoading } = useQuery({
    queryKey: ["budget-ministries", fy, q ?? ""] as const,
    queryFn: () => (fy == null ? [] : fetchList(fy, q)),
    enabled: fy != null,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  return { rows: data ?? [], isLoading };
};
