// Standalone full-list pages behind the country dashboard's leaderboard tiles.
// One screen, five views (selected by the `view` prop) — each renders the same
// tile component the dashboard uses, but in full mode (no top-N slice, no inner
// scroll):
//
//   mayors-by-party    → elected mayors won per party   (index.json)
//   council-votes      → council vote share, round 1    (index.json)
//   strongest-mandates → every winner by vote share     (national_leaders_full)
//   closest-races      → every race by margin           (national_leaders_full)
//   swing              → every party's council swing     (cross-cycle series)
//
// Routes: /local/:cycle/{mayors-by-party,council-votes,strongest-mandates,
// closest-races,swing}. Mirrors LocalAllRegionsScreen's chrome. Split control
// has its own list page (LocalMunicipalityListScreen list="split").

import { FC } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { friendlyCycleDate } from "@/data/local/cycleDate";
import { useLocalLeadersFull } from "@/data/local/useLocalLeadersFull";
import {
  LocalMayorsByPartyTile,
  LocalCouncilVotesTile,
} from "./dashboard/local/LocalPartyBarTiles";
import {
  LocalTopMayorsTile,
  LocalClosestRacesTile,
} from "./dashboard/local/LocalLeaderTiles";
import { LocalSwingTile } from "./dashboard/local/LocalSwingTile";

export type LocalLeaderboardView =
  | "mayors-by-party"
  | "council-votes"
  | "strongest-mandates"
  | "closest-races"
  | "swing";

const TITLE_KEY: Record<LocalLeaderboardView, string> = {
  "mayors-by-party": "local_leaderboard_mayors_by_party",
  "council-votes": "local_leaderboard_council_votes",
  "strongest-mandates": "local_leaderboard_strongest_mandates",
  "closest-races": "local_leaderboard_closest_races",
  swing: "local_leaderboard_swing",
};

export const LocalLeaderboardScreen: FC<{ view: LocalLeaderboardView }> = ({
  view,
}) => {
  const { t } = useTranslation();
  const { cycle } = useParams<{ cycle: string }>();
  const needsFull = view === "strongest-mandates" || view === "closest-races";
  const { data: full } = useLocalLeadersFull(cycle, needsFull);

  if (!cycle) return null;

  return (
    <main className="container mx-auto px-4 py-6 space-y-6">
      <div className="text-xs text-muted-foreground">
        <Link to={`/local/${cycle}`} className="hover:underline">
          {t("local_election_screen_back")}
        </Link>
        <span className="mx-2">·</span>
        <span>{friendlyCycleDate(cycle)}</span>
      </div>
      <h1 className="text-2xl font-semibold">{t(TITLE_KEY[view])}</h1>

      {view === "mayors-by-party" ? (
        <LocalMayorsByPartyTile cycle={cycle} />
      ) : view === "council-votes" ? (
        <LocalCouncilVotesTile cycle={cycle} />
      ) : view === "strongest-mandates" ? (
        <LocalTopMayorsTile cycle={cycle} rows={full?.topMayorsByPct} />
      ) : view === "closest-races" ? (
        <LocalClosestRacesTile cycle={cycle} rows={full?.closestRaces} />
      ) : (
        <LocalSwingTile />
      )}
    </main>
  );
};
