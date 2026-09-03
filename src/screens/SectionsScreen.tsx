import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { useSettlementVotes } from "@/data/settlements/useSettlementVotes";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useRegions } from "@/data/regions/useRegions";
import { typedSettlementName } from "@/data/dataTypes";
import { bareOblastName, oblastLabel } from "@/lib/oblastName";
import { SEO } from "@/ux/SEO";
import { placeResultsTitle } from "@/ux/seoTitle";
import { PlaceHeader } from "@/screens/components/PlaceHeader";
import { SettlementDashboardCards } from "./dashboard/SettlementDashboardCards";
import { useElectionContext } from "@/data/ElectionContext";
import { useLatestLocalCycle } from "@/data/local/useLatestLocalCycle";
import { useElectionSurface } from "@/data/elections/useElectionSurface";
import { ElectionSurfaceBoundary } from "@/screens/elections/ElectionSurfaceBoundary";
import { ElectionResultsShell } from "@/screens/elections/ElectionResultsShell";
import { ElectionScopeBar } from "@/screens/elections/ElectionScopeBar";
import { ElectionSurfaceSkeleton } from "@/screens/elections/ElectionSurfaceSkeleton";
import {
  buildPlaceDigest,
  localDigestFromSurface,
} from "@/screens/elections/placeDigestFacts";

export const SectionsScreen = () => {
  const { id: ekatte } = useParams();
  const { findSettlement } = useSettlementsInfo();
  const { settlement } = useSettlementVotes(ekatte ?? "");
  const { findMunicipality } = useMunicipalities();
  const { findRegion } = useRegions();
  const { i18n } = useTranslation();
  const { selected } = useElectionContext();
  const localCycle = useLatestLocalCycle();
  // ⚠ EVERY HOOK ABOVE THE EARLY RETURN — `if (!ekatte) return null` is below.
  //
  // ⚠ THE МЕСТНИ CELL READS THE LOCAL SETTLEMENT SURFACE, the same artifact the Местни tab
  // renders (§Phase 5 item 4b, which binds every level that shows a digest). A settlement's
  // local page carries its own кметство mayor where one was elected; a second resolver here is
  // how a digest names one person and the tab another.
  const local = useElectionSurface({
    kind: "local",
    level: "settlement",
    cycle: localCycle,
    id: ekatte,
  });
  const digest = useMemo(
    () =>
      buildPlaceDigest({
        place: { level: "settlement", ekatte: ekatte ?? "" },
        parliamentaryCycle: selected,
        localCycle,
        local: localDigestFromSurface(
          local.status === "ready" ? local.surface : undefined,
        ),
        currentView: "parliamentary",
      }),
    [ekatte, selected, localCycle, local],
  );
  if (!ekatte) return null;
  const lang = i18n.language === "bg" ? "bg" : "en";
  const info = findSettlement(ekatte);
  const municipality = findMunicipality(settlement?.obshtina ?? info?.obshtina);
  const region = findRegion(settlement?.oblast ?? info?.oblast);
  const settlementName = info
    ? lang === "bg"
      ? info.name
      : info.name_en
    : ekatte;
  const regionName = region
    ? lang === "bg"
      ? region.long_name || region.name
      : region.long_name_en || region.name_en
    : "";
  const municipalityName = municipality
    ? lang === "bg"
      ? municipality.name
      : municipality.name_en
    : "";
  const titleStr = [regionName, municipalityName, settlementName]
    .filter(Boolean)
    .join(" / ");
  // The /sections/:ekatte route is the settlement's parliamentary dashboard,
  // not a list of polling stations — title it by the typed place name
  // ("кв. Лозенец") to match the page <h1>, not "Секции {name}".
  const typed = typedSettlementName(info, lang, settlementName);
  // Rich document <title> matching the prerendered crawler HTML:
  // "Резултати в кв. Лозенец, обл. София — …". `oblastLabel` adds the "обл."
  // only where it belongs — a Sofia МИР or the abroad district already reads as
  // its own context ("София 23 МИР", "Извън страната"), and PDV's own name
  // carries the prefix already. English names the region without a tier word.
  const oblastContext = regionName
    ? lang === "bg"
      ? `, ${oblastLabel(regionName, "bg", "compact")}`
      : `, ${bareOblastName(regionName)}`
    : "";
  return (
    <>
      <SEO
        title={typed}
        fullTitle={placeResultsTitle(`${typed}${oblastContext}`, lang)}
        description={titleStr}
      />
      <PlaceHeader
        active="parliamentary"
        level="settlement"
        ekatte={ekatte}
        obshtina={settlement?.obshtina ?? info?.obshtina}
        oblast={settlement?.oblast ?? info?.oblast}
        fallbackName={settlementName}
        className="my-4"
        scope={<ElectionScopeBar cycle={selected} status="final" />}
      />
      <ElectionSurfaceBoundary
        kind="parliamentary"
        level="settlement"
        cycle={selected}
        id={ekatte}
        skeleton={<ElectionSurfaceSkeleton facts={4} />}
        fallback={null}
      >
        {(s) => (
          <ElectionResultsShell
            surface={s}
            scope="header"
            currentView="parliamentary"
            digest={digest}
          />
        )}
      </ElectionSurfaceBoundary>
      <SettlementDashboardCards ekatte={ekatte} />
    </>
  );
};
