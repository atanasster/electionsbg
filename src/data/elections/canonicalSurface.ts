// Building a surface from the shard a `canonical` level already has (§5.0).
//
// ⚠ THIS IS WHAT `source: "canonical"` MEANS AT RENDER TIME, and it is the half Phase 2 left
// open. §5.0's rule is that a level whose own file is already inside its budget gets NO second
// artifact — "the shell reads that shard through the same `surfacePath.ts` indirection and a
// thin adapter". `ElectionSurfaceBoundary` reports that state as `canonical`; without an
// adapter the only thing a caller could do with it was render the legacy body, which would have
// left the two most-read parliamentary levels permanently outside the shared shell.
//
// ⚠ IT ADDS NO FETCH. `national_summary.json` is already on the page — `useNationalSummary`
// fetches it for the KPI cards this shell replaces — so the adapter is a pure transform of data
// the screen holds. A second request here would be the projection's whole purpose inverted.
//
// ⚠ AND IT SHARES THE GENERATOR'S RULES RATHER THAN RESTATING THEM. `ballotTotals.ts` owns
// turnout and valid votes; `partyIndex.ts` owns identity. A country surface built from
// lookalike arithmetic would disagree with the region artifacts beside it on the same page —
// invisibly, because both would be plausible.

import {
  ballotTotalsFrom,
  validVotesOf,
  type PartyVote,
  type Protocol,
} from "./ballotTotals";
import type { PartyIndex } from "./partyIndex";
import { buildDestinations } from "./destinations";
import { ballotMapMeta } from "@/screens/elections/electionSurfaceDescriptors";
import { factsFor, rankedFrom } from "./parliamentarySurface";
import {
  ELECTION_SURFACE_VERSION,
  type BallotKind,
  type ElectionSurfaceV1,
} from "./surfaceTypes";
import type { NationalSummary } from "@/data/dashboard/dashboardTypes";

/** The parliamentary country surface, from the shard the page already fetched.
 *
 *  `partyIndex` is `null` while `canonical_parties.json` is in flight — the ranked rows are
 *  still built, with `partyId: null`, because the VOTES are the answer and the label is a
 *  second question. A row that waits for its name is a table that appears late. */
/** The parliamentary surface for a level §5.0 serves from its OWN shard — country and
 *  município.
 *
 *  ⚠ ONE BODY FOR BOTH, because the two shards are the same shape: a protocol and a party-vote
 *  list. The difference is the level, the place id and where "the complete result" points, and
 *  every rule below — ranking, the leader-only margin, the turnout denominator, which facts a
 *  level can fill — is the GENERATOR'S, imported rather than restated. A second body would be a
 *  second set of those rules on the two levels that never fetch an artifact to compare against.
 *
 *  ⚠ IT ADDS NO FETCH. Both shards are already on their page — `national_summary.json` for the
 *  KPI cards this shell replaces, `municipalities/<code>.json` for the município's own tiles. */
export const parliamentaryCanonicalSurface = (args: {
  level: "country" | "municipality";
  /** The place's own id: `"BG"` for the country, the obshtina code for a município. */
  placeId: string;
  cycle: string;
  /** The party votes, from the shard. */
  votes: readonly PartyVote[];
  /** Seats, where the level publishes them — the country does, a município does not. */
  seatsByPartyNum?: ReadonlyMap<number, number>;
  /** The change in share against the prior cycle, in pp, where the shard carries one — the
   *  country's does, a município's does not. ⚠ A party the shard leaves unmeasured must be
   *  ABSENT from the map rather than present at 0: see `deltaPct`'s own header. */
  deltaByPartyNum?: ReadonlyMap<number, number>;
  protocol?: Protocol;
  partyIndex: PartyIndex | null;
  /** The machine share of valid votes, where the page has it. */
  paperMachinePct?: number;
  /** Where "the complete result" for this place lives. */
  completeResultTo: string;
  updatedAt?: string;
  /** The local cycle the „Местни" view link points at, when one covers this place. */
  localCycle?: string;
  inLocalCycle?: boolean;
}): ElectionSurfaceV1 => {
  const {
    level,
    placeId,
    cycle,
    votes,
    seatsByPartyNum,
    deltaByPartyNum,
    protocol,
    partyIndex,
    paperMachinePct,
    completeResultTo,
    updatedAt,
    localCycle,
    inLocalCycle,
  } = args;
  const totals = ballotTotalsFrom(protocol ?? {}, votes);
  // ⚠ `rankedFrom` NEEDS AN INDEX AND `null` IS A REAL STATE. The party corpus is still in
  // flight on the first frame; an empty index yields rows with `partyId: null`, which the
  // renderer shows unlabelled rather than not at all — the votes are the answer and the label
  // is a second question.
  const preview = rankedFrom(
    votes,
    partyIndex ?? new Map<string, string>(),
    cycle,
    totals.validVotes,
  ).map((e) => {
    // Neither seats nor the prior-cycle change is part of the generator's ranked shape — only
    // the country publishes either — so both are folded in here rather than by a second
    // ranking pass. ⚠ SPREAD ONLY WHEN PRESENT: writing `seats: undefined` / `deltaPct:
    // undefined` onto every row satisfies the type and makes `ballotFillsColumn` see a filled
    // column on a ballot that has nothing to put in it.
    const num = e.localPartyNum ?? -1;
    const seats = seatsByPartyNum?.get(num);
    const deltaPct = deltaByPartyNum?.get(num);
    return {
      ...e,
      ...(seats === undefined ? {} : { seats }),
      ...(deltaPct === undefined ? {} : { deltaPct }),
    };
  });
  const map = ballotMapMeta("parliamentary", level, "parliamentary_list");
  return {
    schemaVersion: ELECTION_SURFACE_VERSION,
    kind: "parliamentary",
    cycle,
    place: { level, id: placeId },
    status: {
      result: "final",
      sourceLabel: "cik",
      ...(updatedAt ? { updatedAt } : {}),
    },
    ballots: [
      {
        kind: "parliamentary_list" satisfies BallotKind,
        resultStatus: "final",
        preview,
        totals,
        ...(map ? { map } : {}),
        completeResult: { to: completeResultTo, available: true },
      },
    ],
    // ⚠ NO `top_gainer`. Neither shard carries a prior-cycle comparison, and the generator's
    // §7.1 suppression only fires when one is passed — so omitting it is the honest input
    // rather than a fact quietly dropped.
    facts: factsFor(level, totals, preview, paperMachinePct),
    // ⚠ NO STANDOUTS. §7's selectors compare a place against its PEERS; these two levels are
    // built in the browser from one place's own shard and have no peer set to compare against.
    // An empty array is the honest answer, not a missing feature.
    standouts: [],
    destinations: buildDestinations({
      kind: "parliamentary",
      level,
      id: placeId,
      cycle,
      completeResultTo,
      localCycle,
      inLocalCycle: inLocalCycle ?? Boolean(localCycle),
    }),
  };
};

