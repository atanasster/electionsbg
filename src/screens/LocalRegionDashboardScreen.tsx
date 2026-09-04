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
import { ElectionSurfaceBoundary } from "@/screens/elections/ElectionSurfaceBoundary";
import { ElectionResultsShell } from "@/screens/elections/ElectionResultsShell";
import { ElectionScopeBar } from "@/screens/elections/ElectionScopeBar";
import { ElectionSurfaceSkeleton } from "@/screens/elections/ElectionSurfaceSkeleton";

export const LocalRegionDashboardScreen: FC = () => {
  const { cycle, oblast } = useParams<{ cycle: string; oblast: string }>();
  const { i18n } = useTranslation();
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
  // ⚠ NO `SOF` BRANCH HERE. It was unreachable: the redirect above returns before this line for
  // that one code, so the fallback could only ever be the bare `oblast`.
  const name = info
    ? (i18n.language === "bg"
        ? info.long_name || info.name
        : info.long_name_en || info.name_en) || oblast
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
        scope={<ElectionScopeBar cycle={cycle} status="final" />}
      />
      {/* ⚠ THE ARTIFACT EXISTED AND NOTHING READ IT — one of four local levels generated,
          budgeted and published with no reader. A region's local artifact carries per-party
          SEATS across its municipalities; it carries no per-party vote total, which is why the
          level declares `rankedColumns: ["seats"]` and why declaring the vote columns would
          have printed the producer's placeholder zeros as figures.

          ⚠ SOFIA REDIRECTS PAST THIS, AND ITS ARTIFACT IS THEREFORE ORPHANED. An earlier
          version of this comment said the boundary "cannot be asked for a surface that does not
          exist" — `surface/region/SOF.json` DOES exist and is a real Sofia-city council result.
          The redirect above is still right (Sofia is one município that is also its own oblast,
          so a region page here would be degenerate), but the honest statement is that one
          published artifact has no reader by routing, not that none was written. */}
      <ElectionSurfaceBoundary
        kind="local"
        level="region"
        cycle={cycle}
        id={oblast}
        // ⚠ ONE FACT, NOT TWO, AND NO MAP — the skeleton must reserve what the page renders.
        // The artifact carries `seats` and `turnout`, but this level's `factPriority` has no
        // `turnout`, so only one card ever appears; and `MAP_ADAPTERS` registers no `local/*`
        // entry, so the map slot renders one line of "not available" rather than a map.
        skeleton={<ElectionSurfaceSkeleton facts={1} withMap={false} />}
        fallback={null}
      >
        {(s) => (
          <ElectionResultsShell
            surface={s}
            scope="header"
            currentView="local"
          />
        )}
      </ElectionSurfaceBoundary>
      <LocalRegionDashboardCards cycle={cycle} oblast={oblast} />
    </section>
  );
};
