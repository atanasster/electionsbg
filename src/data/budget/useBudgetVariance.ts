// План → изменен план → отчет, per spending unit, for /budget/deviations.
//
// Plan: docs/plans/budget-hub-v1.md §7.3 / T6.5.
//
// The payload carries the COVERAGE PAIR beside the ranking, and that is not
// decoration: 8 of 48 units filed an execution report in the best year, and
// none at all in six of the nine. A top-N served without those two numbers
// asserts „these are the biggest deviations" over a corpus that cannot support
// it (§2.3). Both are UNIT counts — the by-admin rows are (nodeId × kind), so
// a row count read as a number of ministries over-states by 1.8x-2.9x.

import { useQuery } from "@tanstack/react-query";

export interface BudgetVarianceRow {
  nodeId: string;
  nameBg: string | null;
  nameEn: string | null;
  /** The appropriation as the budget LAW voted it. */
  plannedEur: number | null;
  /** After any ЗИД. NULL where no amendment document exists for the year —
   *  which is most years: only two amendment documents exist in the corpus. */
  amendedEur: number | null;
  executedEur: number | null;
  /** executed − planned. „Spent more than the law appropriated." */
  deltaVsLawEur: number | null;
  /** executed − COALESCE(amended, planned). „Spent more than the appropriation
   *  actually in force." A single „отклонение" collapses these two into one
   *  ambiguous word and silently picks the first. */
  deltaVsAmendedEur: number | null;
}

export interface BudgetVariance {
  /** ABSENT on the route's degraded sentinel — `/api/db/budget-variance`
   *  answers `{rows: [], coveredUnits: null, totalUnits: null}` when migration
   *  155 is missing, and that object carries no year at all. Typed as it
   *  actually arrives, so a consumer cannot interpolate `undefined` into a
   *  sentence or compare it against a calendar. */
  fiscalYear?: number | null;
  coveredUnits: number | null;
  totalUnits: number | null;
  /** Whether the fiscal year has CLOSED, straight from `budget_fiscal_year`.
   *  Never inferred from „is this the newest year we hold": those disagree
   *  every January, when the just-closed year is still the newest one. */
  complete?: boolean | null;
  rows: BudgetVarianceRow[];
}

const fetchVariance = async (
  fy: number,
  limit: number,
): Promise<BudgetVariance | null> => {
  try {
    const res = await fetch(`/api/db/budget-variance?fy=${fy}&limit=${limit}`);
    if (!res.ok) return null;
    return (await res.json()) as BudgetVariance;
  } catch {
    return null;
  }
};

export const useBudgetVariance = (fy: number | null, limit = 50) => {
  const { data, isLoading } = useQuery({
    queryKey: ["budget-variance", fy, limit] as const,
    queryFn: () => (fy == null ? null : fetchVariance(fy, limit)),
    enabled: fy != null,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  return { variance: data ?? null, isLoading };
};
