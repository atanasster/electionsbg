// Selector that picks the single highest-priority "what should this user
// notice right now?" item for the My-Area dashboard. Drives MyAreaActionBand.
//
// Priority order (first match wins):
//   1. Election within 60 days  →  countdown
//   2. Council resolution in the last 30 days  →  "Council voted X"
//   3. Alert event in the last 30 days (procurement/EU/capital)  →  red flag
//   4. Default: closest future election (any timeframe) as a soft countdown
//
// The selector is a pure function over already-loaded React Query results
// — no new fetch. The caller passes obshtina so council + alerts are
// keyed to the right município. Returns null only when no upcoming
// election exists at all (i.e. the static anchor list is empty), which
// should never happen in practice.

import { useMyAreaAlerts } from "./useMyAreaAlerts";
import { useCouncilMinutes } from "@/data/council/useCouncilMinutes";
import type { CouncilResolution } from "@/data/council/useCouncilMinutes";
import type { MyAreaAlertEvent } from "./useMyAreaAlerts";
import {
  daysUntil,
  nextElection,
  type UpcomingElection,
} from "./upcomingElections";

export type NextAction =
  | {
      kind: "election_imminent";
      election: UpcomingElection;
      daysOut: number;
    }
  | {
      kind: "council_recent";
      obshtina: string;
      resolution: CouncilResolution;
      daysAgo: number;
    }
  | {
      kind: "alert_recent";
      obshtina: string;
      event: MyAreaAlertEvent;
      daysAgo: number;
    };

const daysAgoFromIso = (iso: string): number => {
  const d = new Date(iso + "T00:00:00Z").getTime();
  const now = Date.now();
  return Math.floor((now - d) / (1000 * 60 * 60 * 24));
};

// Amount threshold (EUR) above which an alert is interesting enough to
// surface in the action band. ~€500K is roughly the line above which
// procurement contracts attract editorial scrutiny in BG civil society.
const ALERT_AMOUNT_THRESHOLD_EUR = 500_000;

// Lookback window. Events older than this drop out of the action band
// even if no other tier applies — the band should feel current.
const COUNCIL_LOOKBACK_DAYS = 30;
const ALERT_LOOKBACK_DAYS = 30;

// Election-imminent threshold. Anything closer than this gets the
// loudest treatment (the action band steals the slot from a recent
// alert).
const ELECTION_IMMINENT_DAYS = 60;

export const useNextAction = (obshtina?: string | null): NextAction | null => {
  const { data: alerts } = useMyAreaAlerts(obshtina);
  const { resolutions } = useCouncilMinutes(obshtina);

  const upcoming = nextElection();
  const daysOut = upcoming ? daysUntil(upcoming.date) : Infinity;

  // Tier 1 — election within 60 days takes the band. Citizens have an
  // imminent civic action; nothing else outranks it.
  if (upcoming && daysOut >= 0 && daysOut <= ELECTION_IMMINENT_DAYS) {
    return { kind: "election_imminent", election: upcoming, daysOut };
  }

  // Tier 2 — most recent council resolution within COUNCIL_LOOKBACK_DAYS.
  // resolutions[] is sorted by date desc by the build script.
  const recentResolution = resolutions.find(
    (r) => daysAgoFromIso(r.date) <= COUNCIL_LOOKBACK_DAYS,
  );
  if (recentResolution) {
    return {
      kind: "council_recent",
      obshtina: obshtina!,
      resolution: recentResolution,
      daysAgo: daysAgoFromIso(recentResolution.date),
    };
  }

  // Tier 3 — most recent high-value alert within ALERT_LOOKBACK_DAYS.
  // alerts.events[] is sorted by date desc by the build script.
  const recentAlert = alerts?.events.find((e) => {
    if (daysAgoFromIso(e.date) > ALERT_LOOKBACK_DAYS) return false;
    if (e.amountEur && e.amountEur >= ALERT_AMOUNT_THRESHOLD_EUR) return true;
    // Local-election events and plenary keywords don't have an amount —
    // they still belong in the band when fresh.
    return e.kind === "local_election" || e.kind === "plenary_keyword";
  });
  if (recentAlert) {
    return {
      kind: "alert_recent",
      obshtina: obshtina!,
      event: recentAlert,
      daysAgo: daysAgoFromIso(recentAlert.date),
    };
  }

  // Nothing urgent. We deliberately do NOT echo the next election here —
  // the standalone MyAreaUpcomingBallotTile right below already shows the
  // calendar, and a "default countdown" action card duplicated it. The
  // band only earns its place when something is genuinely time-sensitive
  // (imminent vote / fresh council decision / fresh procurement flag).
  return null;
};
