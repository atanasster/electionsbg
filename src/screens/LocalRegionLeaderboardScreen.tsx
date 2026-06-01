// Standalone full-list pages behind the region (oblast) dashboard's party
// ranked-bar tiles. One screen, two views — each renders the same tile the
// region dashboard uses, but in full mode (no top-N slice, no inner scroll):
//
//   mayors-by-party → mayoralties won per party  (region/<oblast>.json)
//   council-seats   → council seats per party    (region/<oblast>.json)
//
// Routes: /local/:cycle/region/:oblast/{mayors-by-party,council-seats}. Mirrors
// LocalLeaderboardScreen, but region-scoped (back-link + region name in the
// breadcrumb). Region split control has its own list page
// (LocalMunicipalityListScreen list="split").

import { FC } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { friendlyCycleDate } from "@/data/local/cycleDate";
import { useRegions } from "@/data/regions/useRegions";
import {
  LocalRegionMayorsTile,
  LocalRegionCouncilSeatsTile,
} from "./dashboard/local/LocalRegionPartyBarTiles";

export type LocalRegionLeaderboardView = "mayors-by-party" | "council-seats";

const TITLE_KEY: Record<LocalRegionLeaderboardView, string> = {
  "mayors-by-party": "local_leaderboard_mayors_by_party",
  "council-seats": "local_leaderboard_council_seats",
};

export const LocalRegionLeaderboardScreen: FC<{
  view: LocalRegionLeaderboardView;
}> = ({ view }) => {
  const { t, i18n } = useTranslation();
  const { cycle, oblast } = useParams<{ cycle: string; oblast: string }>();
  const { findRegion } = useRegions();

  if (!cycle || !oblast) return null;

  const info = findRegion(oblast);
  const regionName = !info
    ? oblast === "SOF"
      ? t("local_region_sofia_city")
      : oblast
    : (i18n.language === "bg"
        ? info.long_name || info.name
        : info.long_name_en || info.name_en) || oblast;

  return (
    <main className="container mx-auto px-4 py-6 space-y-6">
      <div className="text-xs text-muted-foreground">
        <Link
          to={`/local/${cycle}/region/${oblast}`}
          className="hover:underline"
        >
          {t("local_election_screen_back")}
        </Link>
        <span className="mx-2">·</span>
        <span>{friendlyCycleDate(cycle)}</span>
        <span className="mx-2">·</span>
        <span>{regionName}</span>
      </div>
      <h1 className="text-2xl font-semibold">{t(TITLE_KEY[view])}</h1>

      {view === "mayors-by-party" ? (
        <LocalRegionMayorsTile cycle={cycle} oblast={oblast} />
      ) : (
        <LocalRegionCouncilSeatsTile cycle={cycle} oblast={oblast} />
      )}
    </main>
  );
};
