// Per-official procurement lookup — DB-backed (/api/db/ref-procurement →
// ref_procurement('/officials/<slug>')). Every contractor tied to the
// official with live totals, per-year breakdown and top awarders. Powers the
// procurement section on the /officials/<slug> profile. Replaces the
// pep-by-slug manifest + shard JSON readers.

import { useMemo } from "react";
import type {
  ProcurementMpConnectedContractor,
  ProcurementPepConnectedEntry,
} from "@/data/dataTypes";
import { useRefProcurement } from "@/data/parliament/useMpConnectedContracts";

/** What this hook actually returns per company: the shared ref-procurement
 *  entry fields, with relations in the pep shape ({role, shareSize?, …}). */
export type PepProcurementEntry = {
  contractorEik: string;
  contractorName: string;
  totalEur: number;
  totalOther: Record<string, number>;
  contractCount: number;
  awardCount: number;
  byYear?: ProcurementMpConnectedContractor["byYear"];
  topAwarders?: ProcurementMpConnectedContractor["topAwarders"];
  relations: ProcurementPepConnectedEntry["relations"];
};

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
  entries: PepProcurementEntry[];
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

    const entries = query.data.entries.map(
      (e): PepProcurementEntry => ({
        contractorEik: e.contractorEik,
        contractorName: e.contractorName,
        totalEur: e.totalEur,
        totalOther: e.totalOther ?? {},
        contractCount: e.contractCount,
        awardCount: e.awardCount,
        byYear: e.byYear,
        topAwarders: e.topAwarders,
        // ref_procurement passes the connections pipeline's relations jsonb
        // through verbatim; for /officials/ refs that is the pep shape
        // ({role, shareSize?, …}), not the MP shape the shared payload type
        // declares — this narrow conversion states that runtime fact.
        relations:
          e.relations as unknown as ProcurementPepConnectedEntry["relations"],
      }),
    );
    const summary: PepConnectedSummary = {
      totalEur: 0,
      totalOther: {},
      contractCount: 0,
      contractorCount: entries.length,
    };
    for (const e of entries) {
      summary.totalEur += e.totalEur;
      summary.contractCount += e.contractCount;
      for (const [cur, amt] of Object.entries(e.totalOther)) {
        summary.totalOther[cur] = (summary.totalOther[cur] ?? 0) + amt;
      }
    }
    return { entries, summary, isLoading: false };
  }, [slug, query.data, query.isLoading]);
};
