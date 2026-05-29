// Selector that picks the single highest-priority "what should this user
// notice right now?" item for the My-Area dashboard. Drives MyAreaActionBand.
//
// Scope: election countdown only. Past activity (council votes, procurement
// flags, EU contracts, plenary mentions) belongs in MyAreaAlertsTile —
// folding it here meant two surfaces showed the same row twice. The band
// now earns its place only when something time-sensitive is *upcoming*.
//
// Returns null when the next election is further than ELECTION_IMMINENT_DAYS
// out, so the band auto-hides outside the active campaign window.

import {
  daysUntil,
  nextElection,
  type UpcomingElection,
} from "./upcomingElections";

export type NextAction = {
  kind: "election_imminent";
  election: UpcomingElection;
  daysOut: number;
};

// Election-imminent threshold. Anything closer than this gets the
// loudest treatment on the dashboard.
const ELECTION_IMMINENT_DAYS = 60;

export const useNextAction = (_obshtina?: string | null): NextAction | null => {
  void _obshtina;
  const upcoming = nextElection();
  const daysOut = upcoming ? daysUntil(upcoming.date) : Infinity;

  if (upcoming && daysOut >= 0 && daysOut <= ELECTION_IMMINENT_DAYS) {
    return { kind: "election_imminent", election: upcoming, daysOut };
  }

  return null;
};
