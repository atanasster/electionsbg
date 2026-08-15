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
  /** T9.8 — the split the Доклад publishes and the loader used to drop.
   *  `central + territorial = total`; `municipal` is a SUBSET of territorial
   *  and `municipalOwnRevenue` a subset of that, so the three never sum. */
  positionsCentral: number | null;
  positionsTerritorial: number | null;
  positionsMunicipal: number | null;
  positionsMunicipalOwnRevenue: number | null;
  /** A SUBSET of `positionsVacant`, never a peer: 5 729 of 12 348 in FY2025. */
  positionsVacantOverSixMonths: number | null;
  /** COUNTS OF BODIES, not of people — 114 + 467 = 581 in FY2025. NULL before
   *  2021, where the Доклад publishes none; a zero would claim the state has
   *  no administrative structures. */
  structuresCentral: number | null;
  structuresTerritorial: number | null;
  /** Summed server-side, so it is NULL when either part is rather than 0. */
  structuresTotal: number | null;
}

/** One ministry's own programme-budget report. A DIFFERENT publisher from the
 *  national series above — executed FTE inside one body, not щатни бройки
 *  across the administration — so these are never summed with it, averaged
 *  into it, or compared against it. */
export interface BudgetPersonnelUnit {
  nodeId: string;
  nameBg: string | null;
  nameEn: string | null;
  headcount: number | null;
  personnelEur: number | null;
  avgCostPerFteEur: number | null;
}

/** How small a slice the unit list is. Stated against §II of the state budget,
 *  a complete published figure — NOT against the executed expenditure recorded
 *  per unit, which exists for 8 of 48 units and would make this „7 of 8". */
export interface BudgetPersonnelCoverage {
  units: number;
  personnelEur: number | null;
  unitsExpenditureEur: number | null;
  stateExpenditureEur: number | null;
}

export interface BudgetPersonnel {
  positionsBasis?: string | null;
  headcountBasis?: string | null;
  unitBasis?: string | null;
  points: BudgetPersonnelPoint[];
  units?: BudgetPersonnelUnit[];
  /** The year `units` is for. NOT the newest national year — the Доклад runs to
   *  2025 while the programme-budget reports reach 2024. */
  unitsFiscalYear?: number | null;
  unitYears?: number[];
  unitsCoverage?: BudgetPersonnelCoverage | null;
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
