// The administration's establishment over time, for /budget/personnel.
//
// Plan: docs/plans/budget-hub-v1.md T6.9. One row per year, national, from the
// Доклад за състоянието на администрацията.
//
// ⚠️ TWO HEADCOUNTS THAT ARE NOT COMPARABLE. `positions*` are budgeted POSTS
// (щатни бройки); `nsiHeadcount` is НСИ's count of PERSONS EMPLOYED at
// December, from a separate table inside the same document and on its own
// methodology. They differ by ~35 000 on every recent year, and their
// difference means nothing — „unfilled posts" is `positionsVacant`, which the
// source publishes directly. The payload names both bases for that reason.

import { useQuery } from "@tanstack/react-query";

export interface BudgetPersonnelPoint {
  fiscalYear: number;
  positionsTotal: number | null;
  positionsFilled: number | null;
  positionsVacant: number | null;
  nsiHeadcount: number | null;
  /** NULL on every row of every year — the Доклад publishes no payroll. Never
   *  render it as zero. */
  payrollEur: number | null;
}

export interface BudgetPersonnel {
  positionsBasis?: string | null;
  headcountBasis?: string | null;
  points: BudgetPersonnelPoint[];
}

const fetchPersonnel = async (): Promise<BudgetPersonnel | null> => {
  try {
    const res = await fetch("/api/db/budget-personnel");
    if (!res.ok) return null;
    const body = (await res.json()) as BudgetPersonnel & { error?: string };
    // `/api/db/<unknown>` answers `{"error": …}` at a 200.
    if (body?.error || !Array.isArray(body?.points)) return null;
    return body;
  } catch {
    return null;
  }
};

export const useBudgetPersonnel = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["budget-personnel"] as const,
    queryFn: fetchPersonnel,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  return { personnel: data ?? null, isLoading };
};
