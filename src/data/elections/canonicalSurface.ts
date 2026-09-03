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
import { partyIdFor, type PartyIndex } from "./partyIndex";
import { buildDestinations } from "./destinations";
import {
  ELECTION_SURFACE_VERSION,
  MAX_BALLOT_PREVIEW,
  type BallotKind,
  type ElectionRankedEntry,
  type ElectionSurfaceFact,
  type ElectionSurfaceV1,
} from "./surfaceTypes";
import type { NationalSummary } from "@/data/dashboard/dashboardTypes";

/** The country descriptor's `factPriority` head — winner, margin, turnout, paper_machine. The
 *  SHELL slices to `maxFacts` and orders by the descriptor, so this emits what the corpus can
 *  support and lets the descriptor decide what is shown (§6). */
const factsFor = (
  summary: NationalSummary,
  ranked: readonly ElectionRankedEntry[],
  turnoutPct?: number,
): ElectionSurfaceFact[] => {
  const facts: ElectionSurfaceFact[] = [];
  const lead = ranked[0];
  if (lead)
    facts.push({
      code: "winner",
      value: lead.pct,
      unit: "pct",
      basis: "valid_votes",
      ballot: "parliamentary_list",
      // §5.3: the id, never a resolved name. The renderer turns `p_20` into ПрБ.
      labelParams: lead.partyId ? { partyId: lead.partyId } : {},
    });
  // ⚠ THE MARGIN IS THE LEADER'S ONLY, and it exists only when there IS a runner-up. A margin
  // computed against nothing is 0 — a real number saying the race was tied.
  if (lead?.marginPct !== undefined)
    facts.push({
      code: "margin",
      value: lead.marginPct,
      unit: "pct_point",
      basis: "valid_votes",
      ballot: "parliamentary_list",
    });
  // ⚠ WITHHELD, NEVER ZEROED. `turnoutBasis: "unavailable"` is a real answer.
  if (turnoutPct !== undefined)
    facts.push({
      code: "turnout",
      value: turnoutPct,
      unit: "pct",
      basis: "registered_voters",
    });
  if (summary.paperMachine)
    facts.push({
      code: "paper_machine",
      value: summary.paperMachine.machinePct,
      unit: "pct",
      basis: "valid_votes",
    });
  return facts;
};

/** The parliamentary country surface, from the shard the page already fetched.
 *
 *  `partyIndex` is `null` while `canonical_parties.json` is in flight — the ranked rows are
 *  still built, with `partyId: null`, because the VOTES are the answer and the label is a
 *  second question. A row that waits for its name is a table that appears late. */
export const parliamentaryCountrySurface = (args: {
  summary: NationalSummary;
  cycle: string;
  partyIndex: PartyIndex | null;
  /** From the cycle catalogue's protocol — the registered/actual figures `national_summary`
   *  reports only as a pre-computed rate. Absent means the totals carry no turnout. */
  protocol?: Protocol;
  updatedAt?: string;
  /** The local cycle the „Местни" view link points at, when one covers this place. */
  localCycle?: string;
}): ElectionSurfaceV1 => {
  const { summary, cycle, partyIndex, protocol, updatedAt, localCycle } = args;
  const votes: PartyVote[] = summary.parties.map((p) => ({
    partyNum: p.partyNum,
    totalVotes: p.totalVotes,
  }));
  const validVotes = validVotesOf(votes);
  const sorted = [...summary.parties]
    // Ties broken on partyNum so a re-render cannot reorder two parties with equal votes.
    .sort((a, b) => b.totalVotes - a.totalVotes || a.partyNum - b.partyNum)
    .slice(0, MAX_BALLOT_PREVIEW);
  const preview: ElectionRankedEntry[] = sorted.map((p, i) => {
    const pct = validVotes > 0 ? (p.totalVotes / validVotes) * 100 : 0;
    const next = sorted[1];
    return {
      partyId: partyIndex ? partyIdFor(partyIndex, cycle, p.partyNum) : null,
      votes: p.totalVotes,
      pct: Number(pct.toFixed(2)),
      ...(p.seats !== undefined ? { seats: p.seats } : {}),
      // ⚠ THE LEADER ONLY. A margin on every row reads as "distance from the row above", which
      // is a different quantity, and putting the leader's margin on a runner-up asserts they led.
      ...(i === 0 && next
        ? {
            marginPct: Number(
              (
                pct -
                (validVotes > 0 ? (next.totalVotes / validVotes) * 100 : 0)
              ).toFixed(2),
            ),
          }
        : {}),
    };
  });
  const totals = ballotTotalsFrom(protocol ?? {}, votes);
  return {
    schemaVersion: ELECTION_SURFACE_VERSION,
    kind: "parliamentary",
    cycle,
    place: { level: "country", id: "BG" },
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
        map: {
          defaultMode: "winner",
          allowedModes: [
            "winner",
            "margin",
            "selected_share",
            "change",
            "turnout",
          ],
          posture: "interactive",
          grain: "region",
        },
        completeResult: { to: `/elections/${cycle}`, available: true },
      },
    ],
    facts: factsFor(summary, preview, totals.turnoutPct),
    // ⚠ NO STANDOUTS. §7's selectors compare a place against its PEERS, and the country has
    // none — an empty array is the honest answer, not a missing feature.
    standouts: [],
    // ⚠ THE GENERATOR'S OWN BUILDER, not a second set of routes. Which views a level omits and
    // whether an unresolvable link is absent or `available: false` with a reason are exactly
    // the decisions a lookalike would get subtly wrong.
    destinations: buildDestinations({
      kind: "parliamentary",
      level: "country",
      id: "BG",
      cycle,
      completeResultTo: `/elections/${cycle}`,
      // A resolvable URL is not data: the caller passes the cycle only when one covers this
      // place, and the country is covered by every regular local cycle.
      localCycle,
      inLocalCycle: Boolean(localCycle),
    }),
  };
};
