// React Query hooks for the per-fiscal-year reconciliation files.
//
// data/budget/reconciliation/<YYYY>/by-<dimension>.json holds one
// ReconciliationRow per (node, kind). A file only exists for fiscal years
// whose `index.years[].dimensions.<dimension>` is true; the hooks return null
// (a normal 404) for any other year.
//
// These are whole-corpus-per-year files — the right grain for the dashboard
// tiles, which each show one selected year. The ministry detail screen does
// NOT use them; it reads the pre-sliced ministries/<nodeId>.json rollup
// (see useBudgetMinistryRollup in useBudget.tsx).

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { ReconciliationRow } from "./types";

const fetchReconciliation = async (
  fiscalYear: number,
  dimension: "admin" | "economic" | "program",
): Promise<ReconciliationRow[] | null> => {
  const r = await fetch(
    dataUrl(`/budget/reconciliation/${fiscalYear}/by-${dimension}.json`),
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as ReconciliationRow[];
};

// Admin-dimension reconciliation for one fiscal year. Pass `null` to disable
// the query (e.g. when the selected year has no admin data).
export const useBudgetAdminReconciliation = (fiscalYear: number | null) =>
  useQuery({
    queryKey: ["budget", "reconciliation", "admin", fiscalYear] as const,
    queryFn: () => fetchReconciliation(fiscalYear as number, "admin"),
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
