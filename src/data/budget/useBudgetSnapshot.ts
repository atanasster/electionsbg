// One fiscal year's КФП snapshot — the section frame and its lines.
//
// Plan: docs/plans/budget-hub-v1.md T6.3/T6.4. Backs /budget/revenue and
// /budget/spending, which are the same page with a different `kind`.

import { useQuery } from "@tanstack/react-query";

export interface BudgetSnapshotLine {
  ord: number;
  depth: number;
  isSubtotal: boolean;
  labelBg: string | null;
  labelEn: string | null;
  groupLabelBg: string | null;
  executedEur: number | null;
}

export interface BudgetSnapshotSection {
  sectionCode: string;
  kind: string;
  /** NOT derivable from `kind`: sections II and III are both 'expenditure' and
   *  III is the EU contribution. This is the join key onto the year figures. */
  series: string;
  labelBg: string | null;
  labelEn: string | null;
  /** The PUBLISHED section total — not the sum of its lines. Sections III and
   *  IV carry a total and no lines at all. */
  executedEur: number | null;
  plannedEur: number | null;
  lines: BudgetSnapshotLine[];
}

export interface BudgetSnapshot {
  fiscalYear: number;
  period: string | null;
  basis: string;
  sections: BudgetSnapshotSection[];
}

const fetchSnapshot = async (
  fy: number,
  kind: string,
  basis: string,
): Promise<BudgetSnapshot | null> => {
  try {
    const res = await fetch(
      `/api/db/budget-snapshot?fy=${fy}&kind=${kind}&basis=${basis}`,
    );
    if (!res.ok) return null;
    return (await res.json()) as BudgetSnapshot | null;
  } catch {
    return null;
  }
};

export const useBudgetSnapshot = (
  fy: number | null,
  kind: string,
  basis: string,
) => {
  const { data, isLoading } = useQuery({
    queryKey: ["budget-snapshot", fy, kind, basis] as const,
    queryFn: () => (fy == null ? null : fetchSnapshot(fy, kind, basis)),
    enabled: fy != null,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  return { snapshot: data ?? null, isLoading };
};
