import parliamentary from "../../../data/json/elections.json";
import {
  LATEST_PRESIDENTIAL_CYCLE,
  PRESIDENTIAL_CATALOGUE,
} from "../../../data/presidentialCatalogue";

export const LATEST_PARLIAMENTARY_CONTEST = parliamentary[0].name;
export const PRESIDENTIAL_CONTESTS = PRESIDENTIAL_CATALOGUE.map(
  (contest) => contest.name,
);
/**
 * The newest DECIDED presidential cycle — not `LATEST_PRESIDENTIAL_CYCLE`.
 *
 * ⚠ The starter question asks for a RUNOFF and its SQL recipe defaults to round 2, both pinned to
 * provider-validated records. While the newest cycle's runoff is pending (2026, between its two
 * publishes) that cycle has no round 2, so the default stays on the last finished election and
 * moves forward by itself once the runoff is ingested — at which point the starter text and the
 * validation records need refreshing, and their gates say so.
 */
export const LATEST_PRESIDENTIAL_CONTEST: string =
  PRESIDENTIAL_CATALOGUE.find((contest) => contest.decidedInRound !== null)
    ?.name ?? LATEST_PRESIDENTIAL_CYCLE;
export const ELECTION_ROUND_MIN = 1;
export const ELECTION_ROUND_MAX = 2;
