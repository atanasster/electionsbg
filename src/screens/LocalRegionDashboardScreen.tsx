// Region (oblast) local-elections dashboard screen.
// Route: /local/:cycle/region/:oblast
//
// Anchored to the parliamentary election via the cycle in the URL (the
// national page and parliamentary "see details" links resolve that cycle
// through useLocalAsOf). Sofia city (SOF) is served by the município/city
// dashboard, not here.

import { FC } from "react";
import { useParams, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useRegions } from "@/data/regions/useRegions";
import { friendlyCycleDate } from "@/data/local/cycleDate";
import { LocalRegionDashboardCards } from "./dashboard/local/LocalRegionDashboardCards";
import { PlaceHeader } from "@/screens/components/PlaceHeader";

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
    <section className="my-4 space-y-6">
      <PlaceHeader
        active="local"
        level="region"
        oblast={oblast}
        cycle={cycle}
        eyebrowTo={`/local/${cycle}`}
        eyebrowSuffix={friendlyCycleDate(cycle)}
        fallbackName={name}
      />
      <LocalRegionDashboardCards cycle={cycle} oblast={oblast} />
    </section>
  );
};
