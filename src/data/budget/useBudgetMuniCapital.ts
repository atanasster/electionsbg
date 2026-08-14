// Municipal capital programmes (поименни списъци), for
// /budget/municipal/capital.
//
// Plan: docs/plans/budget-hub-v1.md §8 / T6.14.
//
// ⚠️ THIS IS NOT A NATIONAL RETURN. It is whichever municipalities published a
// поименен списък and had it parsed — 9 of 265 in 2022, 24 in 2025, 1 in 2026.
// `totalMunicipalities` travels beside `covered.municipalityCount` for that
// reason, and the payload deliberately has no „national" block: a total from a
// 9% sample is the one thing this corpus must never be used for.

import { useQuery } from "@tanstack/react-query";

export interface CapitalMuniRow {
  obshtina: string;
  nameBg: string | null;
  nameEn: string | null;
  projectCount: number;
  totalEur: number | null;
  stateSubsidyEur: number | null;
  ownFundsEur: number | null;
  debtEur: number | null;
  euFundsEur: number | null;
  otherEur: number | null;
  /** NULL on almost every row — most municipalities publish no carry-over
   *  column at all, so zero would assert they carried nothing forward. */
  carryOverEur: number | null;
}

export interface BudgetMuniCapital {
  fiscalYear?: number | null;
  yearsAvailable?: number[] | null;
  /** 265 — the denominator every figure here is read against. */
  totalMunicipalities?: number | null;
  covered?: {
    municipalityCount: number;
    projectCount: number;
    totalEur: number | null;
  } | null;
  /** ⚠️ The mix has its OWN, much smaller coverage: only two municipalities in
   *  the whole corpus publish a source breakdown. On FY2023 that is ONE, worth
   *  €41.8m of the €589.4m covered — so these figures must never be labelled
   *  with `covered.municipalityCount`. */
  sources?: {
    municipalityCount?: number | null;
    projectCount?: number | null;
    /** What the municipalities WITH a breakdown are worth, the denominator the
     *  mix's own shares belong to. */
    totalEur?: number | null;
    stateSubsidyEur: number | null;
    ownFundsEur: number | null;
    debtEur: number | null;
    euFundsEur: number | null;
    otherEur: number | null;
    carryOverEur: number | null;
  } | null;
  rows: CapitalMuniRow[];
}

const fetchCapital = async (
  fy: number | null,
): Promise<BudgetMuniCapital | null> => {
  const qs = fy == null ? "" : `?fy=${fy}`;
  try {
    const res = await fetch(`/api/db/budget-municipal-capital${qs}`);
    if (!res.ok) return null;
    const body = (await res.json()) as BudgetMuniCapital & { error?: string };
    // `/api/db/<unknown>` answers `{"error": …}` at a 200.
    if (body?.error || !Array.isArray(body?.rows)) return null;
    return body;
  } catch {
    return null;
  }
};

export const useBudgetMuniCapital = (fy: number | null) => {
  const { data, isLoading } = useQuery({
    queryKey: ["budget-municipal-capital", fy] as const,
    queryFn: () => fetchCapital(fy),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  return { capital: data ?? null, isLoading };
};
