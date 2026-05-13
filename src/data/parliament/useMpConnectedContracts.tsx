// SPA hook for the procurement cross-reference. Fetches the full
// mp_connected.json once (small — single-digit kB at current data volume)
// and indexes by mpId so per-candidate tiles + the standalone procurement
// page can both read it without a second round-trip.
//
// If the file is absent (404) the hook treats the result as empty rather
// than throwing. The /update-procurement skill writes this file when paired
// with /update-connections; in environments without procurement data the
// SPA renders nothing rather than failing.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  ProcurementMpConnectedContractor,
  ProcurementMpConnectedFile,
} from "@/data/dataTypes";
import { useMps } from "./useMps";
import { dataUrl } from "@/data/dataUrl";

const fetchMpConnected =
  async (): Promise<ProcurementMpConnectedFile | null> => {
    const response = await fetch(
      dataUrl("/procurement/derived/mp_connected.json"),
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`fetch failed: ${response.status} ${response.url}`);
    }
    return (await response.json()) as ProcurementMpConnectedFile;
  };

// Internal: one-time fetch + memoised index by mpId. Every call to the
// per-MP hook below shares the same query cache.
const useMpConnectedFile = () =>
  useQuery({
    queryKey: ["procurement", "mp_connected"] as const,
    queryFn: fetchMpConnected,
    staleTime: Infinity,
  });

export interface MpConnectedSummary {
  // Sum across all currencies — raw, mixed-currency-caveat-applies. Used
  // only for ranking + the at-a-glance "total awarded" pill on the tile.
  // The UI splits BGN vs EUR explicitly when rendering individual rows.
  totalsByCurrency: Record<string, number>;
  contractCount: number;
  awardCount: number;
}

/** Returns the MP-connected contractors for one candidate (resolved by name),
 * along with a summary rollup across them. Renders nothing-friendly: returns
 * `entries: []` when the data file is missing or the MP has no connected
 * contractors. */
export const useMpConnectedContracts = (
  name?: string | null,
): {
  entries: ProcurementMpConnectedContractor[];
  summary: MpConnectedSummary;
  isLoading: boolean;
} => {
  const { findMpByName } = useMps();
  const mpId = findMpByName(name)?.id ?? null;
  const q = useMpConnectedFile();

  return useMemo(() => {
    if (mpId == null || !q.data) {
      return {
        entries: [],
        summary: { totalsByCurrency: {}, contractCount: 0, awardCount: 0 },
        isLoading: mpId == null ? false : q.isLoading,
      };
    }
    const entries = q.data.entries.filter((e) => e.mpId === mpId);
    const summary: MpConnectedSummary = {
      totalsByCurrency: {},
      contractCount: 0,
      awardCount: 0,
    };
    for (const e of entries) {
      for (const [cur, amt] of Object.entries(e.totalByCurrency)) {
        summary.totalsByCurrency[cur] =
          (summary.totalsByCurrency[cur] ?? 0) + amt;
      }
      summary.contractCount += e.contractCount;
      summary.awardCount += e.awardCount;
    }
    return { entries, summary, isLoading: false };
  }, [mpId, q.data, q.isLoading]);
};
