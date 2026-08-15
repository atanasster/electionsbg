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
  /** What this unit AWARDED in the same fiscal year (migration 157) — contracts
   *  SIGNED in the window, not money paid in it, since a contract signed in
   *  2024 is paid over years.
   *
   *  ⚠️ NULL COVERS TWO DIFFERENT STATES and the consumer must separate them.
   *  8 of 48 budgeted units have no row in a given year: 5 carry no `eik` —
   *  unmatched to any awarder, so „bought nothing" is not something the name
   *  match can assert — and 3 are matched with no award recorded in that window,
   *  which IS a fact about the year. `eik` is the discriminator. */
  procurementEur: number | null;
  procurementCount: number | null;
  /** DISTINCT contractors in that year present in `company_politicians`.
   *
   *  ⚠️ NOT summable across years, and not comparable with the figure the
   *  retired `ministry_procurement.json` carried: that one counted only
   *  contractors whose TRUNCATED `topAwarders` list named this buyer, so it was
   *  a floor — 2 against 18 for Министерство на здравеопазването. */
  mpContractorCount: number | null;
  /** How many registry nodes carry this unit's EIK. > 1 means the footprint is
   *  one legal entity's and appears on more than one row — „Министерство на
   *  земеделието" and „Министерство на земеделието и храните" are one ministry
   *  across a rename, and both carry the same appropriation in 2023 and 2024.
   *  Each row's figure is right; what must not happen is a reader adding them. */
  eikNodeCount: number | null;
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
