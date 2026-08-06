// The /parliament hub's numbers, read from one pre-generated blob (~6 KB for all nine
// parliaments) instead of the ~1.65 MB of full derived artifacts the seven preview tiles
// used to fetch between them.
//
// Mirrors useProcurementHubStats: keyed by the same NS the rest of the module derives from
// the header's election picker, and returning `undefined` for a parliament with no data —
// which is what drives the named empty state rather than a grid of zeroes.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";

export interface HubTileStats {
  sessions: number;
  items: number;
  billsSecondReading: number;
  membersVoting: number;
  /** Members the UMAP placed — fewer than membersVoting, since the projection drops those
   *  with too little signal. The map's own tile must quote this, not the roll. */
  membersProjected: number;
  groups: number;
  /** Weighted: Σpresent / Σitems. Named so nobody re-derives a simple mean by accident. */
  attendanceWeighted: number;
  cohesionMean: number;
  leastUnifiedGroup: string | null;
  leastUnifiedValue: number | null;
}

export interface HubNsStats {
  lastDate: string;
  coveredFrom: string;
  coveredTo: string;
  /** `partial` means the ingest starts mid-term — the 44th holds five months of four
   *  years. It renders identically to `full` unless the page says so. */
  coverage: "full" | "partial";
  inRecessDays: number;
  tiles: HubTileStats;
  seeds: { similarity?: string; pair?: string };
}

interface HubStatsFile {
  computedAt: string;
  byNs: Record<string, HubNsStats>;
}

const queryFn = async (): Promise<HubStatsFile | undefined> => {
  const r = await fetch(dataUrl("/parliament/votes/derived/hub_stats.json"));
  if (r.status === 404) return undefined;
  if (!r.ok) throw new Error(`hub-stats fetch failed: ${r.status}`);
  return r.json();
};

/** The stat block for the selected parliament, or undefined when it has none.
 *
 *  `undefined` is a real answer here, not a loading artefact: four of the thirteen
 *  elections in the picker (2005, 2009, 2013, 2014 → NS 40–43) map to parliaments that
 *  published no roll-call votes at all, and `?elections=` is preserved across navigation,
 *  so arriving from a 2009 page is an ordinary path rather than an edge case. */
export const useParliamentHubStats = (): {
  stats: HubNsStats | undefined;
  ns: string | null;
  isLoading: boolean;
} => {
  const { selected } = useElectionContext();
  const { data, isLoading } = useQuery({
    queryKey: ["parliament", "hub-stats"] as const,
    queryFn,
    staleTime: Infinity,
  });
  const ns = electionToNsFolder(selected);
  return { stats: ns ? data?.byNs?.[ns] : undefined, ns, isLoading };
};
