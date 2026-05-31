// Region (oblast) local-elections dashboard screen.
// Route: /local/:cycle/region/:oblast
//
// Anchored to the parliamentary election via the cycle in the URL (the
// national page and parliamentary "see details" links resolve that cycle
// through useLocalAsOf). Sofia city (SOF) is served by the município/city
// dashboard, not here.

import { FC } from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useRegions } from "@/data/regions/useRegions";
import { friendlyCycleDate } from "@/data/local/cycleDate";
import { LocalRegionDashboardCards } from "./dashboard/local/LocalRegionDashboardCards";
import { ToParliamentaryLink } from "@/screens/components/CrossElectionLink";

export const LocalRegionDashboardScreen: FC = () => {
  const { cycle, oblast } = useParams<{ cycle: string; oblast: string }>();
  const { t, i18n } = useTranslation();
  const { findRegion } = useRegions();
  if (!cycle || !oblast) return null;
  // Sofia city is a single município that is also its own oblast — there's no
  // separate region GeoJSON for it (parliamentary splits it into S23/S24/S25).
  // Send region/SOF to the dedicated Sofia city/município dashboard instead of
  // rendering a degenerate one-município region page with an empty map.
  if (oblast === "SOF") {
    return <Navigate to={`/local/${cycle}/SOF`} replace />;
  }

  const info = findRegion(oblast);
  const name = info
    ? (i18n.language === "bg"
        ? info.long_name || info.name
        : info.long_name_en || info.name_en) || oblast
    : oblast === "SOF"
      ? t("local_region_sofia_city")
      : oblast;

  return (
    <main className="container mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          <Link to={`/local/${cycle}`} className="hover:underline">
            {t("local_election_screen_back")}
          </Link>
          <span className="mx-2">·</span>
          <span>{friendlyCycleDate(cycle)}</span>
        </div>
        <ToParliamentaryLink level="region" oblast={oblast} />
      </div>
      <h1 className="text-2xl font-semibold">{name}</h1>
      <LocalRegionDashboardCards cycle={cycle} oblast={oblast} />
    </main>
  );
};
