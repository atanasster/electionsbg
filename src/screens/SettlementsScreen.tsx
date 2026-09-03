import { useMemo } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useRegions } from "@/data/regions/useRegions";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useMunicipalityVotes } from "@/data/municipalities/useMunicipalityVotes";
import {
  isSofiaCityObshtina,
  isSofiaRayonObshtina,
} from "@/data/local/placeViews";
import { findCityRayon } from "@/data/local/cityRayonCatalog";
import { SEO } from "@/ux/SEO";
import { placeResultsTitle } from "@/ux/seoTitle";
import { PlaceHeader } from "@/screens/components/PlaceHeader";
import { MunicipalityDashboardCards } from "./dashboard/MunicipalityDashboardCards";
import { SectionsScreen } from "./SectionsScreen";
import { useElectionContext } from "@/data/ElectionContext";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useLatestLocalCycle } from "@/data/local/useLatestLocalCycle";
import { buildPartyIndex } from "@/data/elections/partyIndex";
import { parliamentaryMunicipalitySurface } from "@/data/elections/canonicalSurface";
import { useElectionSurface } from "@/data/elections/useElectionSurface";
import { ElectionSurfaceBoundary } from "@/screens/elections/ElectionSurfaceBoundary";
import { ElectionResultsShell } from "@/screens/elections/ElectionResultsShell";
import { ElectionScopeBar } from "@/screens/elections/ElectionScopeBar";
import { ElectionSurfaceSkeleton } from "@/screens/elections/ElectionSurfaceSkeleton";
import {
  buildPlaceDigest,
  localDigestFromSurface,
} from "@/screens/elections/placeDigestFacts";

