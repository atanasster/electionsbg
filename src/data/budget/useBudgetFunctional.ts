// COFOG spending by function, for /budget/functional.
//
// Plan: docs/plans/budget-hub-v1.md T6.8.
//
// ⚠️ THIS IS A DIFFERENT PERIMETER FROM EVERY OTHER PAGE IN THE MODULE. The
// source is Eurostat `gov_10a_exp` over S13 — general government, i.e. the state
// budget PLUS municipalities PLUS the social funds — which on FY2024 is €41.06bn
// against the state budget's €24.78bn. The payload carries `perimeter` for
// exactly that reason and no consumer may drop it.

import { useQuery } from "@tanstack/react-query";

export interface CofogRow {
  code: string;
  /** NULL on every row of every year — Eurostat delivers codes, not labels. Use
   *  `cofogLabel()` from `@/lib/cofog`. */
  nameBg: string | null;
  nameEn: string | null;
  /** Already converted to the requested basis server-side. */
  amount: number | null;
  pctOfTotal: number | null;
}

export interface BudgetFunctional {
  fiscalYear?: number | null;
  basis?: string | null;
  /** The sentence a caption must carry. Absent on the degraded sentinel. */
  perimeter?: string | null;
  source?: string | null;
  totalEur?: number | null;
  rows: CofogRow[];
}

const fetchFunctional = async (
  fy: number,
  basis: string,
): Promise<BudgetFunctional | null> => {
  try {
    const res = await fetch(
      `/api/db/budget-functional?fy=${fy}&basis=${basis}`,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as BudgetFunctional & { error?: string };
    // `/api/db/<unknown>` answers `{"error": …}` at a 200, and this route also
    // 400s with a body when `fy` is absent — neither is data.
    if (body?.error || !Array.isArray(body?.rows)) return null;
    return body;
  } catch {
    return null;
  }
};

export const useBudgetFunctional = (fy: number | null, basis = "eur") => {
  const { data, isLoading } = useQuery({
    queryKey: ["budget-functional", fy, basis] as const,
    queryFn: () => (fy == null ? null : fetchFunctional(fy, basis)),
    enabled: fy != null,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  return { functional: data ?? null, isLoading };
};