/** The country, from `national_summary.json`. */
export const parliamentaryCountrySurface = (args: {
  summary: NationalSummary;
  cycle: string;
  partyIndex: PartyIndex | null;
  protocol?: Protocol;
  updatedAt?: string;
  localCycle?: string;
}): ElectionSurfaceV1 =>
  parliamentaryCanonicalSurface({
    level: "country",
    placeId: "BG",
    cycle: args.cycle,
    votes: args.summary.parties.map((p) => ({
      partyNum: p.partyNum,
      totalVotes: p.totalVotes,
    })),
    seatsByPartyNum: new Map(
      args.summary.parties
        .filter((p) => p.seats !== undefined)
        .map((p) => [p.partyNum, p.seats!]),
    ),
    // ⚠ ONLY THE PARTIES THE SHARD ACTUALLY COMPARED. `national_summary.json` leaves `deltaPct`
    // undefined for a party with no prior-cycle row — ПрБ's first cycle, a coalition that did
    // not exist — and a `0` there would publish „held its share" about a party that had never
    // stood. The filter is what keeps absence absent.
    deltaByPartyNum: new Map(
      args.summary.parties
        .filter((p) => p.deltaPct !== undefined)
        .map((p) => [p.partyNum, p.deltaPct!]),
    ),
    protocol: args.protocol,
    partyIndex: args.partyIndex,
    paperMachinePct: args.summary.paperMachine?.machinePct,
    completeResultTo: `/elections/${args.cycle}`,
    updatedAt: args.updatedAt,
    localCycle: args.localCycle,
  });

/** One município, from `municipalities/<code>.json`. */
export const parliamentaryMunicipalitySurface = (args: {
  obshtina: string;
  cycle: string;
  votes: readonly PartyVote[];
  protocol?: Protocol;
  partyIndex: PartyIndex | null;
  updatedAt?: string;
  localCycle?: string;
  inLocalCycle?: boolean;
}): ElectionSurfaceV1 =>
  parliamentaryCanonicalSurface({
    level: "municipality",
    placeId: args.obshtina,
    cycle: args.cycle,
    votes: args.votes,
    protocol: args.protocol,
    partyIndex: args.partyIndex,
    // ⚠ DERIVED FROM THE SHARD'S OWN VOTE ROWS, not from a protocol field. A município's
    // machine share is the machine votes over the valid ones — the same basis the generator
    // uses at every other level, and NOT over votes cast, which silently absorbs the invalid
    // ballots and reads a point or two low.
    paperMachinePct: machinePctOf(args.votes),
    // §5.0's route naming quirk: `/settlement/:id` IS the município dashboard.
    completeResultTo: `/settlement/${args.obshtina}`,
    updatedAt: args.updatedAt,
    localCycle: args.localCycle,
    inLocalCycle: args.inLocalCycle,
  });

/** The machine share of valid votes, or undefined when the shard carries no machine split. */
const machinePctOf = (votes: readonly PartyVote[]): number | undefined => {
  let machine = 0;
  let any = false;
  for (const v of votes) {
    if (v.machineVotes === undefined) continue;
    any = true;
    machine += v.machineVotes;
  }
  if (!any) return undefined;
  const valid = validVotesOf(votes);
  return valid > 0 ? (machine / valid) * 100 : undefined;
};
