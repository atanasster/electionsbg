// Per-official procurement lookup — DB-backed (/api/db/ref-procurement →
// ref_procurement('/officials/<slug>')). Every contractor tied to the
// official with live totals, per-year breakdown and top awarders. Powers the
// procurement section on the /officials/<slug> profile. Replaces the
// pep-by-slug manifest + shard JSON readers.

import { useMemo } from "react";
import type { ProcurementPepConnectedEntry } from "@/data/dataTypes";
import { useRefProcurement } from "@/data/parliament/useMpConnectedContracts";

export interface PepConnectedSummary {
  totalEur: number;
  totalOther: Record<string, number>;
  contractCount: number;
  contractorCount: number;
}

/** The procurement-winning contractors tied to one official (resolved by slug),
 *  with a summary rollup. Renders-nothing-friendly: returns `entries: []` when
 *  the official has no procurement linkage. */
export const usePepConnectedBySlug = (
  slug?: string | null,
): {
  entries: ProcurementPepConnectedEntry[];
  summary: PepConnectedSummary;
  isLoading: boolean;
} => {
  const query = useRefProcurement(slug ? `/officials/${slug}` : null);

  return useMemo(() => {
    const empty: PepConnectedSummary = {
      totalEur: 0,
      totalOther: {},
      contractCount: 0,
      contractorCount: 0,
    };
    if (!slug) return { entries: [], summary: empty, isLoading: false };
    if (!query.data)
      return { entries: [], summary: empty, isLoading: query.isLoading };

    const entries = query.data
      .entries as unknown as ProcurementPepConnectedEntry[];
    const summary: PepConnectedSummary = {
      totalEur: 0,
      totalOther: {},
      contractCount: 0,
      contractorCount: entries.length,
    };
    for (const e of entries) {
      summary.totalEur += e.totalEur;
      summary.contractCount += e.contractCount;
      for (const [cur, amt] of Object.entries(e.totalOther ?? {})) {
        summary.totalOther[cur] = (summary.totalOther[cur] ?? 0) + amt;
      }
    }
    return { entries, summary, isLoading: false };
  }, [slug, query.data, query.isLoading]);
};
