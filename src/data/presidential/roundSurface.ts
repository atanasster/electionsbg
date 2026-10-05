// One round of a presidential PLACE surface — what the place pages hand the shared results shell
// once a round toggle decides which round is on screen (the country page's arrangement).
//
// ⚠ THE PRODUCER'S FACTS DESCRIBE THE FIRST BALLOT ONLY. `build_presidential_surface.ts` builds
// `facts` from `ballots[0]` — round 1 — so a toggle that swapped the ranking to the runoff and
// left the strip alone would put round 1's leader share and turnout above the runoff's result.
// For any other round the strip is rebuilt from THAT ballot's own published fields, code for
// code in the producer's order: no new arithmetic, only a different row of the same artifact.
//
// ⚠ A CODE THE BALLOT CANNOT ANSWER IS DROPPED, NEVER CARRIED OVER. `paper_machine` is computed
// by the producer from section counts the ballot does not carry; keeping round 1's value under
// a runoff heading would be a number about the wrong electorate.

import type {
  ElectionSurfaceBallot,
  ElectionSurfaceFact,
  ElectionSurfaceV1,
} from "@/data/elections/surfaceTypes";

const factFromBallot = (
  f: ElectionSurfaceFact,
  b: ElectionSurfaceBallot,
): ElectionSurfaceFact | undefined => {
  const leader = b.preview[0];
  switch (f.code) {
    case "winner":
      return leader ? { ...f, value: leader.pct } : undefined;
    case "margin":
      return leader?.marginPct !== undefined
        ? { ...f, value: leader.marginPct }
        : undefined;
    case "turnout":
      return b.totals.turnoutBasis === "registered_voters" &&
        b.totals.turnoutPct !== undefined
        ? { ...f, value: b.totals.turnoutPct }
        : undefined;
    case "valid_votes":
      return { ...f, value: b.totals.validVotes };
    case "votes_cast":
      return { ...f, value: b.totals.votesCast };
    default:
      return undefined;
  }
};

/** The rounds a surface carries, in ballot order. */
export const surfaceRounds = (s: ElectionSurfaceV1): (1 | 2)[] =>
  s.ballots.map((b) => b.round).filter((r): r is 1 | 2 => r === 1 || r === 2);

/**
 * @param s - A presidential place surface (one ballot per round).
 * @param round - The round on screen.
 * @returns The surface with only that round's ballot, and facts for that round. A surface that
 *   carries no ballot for `round` is returned unchanged rather than emptied.
 */
export const presidentialRoundSurface = (
  s: ElectionSurfaceV1,
  round: 1 | 2,
): ElectionSurfaceV1 => {
  const ballot = s.ballots.find((b) => b.round === round);
  if (!ballot) return s;
  const factsAreThisRound = s.ballots[0]?.round === round;
  return {
    ...s,
    ballots: [ballot],
    facts: factsAreThisRound
      ? s.facts
      : s.facts
          .map((f) => factFromBallot(f, ballot))
          .filter((f): f is ElectionSurfaceFact => f !== undefined),
  };
};
