// The ballot-arithmetic rules, in the ONE module both runtimes can read.
//
// ⚠ THEY LIVED IN THE GENERATOR, WHICH OPENS WITH `node:fs`. So the browser could not import
// them, and the first thing that needed one — the `/elections` head band — re-derived turnout
// from scratch and got a WEAKER rule with the same name: it guarded a zero denominator and not
// a `cast > denom` one, which is exactly the abroad case (196,281 actual against 59,545
// registered, 329.6%). It reads the national protocol, where the guard never fires, so the two
// agreed on every value anyone looked at. §5.0 says a `canonical` level is served "through the
// same `surfacePath.ts` indirection and a thin adapter" — this is what makes that adapter
// possible without a third copy.
//
// The generator re-exports every name here rather than declaring its own.

import type { ElectionBallotTotals } from "./surfaceTypes";

/** ⚠ МИР 32 — the out-of-country district. Its turnout is suppressed by DEFINITION rather than
 *  by arithmetic: almost everyone joins the list at the section on the day, so the rate measures
 *  a different registration regime, and folding it into a national baseline contaminates the
 *  number every domestic place is then compared against. */
export const ABROAD_KEY = "32";

export type Protocol = {
  numRegisteredVoters?: number | null;
  /** Voters added to the list ON THE DAY. Part of the denominator — see `turnoutPctOf`. */
  numAdditionalVoters?: number | null;
  totalActualVoters?: number | null;
  numValidVotes?: number | null;
  numValidMachineVotes?: number | null;
  numInvalidBallotsFound?: number | null;
  numPaperBallotsFound?: number | null;
  numMachineBallots?: number | null;
};

export type PartyVote = {
  partyNum: number;
  totalVotes: number;
  machineVotes?: number;
  paperVotes?: number;
};

/** Valid votes = the sum of the party votes.
 *
 *  ⚠ NEVER `numValidVotes`, which is PAPER-ONLY on this corpus — using it drops every machine
 *  vote out of the denominator. */
export const validVotesOf = (votes: readonly PartyVote[]): number =>
  votes.reduce((a, v) => a + (v.totalVotes || 0), 0);

/** The turnout rate, or null when the protocol cannot support one.
 *
 *  ⚠ THREE WAYS THERE IS NO RATE, and only the first is obvious: no registered figure, a zero
 *  one, or one the vote count EXCEEDS. The third is abroad at 329.6% — not a data error but a
 *  different registration regime — and a copy of this function that omitted the guard would
 *  publish it. `unavailable` is a real answer (§2 decision 10); a rate we cannot stand behind
 *  is the failure, a missing rate is a rendered absence. */
export const turnoutPctOf = (protocol: Protocol): number | null => {
  const denom =
    (protocol.numRegisteredVoters ?? 0) + (protocol.numAdditionalVoters ?? 0);
  const cast = protocol.totalActualVoters ?? 0;
  if (denom <= 0 || cast > denom) return null;
  return (cast / denom) * 100;
};

export const ballotTotalsFrom = (
  protocol: Protocol,
  votes: readonly PartyVote[],
  /** ⚠ SET FOR ABROAD. A definitional suppression, not an arithmetic one — see `ABROAD_KEY`. */
  suppressTurnout = false,
): ElectionBallotTotals => {
  const validVotes = validVotesOf(votes);
  const votesCast = protocol.totalActualVoters ?? validVotes;
  const registered =
    (protocol.numRegisteredVoters ?? 0) + (protocol.numAdditionalVoters ?? 0);
  // ⚠ MORE VALID VOTES THAN VOTERS IS IMPOSSIBLE, and three sections report it (060800018
  // publishes 109 cast against 194 valid). The mirror image — voters over the list — was already
  // guarded; this direction was not, so those three published a turnout computed from a
  // `votesCast` their own ballot count contradicts. A protocol that disagrees with itself
  // supports no rate.
  const selfConsistent = votesCast >= validVotes;
  if (
    suppressTurnout ||
    !selfConsistent ||
    registered <= 0 ||
    votesCast > registered
  )
    return { votesCast, validVotes, turnoutBasis: "unavailable" };
  return {
    votesCast,
    validVotes,
    registeredVoters: registered,
    turnoutPct: Number(((votesCast / registered) * 100).toFixed(2)),
    turnoutBasis: "registered_voters",
  };
};
