// The /culture hub's headline figures, read from the committed blob that
// `npm run db:gen-culture-hub-stats` derives from Postgres.
//
// WHY A BLOB AND NOT LIVE CALLS: the hub is the sector's front page. Firing a
// query per tile is the payload problem the hub pattern exists to solve, and the
// figures are all whole-corpus aggregates that change only when the corpus
// reloads — so they are computed offline, where their cost does not matter.
//
// WHY IT EXISTS AT ALL: the tiles shipped quoting these numbers as FROZEN
// STRINGS, beside film figures the prerender interpolates from
// data/culture/overview.json — half the page self-updating and half not, with no
// way for a reader to tell which was which.
//
// EVERY KEY NAMES ITS BASIS, for the reason `useFundsHubStats` states at length:
// `eikExactEur` (€94.1m, the register) and `byNameEur` (€147.1m, the name match)
// are both true and 56% apart, so a field called `fundsEur` would invite a
// consumer to pick a denominator by accident. Likewise the national single-bid
// figures ride BESIDE the sector's, because the tile's claim is „typical, not
// exceptional" — a comparison, not a number.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export interface CultureHubStats {
  generatedAt: string;
  procurement: {
    contracts: number;
    eur: number;
    buyers: number;
    suppliers: number;
    singleBid: number;
    bidKnown: number;
    /** The whole-corpus rate's numerator and denominator — never pre-divided,
     *  so a consumer showing „42.0% vs 40.9%" derives both the same way. */
    nationalSingleBid: number;
    nationalBidKnown: number;
    firstDate: string | null;
  };
  risk: { grades: Record<string, number> };
  funds: {
    /** EIK-exact over CULTURE_GROUP_EIKS. A strict subset of `byNameEur`. */
    eikExactEur: number;
    eikExactProjects: number;
    /** Name-matched via cultureMatch — a floor with a fuzzy edge, and 56% above
     *  the EIK-exact figure. Never render one as the other. */
    byNameEur: number;
    byNameProjects: number;
    chitalishtaEur: number;
  };
  agri: { chitalishtaEur: number; chitalishtaRows: number };
  /** THEMATIC — joined through the OPERATION's title, not through a beneficiary
   *  set. „Interreg culture money reaching Bulgaria" and „culture bodies doing
   *  Interreg" are different questions ~4.4x apart; this is the first. */
  interreg: {
    thematicEur: number;
    partnerRows: number;
    partners: number;
    /** Of `partnerRows`. ~21% — an EIK-keyed surface answers only for these, so
     *  a figure published without this number drops four fifths of the answer. */
    rowsWithEik: number;
  };
  people: { culturalInstituteRoles: number };
}

/** 404 → null rather than a throw: a checkout that has never run the generator
 *  should render the hub without numbers, not an error. The tiles treat null as
 *  „no figure", which is the honest state — a 0 would be a claim. */
export const useCultureHubStats = () =>
  useQuery({
    queryKey: ["culture", "hub-stats"] as const,
    queryFn: async (): Promise<CultureHubStats | null> => {
      const r = await fetch(dataUrl("/culture/derived/hub_stats.json"));
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
      return r.json() as Promise<CultureHubStats>;
    },
    staleTime: Infinity,
  });