export const SettlementsScreen = () => {
  const { id: muniCode } = useParams();
  const { findRegion } = useRegions();
  const { findMunicipality } = useMunicipalities();
  const { municipality } = useMunicipalityVotes(muniCode);
  const { i18n, t } = useTranslation();
  const { selected } = useElectionContext();
  const { data: canonicalParties } = useCanonicalParties();
  const localCycle = useLatestLocalCycle();
  // ⚠ EVERY HOOK ABOVE THE EARLY RETURNS. This screen bails on four conditions — no code, an
  // EKATTE, Sofia city, an unresolvable município — and a hook after any of them would be a
  // conditional call.
  const partyIndex = useMemo(
    () => (canonicalParties ? buildPartyIndex(canonicalParties.parties) : null),
    [canonicalParties],
  );
  const surface = useMemo(
    () =>
      municipality?.results?.votes && muniCode
        ? parliamentaryMunicipalitySurface({
            obshtina: muniCode,
            cycle: selected,
            votes: municipality.results.votes,
            protocol: municipality.results.protocol,
            partyIndex,
            localCycle,
            inLocalCycle: true,
          })
        : undefined,
    [municipality, muniCode, selected, partyIndex, localCycle],
  );
  // ⚠ THE DIGEST'S МЕСТНИ CELL READS THE LOCAL SURFACE — the same artifact the Местни tab
  // renders (§Phase 5 item 4b). A second resolver here is how a digest ends up naming one mayor
  // while the tab one click away names another: wrong about a named individual, at a 200, with
  // no row count moving.
  const local = useElectionSurface({
    kind: "local",
    level: "municipality",
    cycle: localCycle,
    id: muniCode,
  });
  const digest = useMemo(
    () =>
      buildPlaceDigest({
        place: { level: "municipality", obshtina: muniCode ?? "" },
        parliamentaryCycle: selected,
        localCycle,
        winner:
          surface?.ballots[0]?.preview[0] &&
          surface.ballots[0].preview[0].marginPct !== undefined
            ? {
                partyId: surface.ballots[0].preview[0].partyId,
                pct: surface.ballots[0].preview[0].pct,
                marginPct: surface.ballots[0].preview[0].marginPct,
              }
            : undefined,
        local: localDigestFromSurface(
          local.status === "ready" ? local.surface : undefined,
        ),
        currentView: "parliamentary",
      }),
    [muniCode, selected, localCycle, surface, local],
  );
  if (!muniCode) {
    return null;
  }
  // EKATTE codes start with a digit. Pure-numeric forms (e.g. "69599") are
  // the common case; Sofia район-as-settlement uses composites like
  // "68134-2401" (still starts with a digit). Obshtina codes always start
  // with a letter (e.g. TGV35, S2401), so a leading-digit test cleanly
  // separates the two without dropping the composite case. The plain
  // settlement URLs are prerendered + indexed by Google, so route both
  // shapes to the settlement view rather than breaking the page.
  if (/^\d/.test(muniCode)) {
    return <SectionsScreen />;
  }
  // The Sofia city bundle (synthetic SOF00 / local SOF) has no município row
  // in municipalities.json — its parliamentary view is the dedicated /sofia
  // page (see placeViews parliamentaryUrl). Without this, every lookup here
  // returns undefined and the page renders the raw code with empty tiles.
  if (isSofiaCityObshtina(muniCode)) {
    return <Navigate to="/sofia" replace />;
  }
  const lang = i18n.language === "bg" ? "bg" : "en";
  const info = findMunicipality(muniCode);
  const region = findRegion(municipality?.oblast ?? info?.oblast);
  // A Пловдив/Варна район ("PDV22-06") isn't in municipalities.json — resolve
  // its name from the catalog so the page reads "район Тракия", not the code.
  const cityRayon = findCityRayon(muniCode);
  // A Sofia район-as-município (S2xxx) or a Пловдив/Варна район: label "район".
  const isRayon = isSofiaRayonObshtina(muniCode) || !!cityRayon;
  // Abroad (МИР 32): the "municipality" is a continent bucket — label it
  // "Континент {name}", not "Община {name}".
  const isAbroad = (municipality?.oblast ?? info?.oblast) === "32";
  const muniName = cityRayon
    ? lang === "bg"
      ? cityRayon.labelBg
      : cityRayon.labelEn
    : info
      ? lang === "bg"
        ? info?.name
        : info?.name_en
      : muniCode;
  const regionName = region
    ? lang === "bg"
      ? region.long_name || region.name
      : region.long_name_en || region.name_en
    : "";
  const titleStr = region ? `${regionName} / ${muniName}` : muniName;
  // The /settlement/:id route is actually a MUNICIPALITY (община) dashboard —
  // the historical "off-by-one" route naming (see placeViews.ts). Title it with
  // the real tier ("Община {name}", or "Район {name}" for a Sofia район) so the
  // browser tab reads as one place, not the old plural "Общини {name}" that
  // looked like a list of municipalities.
  const typeKey = isAbroad ? "continent" : isRayon ? "rayon" : "municipality";
  const seoTitle =
    lang === "bg" ? `${t(typeKey)} ${muniName}` : `${muniName} (${t(typeKey)})`;
  // Rich document <title> matching the prerendered crawler HTML — same place
  // label, lower-cased tier word in the language's natural position.
  const tierLower = t(typeKey).toLowerCase();
  const placeLabel =
    lang === "bg" ? `${tierLower} ${muniName}` : `${muniName} ${tierLower}`;
  return (
    <>
      <SEO
        title={seoTitle}
        fullTitle={placeResultsTitle(placeLabel, lang)}
        description={titleStr}
      />
      <PlaceHeader
        active="parliamentary"
        level="municipality"
        obshtina={muniCode}
        oblast={municipality?.oblast ?? info?.oblast}
        fallbackName={muniName}
        className="my-4"
        scope={<ElectionScopeBar cycle={selected} status="final" />}
      />
      <ElectionSurfaceBoundary
        kind="parliamentary"
        level="municipality"
        cycle={selected}
        id={muniCode}
        providedSurface={surface}
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
      <MunicipalityDashboardCards municipalityCode={muniCode} />
    </>
  );
};
