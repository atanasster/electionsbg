// The parliamentary ranked preview and outcome facts — the module both runtimes read.
//
// ⚠ THEY WERE THE GENERATOR'S, AND THE CANONICAL ADAPTER HAD ITS OWN. `canonicalSurface.ts`
// cannot import that file (`node:fs` at the top), so the country adapter grew a private
// `factsFor` and a private ranked mapping. They agreed on every value anyone checked — and the
// private one was MISSING §7.1's duplicate suppression entirely, which is the difference that
// only shows up when a party's whole share equals its gain. That is the third time in this plan
// a rule was re-derived across the node/browser boundary and came back weaker under the same
// name, which is why extracting is the fix rather than a tidy-up.
//
// The generator re-exports both names.

import {
  MAX_BALLOT_PREVIEW,
  type ElectionBallotTotals,
  type ElectionPlaceLevel,
  type ElectionRankedEntry,
  type ElectionSurfaceFact,
} from "./surfaceTypes";
import { partyIdFor, type PartyIndex } from "./partyIndex";
import type { PartyVote } from "./ballotTotals";
import { descriptorFor } from "@/screens/elections/electionSurfaceDescriptors";

/** The ranked preview: at most eight entries, a stable prefix of the complete ranking (§5).
 *
 *  ⚠ THE PERCENTAGE IS OVER VALID VOTES, and the margin belongs to the LEADER ONLY. A margin on
 *  every row reads as "distance from the row above", which is a different quantity, and putting
 *  the leader's margin on a runner-up asserts they led. */
export const rankedFrom = (
  votes: readonly PartyVote[],
  index: PartyIndex,
  election: string,
  validVotes: number,
): ElectionRankedEntry[] => {
  const sorted = [...votes]
    .filter((v) => (v.totalVotes || 0) > 0)
    // Ties broken on partyNum so a rebuild cannot reorder two parties with equal votes (§9).
    .sort((a, b) => b.totalVotes - a.totalVotes || a.partyNum - b.partyNum)
    .slice(0, MAX_BALLOT_PREVIEW);
  return sorted.map((v, i) => {
    const pct = validVotes > 0 ? (v.totalVotes / validVotes) * 100 : 0;
    const entry: ElectionRankedEntry = {
      partyId: partyIdFor(index, election, v.partyNum),
      localPartyNum: v.partyNum,
      votes: v.totalVotes,
      pct: Number(pct.toFixed(2)),
    };
    if (i === 0 && sorted.length > 1) {
      const next = (sorted[1].totalVotes / validVotes) * 100;
      entry.marginPct = Number((pct - next).toFixed(2));
    }
    return entry;
  });
};

/** The facts a level can fill, in the LEVEL's declared priority. The descriptor decides which
 *  codes may appear and how many; this only supplies the ones the data actually supports, so a
 *  level never renders a fact the corpus cannot back. */
export const factsFor = (
  level: ElectionPlaceLevel,
  totals: ElectionBallotTotals,
  ranked: readonly ElectionRankedEntry[],
  paperMachinePct?: number,
  topGainer?: { partyId: string; deltaPp: number },
): ElectionSurfaceFact[] => {
  const d = descriptorFor("parliamentary", level);
  if (!d.available) return [];
  const leader = ranked[0];
  const available: Partial<Record<string, ElectionSurfaceFact>> = {
    winner: leader
      ? { code: "winner", value: leader.pct, unit: "pct", basis: "valid_votes" }
      : undefined,
    margin:
      leader?.marginPct !== undefined
        ? {
            code: "margin",
            value: leader.marginPct,
            unit: "pct_point",
            basis: "valid_votes",
          }
        : undefined,
    // ⚠ ONLY WHEN THERE IS A BASIS FOR IT. `turnoutBasis: "unavailable"` means the surface
    // publishes no rate — abroad's would be 329.6%.
    turnout:
      totals.turnoutBasis === "registered_voters" &&
      totals.turnoutPct !== undefined
        ? {
            code: "turnout",
            value: totals.turnoutPct,
            unit: "pct",
            basis: "registered_voters",
          }
        : undefined,
    valid_votes: {
      code: "valid_votes",
      value: totals.validVotes,
      unit: "votes",
      basis: "valid_votes",
    },
    votes_cast: {
      code: "votes_cast",
      value: totals.votesCast,
      unit: "votes",
      basis: "votes_cast",
    },
    // ⚠ THE FACT CARRIES THE PARTY AS A REFERENCE, never a name (§5.3). The renderer resolves
    // the label from the canonical corpus, so the artifact stays language-free.
    top_gainer: topGainer
      ? {
          code: "top_gainer",
          value: topGainer.deltaPp,
          unit: "pct_point",
          basis: "valid_votes",
          // `labelParams` is the declared home for an id: "numbers and IDS ONLY, never
          // resolved names". The renderer turns `p_20` into ПрБ at render time (§5.3).
          labelParams: { partyId: topGainer.partyId },
        }
      : undefined,
    paper_machine:
      paperMachinePct !== undefined
        ? {
            code: "paper_machine",
            value: Number(paperMachinePct.toFixed(2)),
            unit: "pct",
            // ⚠ OVER VALID VOTES, not over votes cast. The machine share is a share of the
            // ballots that counted; measured against votes cast it silently absorbs the
            // invalid ones and reads a point or two low.
            basis: "valid_votes",
          }
        : undefined,
  };
  // ⚠ §7.1: A FIGURE APPEARS ONCE PER SCREEN — SUPPRESSED STRUCTURALLY, NEVER BY VALUE.
  //
  // The case is real and systematic: ПрБ contested its first election in 2026, so its prior
  // share is 0 and its GAIN equals its SHARE at every place. "Winner 39.84%" beside "top gainer
  // +39.84 pp" is one number wearing two labels, on 31 of 32 regions.
  //
  // The first fix deduped on the raw number and was 72% FALSE POSITIVES: it dropped 110 facts of
  // which only 31 were this case. 59 dropped `paper_machine` because a machine share coincided
  // with a winner's share — two unrelated quantities that happened to round the same — and 13
  // compared a PERCENTAGE against a VOTE COUNT (winner 20% against valid_votes 20). 572 strips
  // rendered three cards where the level declares four. Equal numbers are not the same figure.
  //
  // The structural test names the actual redundancy — the gainer IS the leader, and its gain IS
  // its whole share — and fires on 31 of 31 with nothing else touched.
  const leaderId = leader?.partyId;
  const gainerIsWholeShare =
    topGainer !== undefined &&
    leaderId !== undefined &&
    topGainer.partyId === leaderId &&
    leader?.pct !== undefined &&
    Math.abs(topGainer.deltaPp - leader.pct) < 0.01;
  return d.factPriority
    .map((code) => available[code])
    .filter((f): f is ElectionSurfaceFact => f !== undefined)
    .filter((f) => !(f.code === "top_gainer" && gainerIsWholeShare))
    .slice(0, d.maxFacts);
};
