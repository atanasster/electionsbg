// The /procurement hub stat-tile numbers, read from the pre-generated static
// file (data/procurement/derived/hub_stats.json, built by db:gen-hub-stats) —
// one small fetch instead of 2–4 live DB queries per hub load, and it carries
// the two counts too heavy to query live (flags, places). Keyed by the same
// scope key the window hook derives, so it stays scope-responsive.

import { useQuery } from "@tanstack/react-query";
import { useScopeWindow } from "@/data/scope/useScopeWindow";

export interface HubStat {
  totalEur: number;
  contracts: number;
  contractors: number;
  connected: number;
  tenders: number;
  appeals: number;
  ngos: number;
  flags: number;
  places: number;
}

type HubStatsFile = Record<string, HubStat>;

/** The stat block for the active ?pscope, or undefined while loading / on a
 *  scope not present in the file. */
export const useProcurementHubStats = (): HubStat | undefined => {
  const { all, year, selected } = useScopeWindow();
  const key = all ? "all" : year != null ? `y:${year}` : `ns:${selected}`;
  const { data } = useQuery({
    queryKey: ["procurement", "hub-stats"] as const,
    queryFn: async (): Promise<HubStatsFile> => {
      const r = await fetch("/procurement/derived/hub_stats.json");
      if (!r.ok) throw new Error(`hub-stats fetch failed: ${r.status}`);
      return r.json();
    },
    staleTime: Infinity,
  });
  return data?.[key];
};
