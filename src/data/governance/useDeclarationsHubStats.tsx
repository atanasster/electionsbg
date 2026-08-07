// The /governance/declarations tile figures — one ~1 KB blob for six tiles.
//
// Six leaderboards, each backed by its own matview. Counting them live would be six queries
// on a page whose only job is to point elsewhere; the alternative that shipped was no
// figures at all, which leaves a reader unable to tell whether „Автомобили на депутати" is
// about forty cars or two thousand.
//
// `undefined` is an answer, not a loading state: on a checkout with no generated blob the
// tiles render without numbers, exactly as they did before, rather than showing zeroes.
//
// THE PER-PARLIAMENT HALF IS THE POINT. /mp-assets and /mp-cars both open with
// `scope = "ns"`, i.e. filtered to the selected election, and the hub tile carries
// `?elections` forward — so a lifetime total on those two tiles would disagree with their
// destination on every parliament (621 cars against the 52nd's 65). `nsStats` resolves the
// selected election through the SAME helper those screens filter with, so the tile and the
// page it opens are one number by construction rather than by coincidence.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { mpAssetsNsScope } from "@/screens/utils/mpAssetsScope";

export interface DeclarationsNsStats {
  mpsWithAssets: number;
  cars: number;
  carOwners: number;
}

export interface DeclarationsHubStats {
  computedAt: string;
  /** What /persons LISTS on arrival — its default tier='P' public-figure floor. NOT the
   *  identity layer's 126,004, and not person_browse_table's 128,584. */
  people: number;
  peopleWithDeclaration: number;
  /** What /officials/assets opens on — its is_exec filter, not the table's 19,036. */
  officials: number;
  /** What /mp/companies lists, from that page's own index. */
  companies: number;
  companyMps: number;
  /** Keyed by `ns` — the numeric parliament ('52'), plus the 'all' roll-up. */
  byNs: Record<string, DeclarationsNsStats>;
}

const queryFn = async (): Promise<DeclarationsHubStats | undefined> => {
  const r = await fetch(dataUrl("/governance/declarations_hub_stats.json"));
  if (r.status === 404) return undefined;
  if (!r.ok) throw new Error(`declarations-hub-stats: ${r.status}`);
  return r.json();
};

export const useDeclarationsHubStats = (): {
  stats: DeclarationsHubStats | undefined;
  /** The selected parliament's slice, or undefined when that parliament has no rows. */
  nsStats: DeclarationsNsStats | undefined;
} => {
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["governance", "declarations-hub-stats"] as const,
    queryFn,
    staleTime: Infinity,
  });

  // Exactly the destination screens' filter value: the NS folder when the selected election
  // maps to one, 'all' otherwise — which is also what they fall back to for a non-
  // parliamentary selection. Duplicating this rule by hand is how the two would drift.
  const key = mpAssetsNsScope("ns", electionToNsFolder(selected)).val;

  return { stats: data, nsStats: data?.byNs?.[key] };
};
