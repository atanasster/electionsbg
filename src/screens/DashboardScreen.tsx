// The parliamentary country result — `/parliamentary`, and `/elections/:date` per cycle.
//
// ⚠ IT IS A `canonical` LEVEL (§5.0): `national_summary.json` is 14.4 KB, inside the 24 KiB
// country budget, so no surface artifact is emitted for it and none is fetched. The shell is fed
// by `parliamentaryCountrySurface`, a pure transform of the shard this page already loads for
// its deeper sections — which is exactly what §5.0 means by "the shell reads that shard through
// the same `surfacePath.ts` indirection and a thin adapter".
//
// ⚠ THE SCOPE IS IN THE HEADER, NOT UNDER IT (§4). The cycle and status compose into
// `PlaceHeader` beside the view pills; the shell is told `scope="header"` so it does not draw a
// second copy, which would print the same two words twice and stack a control row above the
// first number on the page.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SEO } from "@/ux/SEO";
import { useElectionContext } from "@/data/ElectionContext";
import { localDate } from "@/data/utils";
import { useNationalSummary } from "@/data/dashboard/useNationalSummary";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useLatestLocalCycle } from "@/data/local/useLatestLocalCycle";
import { buildPartyIndex } from "@/data/elections/partyIndex";
import { parliamentaryCountrySurface } from "@/data/elections/canonicalSurface";
import { DashboardCards } from "./dashboard/DashboardCards";
import { PlaceHeader } from "@/screens/components/PlaceHeader";
import { ElectionSurfaceBoundary } from "@/screens/elections/ElectionSurfaceBoundary";
import { ElectionResultsShell } from "@/screens/elections/ElectionResultsShell";
import { ElectionScopeBar } from "@/screens/elections/ElectionScopeBar";
import { ElectionSurfaceSkeleton } from "@/screens/elections/ElectionSurfaceSkeleton";

export const DashboardScreen = () => {
  const { t } = useTranslation();
  const { selected, electionStats } = useElectionContext();
  const { data: summary } = useNationalSummary();
  const { data: canonicalParties } = useCanonicalParties();
  const localCycle = useLatestLocalCycle();
  const title = `${t("general_elections")} ${localDate(selected)}`;

  // ⚠ THE INDEX IS BUILT FROM THE CORPUS ALREADY IN MEMORY. `useCanonicalParties` fetches
  // `canonical_parties.json` once for the whole app; rebuilding the (election, partyNum) map
  // here costs one pass and adds no request. `null` while it is in flight is a real state —
  // the surface still ranks, with no labels, because the votes are the answer.
  const partyIndex = useMemo(
    () => (canonicalParties ? buildPartyIndex(canonicalParties.parties) : null),
    [canonicalParties],
  );

  const surface = useMemo(
    () =>
      summary
        ? parliamentaryCountrySurface({
            summary,
            cycle: selected,
            partyIndex,
            // The protocol lives in the bundled cycle catalogue, not in `national_summary.json`
            // — which publishes a pre-computed rate and not the figures behind it. Without it
            // the totals report `turnoutBasis: "unavailable"` rather than inventing a rate.
            protocol: electionStats?.results?.protocol,
            localCycle,
          })
        : undefined,
    [summary, selected, partyIndex, electionStats, localCycle],
  );

  return (
    <>
      <SEO
        title={title}
        description="Interactive country map of Bulgaria's parliamentary elections — part of an open-data platform on how the country is governed: parliament, the state budget, procurement, EU funds, and the cost of living."
      />
      <PlaceHeader
        active="parliamentary"
        level="country"
        className="my-4"
        scope={
          <ElectionScopeBar
            cycle={selected}
            status={surface?.status.result ?? "final"}
          />
        }
      />
      <ElectionSurfaceBoundary
        kind="parliamentary"
        level="country"
        cycle={selected}
        id="BG"
        canonicalSurface={surface}
        skeleton={<ElectionSurfaceSkeleton facts={4} />}
        // ⚠ THE FALLBACK IS THE PAGE WITHOUT ITS FIRST SCREEN, not a second copy of it. The
        // deeper sections render either way; what the shell adds is the strip and the canvas,
        // and those are exactly the numbers `DashboardCards` no longer draws.
        fallback={null}
      >
        {(s) => (
          <ElectionResultsShell
            surface={s}
            scope="header"
            currentView="parliamentary"
          />
        )}
      </ElectionSurfaceBoundary>
      <DashboardCards />
    </>
  );
};
