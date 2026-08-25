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
// `eikExactEur` (the register's own bodies) and `byNameEur` (the name match) are
// both true and far apart — the name arm is the larger by tens of percent — so a
// field called `fundsEur` would invite a consumer to pick a denominator by
// accident. ⚠️ Read the CURRENT figures from the blob, never from this comment:
// it quoted „€94.1m … 56% apart" until 2026-08-25, by which point the register
// had widened and the true gap was 38.8% — a frozen pair in the very header that
// exists to condemn frozen strings. Likewise the national single-bid
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
    /** EIK-exact over CULTURE_GROUP_EIKS. ⚠️ NOT a subset of `byNameEur`, though
     *  it nearly is — see `eikExactAlsoByName` below for the measured overlap.
     *  This comment said „a strict subset" until 2026-08-25 and was wrong. */
    eikExactEur: number;
    eikExactProjects: number;
    /** Name-matched via cultureMatch — a floor with a fuzzy edge, and far above
     *  the EIK-exact figure. Never render one as the other. */
    byNameEur: number;
    byNameProjects: number;
    chitalishtaEur: number;
    /** How many of `eikExactProjects` the NAME arm also reaches — 46 of 47 as
     *  measured 2026-08-25, NOT all of them. The EIK arm is therefore ALMOST a
     *  subset and not one: ЕИК 000669802 (Национална професионална гимназия по
     *  полиграфия и фотография) is in the register as a national art school and
     *  its name carries no culture stem.
     *
     *  It rides in the blob rather than in the copy because a frozen „46 of 47"
     *  cannot self-correct, and this relationship moves whenever the register or
     *  the corpus does. `culture_fund_sources.data.test.ts` re-derives it.
     *
     *  ⚠️ OPTIONAL ON THE WIRE, and that is the accurate contract rather than
     *  defensive padding: this blob ships via `bucket:sync`, a DIFFERENT command
     *  from `npm run deploy`, so a bundle can load against a blob minted before
     *  the field existed. Absent means „not measured yet" — never zero, which
     *  would be the claim that the two arms are disjoint. A consumer must branch
     *  on it and say nothing about the relationship rather than guess one. */
    eikExactAlsoByName?: number;
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
