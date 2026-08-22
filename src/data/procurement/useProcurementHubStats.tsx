// The /procurement hub stat-tile numbers, read from the pre-generated static
// file (data/procurement/derived/hub_stats.json, built by db:gen-hub-stats) —
// one small fetch instead of 2–4 live DB queries per hub load, and it carries
// the two counts too heavy to query live (flags, places). Keyed by the same
// scope key the window hook derives, so it stays scope-responsive.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
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
 *  scope not present in the file.
 *
 *  `scopeKey` FORCES a slice, for a page that has no ?pscope of its own. /governance is the
 *  case: it is a hub of hubs with no scope selector, so without this it silently resolved to
 *  the SELECTED PARLIAMENT and rendered €3.32bn / 3,481 / 227 / 332 under captions reading
 *  „договори 2007–2026" — the corpus figures are €93.56bn / 29,622 / 898 / 871. Measured on
 *  the first build of that page's KPI band, 2026-08-22. A page that quotes the corpus must
 *  ASK for the corpus, and link with ?pscope=all so the destination agrees. */
export const useProcurementHubStats = (
  scopeKey?: string,
): HubStat | undefined => {
  const { all, year, selected } = useScopeWindow();
  const key =
    scopeKey ?? (all ? "all" : year != null ? `y:${year}` : `ns:${selected}`);
  const { data } = useQuery({
    queryKey: ["procurement", "hub-stats"] as const,
    queryFn: async (): Promise<HubStatsFile> => {
      const r = await fetch(dataUrl("/procurement/derived/hub_stats.json"));
      if (!r.ok) throw new Error(`hub-stats fetch failed: ${r.status}`);
      return r.json();
    },
    staleTime: Infinity,
  });
  return data?.[key];
};
