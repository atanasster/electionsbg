// One level of the budget tree, per call.
//
// ONE LEVEL, not the whole thing: that is what keeps the drill cheap as the
// reader descends, and it is why the breadcrumb costs nothing. Migration 155's
// `budget_explorer(fy, dimension, parent, basis)` does the work; this hook only
// carries the parameters.
//
// Plan: docs/plans/budget-hub-v1.md §7.2 / T6.1.

import { useQuery } from "@tanstack/react-query";

/** The dimensions the corpus can actually answer. `economic` and `program`
 *  exist in the shard tree but are not loaded, so they are deliberately absent
 *  rather than offered and empty. */
export type BudgetDimension = "admin" | "functional";

export interface BudgetExplorerRow {
  key: string;
  nameBg: string | null;
  nameEn: string | null;
  amount: number | null;
  hasChildren: boolean;
}

export interface BudgetExplorerLevel {
  fiscalYear: number;
  dimension: BudgetDimension;
  parent: string | null;
  /** The parent's own name, from its table — so a shared deep link shows what
   *  it drilled into. Client-held labels only exist for the session that
   *  clicked, which is nobody arriving from a link. */
  parentName: string | null;
  basis: string;
  /** Named in the payload so a caption cannot silently describe the other
   *  aggregate: `admin` is the МФ state budget, `functional` is Eurostat S13
   *  general government — a wider perimeter and a different publisher. */
  source: string;
  total: number | null;
  /** The newest year this DIMENSION covers. COFOG ends where Eurostat ends
   *  while the admin grain runs to the current budget year, so an empty level
   *  needs this to say „the corpus stops in 2024" rather than „nothing here". */
  coverageLatestYear: number | null;
  rows: BudgetExplorerRow[];
}

const fetchLevel = async (
  fy: number,
  dimension: BudgetDimension,
  parent: string | null,
  basis: string,
): Promise<BudgetExplorerLevel | null> => {
  const qs = new URLSearchParams({ fy: String(fy), dimension, basis });
  if (parent) qs.set("parent", parent);
  try {
    const res = await fetch(`/api/db/budget-explorer?${qs}`);
    if (!res.ok) return null;
    return (await res.json()) as BudgetExplorerLevel | null;
  } catch {
    // null on ANY failure including a thrown one — `!res.ok` alone leaves React
    // Query settling with `undefined`, so a fallback gated on `=== null` would
    // be unreachable.
    return null;
  }
};

export const useBudgetExplorer = (
  fy: number | null,
  dimension: BudgetDimension,
  parent: string | null,
  basis: string,
) => {
  const { data, isLoading } = useQuery({
    queryKey: ["budget-explorer", fy, dimension, parent, basis] as const,
    queryFn: () =>
      fy == null ? null : fetchLevel(fy, dimension, parent, basis),
    enabled: fy != null,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  return { level: data ?? null, isLoading };
};
