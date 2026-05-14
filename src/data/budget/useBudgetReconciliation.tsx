// React Query hook for the per-fiscal-year reconciliation files.
//
// data/budget/reconciliation/<YYYY>/by-admin.json holds one ReconciliationRow
// per (ministry, kind) — the State Budget Law's appropriations. The file only
// exists for fiscal years whose `index.years[].dimensions.admin` is true; the
// hook returns null (a normal 404) for any other year.

import { useQueries, useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useBudgetIndex } from "./useBudget";
import type { Money, ReconciliationRow } from "./types";

const fetchReconciliation = async (
  fiscalYear: number,
  dimension: "admin" | "economic",
): Promise<ReconciliationRow[] | null> => {
  const r = await fetch(
    dataUrl(`/budget/reconciliation/${fiscalYear}/by-${dimension}.json`),
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as ReconciliationRow[];
};

const fetchByAdmin = (fiscalYear: number) =>
  fetchReconciliation(fiscalYear, "admin");

// Admin-dimension reconciliation for one fiscal year. Pass `null` to disable
// the query (e.g. when the selected year has no admin data).
export const useBudgetAdminReconciliation = (fiscalYear: number | null) =>
  useQuery({
    queryKey: ["budget", "reconciliation", "admin", fiscalYear] as const,
    queryFn: () => fetchByAdmin(fiscalYear as number),
    enabled: fiscalYear != null,
    staleTime: Infinity,
  });

// Economic-dimension reconciliation for one fiscal year — the plan-vs-actual
// variance per economic node (section + line). Pass `null` to disable.
export const useBudgetEconomicReconciliation = (fiscalYear: number | null) =>
  useQuery({
    queryKey: ["budget", "reconciliation", "economic", fiscalYear] as const,
    queryFn: () => fetchReconciliation(fiscalYear as number, "economic"),
    enabled: fiscalYear != null,
    staleTime: Infinity,
  });

// One spending unit's appropriations across every fiscal year that has law
// (admin-dimension) data — drives the ministry detail screen.
export interface MinistryYearFigures {
  fiscalYear: number;
  revenue: Money | null;
  expenditure: Money | null;
  balance: Money | null;
}

export interface MinistryDetail {
  nodeId: string;
  nameBg: string;
  nameEn: string;
  years: MinistryYearFigures[];
}

export const useBudgetMinistry = (
  nodeId: string | undefined,
): { data: MinistryDetail | null; isLoading: boolean } => {
  const { data: index, isLoading: indexLoading } = useBudgetIndex();
  const adminYears = (index?.years ?? [])
    .filter((y) => y.dimensions?.admin)
    .map((y) => y.fiscalYear)
    .sort((a, b) => a - b);

  const results = useQueries({
    queries: adminYears.map((year) => ({
      queryKey: ["budget", "reconciliation", "admin", year] as const,
      queryFn: () => fetchByAdmin(year),
      staleTime: Infinity,
    })),
  });

  const isLoading = indexLoading || results.some((r) => r.isLoading);
  if (!nodeId) return { data: null, isLoading };

  const years: MinistryYearFigures[] = [];
  let nameBg = "";
  let nameEn = "";
  results.forEach((res, i) => {
    const rows = res.data;
    if (!rows) return;
    const mine = rows.filter((r) => r.nodeId === nodeId);
    if (mine.length === 0) return;
    nameBg = nameBg || mine[0].nodeNameBg;
    nameEn = nameEn || mine[0].nodeNameEn;
    const pick = (kind: string): Money | null =>
      mine.find((r) => r.kind === kind)?.planned ?? null;
    years.push({
      fiscalYear: adminYears[i],
      revenue: pick("revenue"),
      expenditure: pick("expenditure"),
      balance: pick("balance"),
    });
  });

  if (years.length === 0) return { data: null, isLoading };
  return {
    data: {
      nodeId,
      nameBg,
      nameEn,
      years: years.sort((a, b) => a.fiscalYear - b.fiscalYear),
    },
    isLoading,
  };
};
