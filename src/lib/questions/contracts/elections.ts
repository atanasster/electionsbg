import parliamentary from "../../../data/json/elections.json";
import {
  LATEST_PRESIDENTIAL_CYCLE,
  PRESIDENTIAL_CATALOGUE,
} from "../../../data/presidentialCatalogue";

export const LATEST_PARLIAMENTARY_CONTEST = parliamentary[0].name;
export const PRESIDENTIAL_CONTESTS = PRESIDENTIAL_CATALOGUE.map(
  (contest) => contest.name,
);
export const LATEST_PRESIDENTIAL_CONTEST = LATEST_PRESIDENTIAL_CYCLE;
export const ELECTION_ROUND_MIN = 1;
export const ELECTION_ROUND_MAX = 2;
