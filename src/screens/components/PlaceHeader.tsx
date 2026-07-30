// Unified header for the "views" of a single place — the Governance dashboard
// (/governance, /governance/region/:oblast, /governance/:id), the parliamentary-
// elections results (/sections/:ekatte, /settlement/:obshtina), the local-
// elections results (/local/:cycle/...), and Consumption. Before this component
// each screen rolled its own header, so the same place looked like unrelated
// pages and nothing but the small switcher told you which dashboard you were on.
//
// This file is the JSON-BACKED WRAPPER: it resolves identity from the shared geo
// hooks (settlements.json / municipalities.json / regions.json + GRAO) and hands
// a fully-resolved identity to the presentational PlaceHeaderView. The narrative
// is composed by the pure renderPlaceNarrative(). That split lets a PG-backed
// page (the procurement settlement page) render the IDENTICAL hero without
// shipping the 940 KB settlements.json — it builds the same inputs from Postgres.
//
// "Which dashboard am I on" is answered three redundant ways, all keyed to one
// accent hue per view (PLACE_VIEW_META): the left border of the Card, the eyebrow
// icon + label, and the active pill inside PlaceViewNav (all inside the View).
//
// Identity is resolved from the shared geographic codes, so the title is
// localized everywhere. `fallbackName` covers the rare code that resolves to
// nothing.

import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  PlaceLevel,
  PlaceRef,
  PlaceView,
  placeViewUrl,
  isSofiaRayonObshtina,
  SOFIA_CITY_GOVERNANCE_ID,
} from "@/data/local/placeViews";
import { findCityRayon } from "@/data/local/cityRayonCatalog";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useRegions } from "@/data/regions/useRegions";
import { useGraoMunicipalitySlice } from "@/data/grao/useGraoPopulation";
import { useLatestLocalCycle } from "@/data/local/useLatestLocalCycle";
import { PlaceHeaderView } from "./place/PlaceHeaderView";
import { renderPlaceNarrative } from "./place/placeNarrative";

type Props = {
  active: PlaceView;
  level: PlaceLevel;
  ekatte?: string;
  obshtina?: string;
  oblast?: string;
  // Makes the colored eyebrow a link (local → its cycle's overview feed).
  eyebrowTo?: string;
  // Trailing context after the eyebrow label (e.g. the local cycle date).
  eyebrowSuffix?: ReactNode;
  // Title to show when the codes resolve to nothing (defensive / synthetic
  // aggregates like Sofia's SOF bundle).
  fallbackName?: string;
  // The polling-station code for level="section" — the title becomes
  // "Section {code}" and the breadcrumb drills up to the parent settlement.
  sectionCode?: string;
  // Per-view cross-link rendered under the breadcrumb (e.g. район → all of
  // Sofia).
  extra?: ReactNode;
  // The local-elections cycle this page is anchored to (only the /local/:cycle/…
  // screens pass it). It keeps the breadcrumb's parent links on the SAME cycle
  // when active="local"; for the other views the cycle is irrelevant. Defaults
  // to the cycle in effect as of the selected election when omitted.
  cycle?: string;
  // Replaces the default PlaceViewNav switcher (e.g. SOF city keeps a single
  // → parliamentary pill instead of the three-way control).
  navSlot?: ReactNode;
  className?: string;
};

// Settlement/município centroids in our data files are stored as "lon,lat"
// strings. Returns null if either coord can't be parsed.
const parseLoc = (loc?: string): { lat: number; lon: number } | null => {
  if (!loc) return null;
  const [lonStr, latStr] = loc.split(",");
  if (!lonStr || !latStr) return null;
  const lat = Number(latStr);
  const lon = Number(lonStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
};

export const PlaceHeader: FC<Props> = ({
  active,
  level,
  ekatte,
  obshtina,
  oblast,
  eyebrowTo,
  eyebrowSuffix,
  fallbackName,
  sectionCode,
  extra,
  navSlot,
  cycle,
  className,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { findSettlement } = useSettlementsInfo();
  const { findMunicipality } = useMunicipalities();
  const { findRegion } = useRegions();
  // Cycle the breadcrumb's local-view parent links anchor to: the page's own
  // cycle when given (the /local/:cycle/… screens pass it), else the cycle in
  // effect as of the selected election — same source PlaceViewNav uses to point
  // its Местни pill.
  const fallbackCycle = useLatestLocalCycle();
  const activeCycle = cycle ?? fallbackCycle;

  const isSettlement = level === "settlement";
  const isSection = level === "section";
  const isCountry = level === "country";
  const isRegion = level === "region";
  // A Sofia район (e.g. Лозенец) arrives as a município-level place whose
  // obshtina is an S2xxx shard. It is an административен район of Столична
  // община — not a self-standing община — and S23/S24/S25 are МИР, not области.
  const isSofiaRayon =
    level === "municipality" && isSofiaRayonObshtina(obshtina);
  // A Пловдив/Варна sub-city район ("PDV22-04") also arrives as a município-
  // level place, but it isn't in municipalities.json — it's an административен
  // район of Община Пловдив/Варна.
  const cityRayon =
    level === "municipality" ? findCityRayon(obshtina) : undefined;
  const isCityRayon = !!cityRayon;
  // Settlement + section both anchor on a settlement EKATTE — a section drills
  // one level below its settlement, which we surface in its breadcrumb.
  const usesSettlement = isSettlement || isSection;
  const settlement = usesSettlement ? findSettlement(ekatte) : undefined;
  const obshtinaForName = usesSettlement
    ? (settlement?.obshtina ?? obshtina)
    : obshtina;
  const muni = obshtinaForName ? findMunicipality(obshtinaForName) : undefined;
  const oblastCode = oblast ?? settlement?.oblast ?? muni?.oblast;
  const region = oblastCode ? findRegion(oblastCode) : undefined;
  // The abroad МИР (oblast "32", "Извън страната") isn't an oblast inside
  // Bulgaria: its "municipalities" are continents and its "settlements" are
  // countries.
  const isAbroad = oblastCode === "32";
  // A settlement/section whose parent obshtina is a Sofia район.
  const parentIsSofiaRayon =
    usesSettlement && isSofiaRayonObshtina(obshtinaForName);

  // GRAO only for settlements — the slice is per-obshtina, indexed by ekatte.
  const graoObshtina = isSettlement ? settlement?.obshtina : undefined;
  const { data: graoSlice } = useGraoMunicipalitySlice(graoObshtina);

  const settlementType = usesSettlement ? settlement?.t_v_m : null;
  // The 21 central Sofia районы are stored as settlements with a composite
  // "68134-NNNN" EKATTE and the type marker `t_v_m="общ."`. Show "кв." instead.
  const isSofiaRayonSettlement = settlementType === "общ.";
  const displaySettlementType = isSofiaRayonSettlement ? "кв." : settlementType;
  const settlementName = settlement
    ? lang === "bg"
      ? settlement.name
      : settlement.name_en
    : undefined;
  const muniName = muni ? (lang === "bg" ? muni.name : muni.name_en) : null;

  // Strip the tautological "област"/"region" suffix some region names carry
  // (SFO = "София област") — the narrative template re-adds it.
  const regionNameRaw = region
    ? lang === "bg"
      ? region.long_name || region.name
      : region.long_name_en || region.name_en
    : null;
  const regionName = regionNameRaw
    ? lang === "bg"
      ? regionNameRaw.replace(/\s+област$/u, "").trim()
      : regionNameRaw.replace(/\s+region$/iu, "").trim()
    : null;

  // The h1 text, per level.
  const resolvedName = isSettlement
    ? settlementName
    : isCountry
      ? t("bulgaria")
      : isRegion
        ? (regionNameRaw ?? undefined)
        : isSection
          ? `${t("section")} ${sectionCode ?? ""}`.trim()
          : muni
            ? lang === "bg"
              ? muni.name
              : muni.name_en
            : undefined;
  const name = resolvedName ?? fallbackName ?? ekatte ?? obshtina ?? "";

  const graoRow =
    isSettlement && graoSlice && settlement
      ? graoSlice.settlements[settlement.ekatte]
      : undefined;
  const graoAsOf = isSettlement ? (graoSlice?.asOf ?? null) : null;

  // Country/region carry no centroid; a section borrows its settlement's.
  const loc = usesSettlement
    ? parseLoc(settlement?.loc)
    : isRegion || isCountry
      ? null
      : parseLoc(muni?.loc);

  // Drilling up the hierarchy keeps the active view. Each parent link is a pure
  // rewrite of the shared codes into the active view's URL (placeViewUrl).
  const linkFor = (p: PlaceRef): string | null =>
    placeViewUrl(active, p, activeCycle);
  const muniHref = settlement
    ? linkFor({
        level: "municipality",
        obshtina: settlement.obshtina,
        oblast: settlement.oblast,
      })
    : null;
  const regionHref = oblastCode
    ? linkFor({ level: "region", oblast: oblastCode })
    : null;
  const settlementHref = settlement
    ? linkFor({ level: "settlement", ekatte: settlement.ekatte })
    : null;
  const sofiaCityHref =
    linkFor({ level: "municipality", obshtina: SOFIA_CITY_GOVERNANCE_ID }) ??
    `/governance/${SOFIA_CITY_GOVERNANCE_ID}`;
  const countryHref = linkFor({ level: "country" }) ?? "/";
  const cityRayonParentHref = cityRayon
    ? linkFor({ level: "municipality", obshtina: cityRayon.obshtina })
    : null;

  const titleText =
    (isSofiaRayon || isCityRayon) && lang === "bg"
      ? `район ${name}`
      : isSettlement && displaySettlementType && lang === "bg"
        ? `${displaySettlementType} ${name}`
        : name;
  // A section's thumbnail shows its settlement, so label the map with that.
  const thumbName = isSection ? (settlementName ?? name) : name;

  const narrative = renderPlaceNarrative({
    lang,
    isCountry,
    isRegion,
    isSection,
    isSettlement,
    isSofiaRayon,
    isCityRayon,
    isAbroad,
    parentIsSofiaRayon,
    name,
    muniName,
    regionName,
    regionNameRaw,
    settlementName,
    settlementType,
    displaySettlementType,
    sectionCode,
    oblastCode,
    obshtina,
    cityRayon,
    muniHref,
    regionHref,
    settlementHref,
    sofiaCityHref,
    countryHref,
    cityRayonParentHref,
  });

  const grao = graoRow
    ? {
        current: graoRow.current,
        permanent: graoRow.permanent,
        asOf: graoAsOf,
      }
    : null;

  return (
    <PlaceHeaderView
      active={active}
      level={level}
      ekatte={ekatte}
      obshtina={obshtina}
      oblast={oblast}
      titleText={titleText}
      narrative={narrative}
      loc={loc}
      isAbroad={isAbroad}
      thumbName={thumbName}
      grao={grao}
      eyebrowTo={eyebrowTo}
      eyebrowSuffix={eyebrowSuffix}
      extra={extra}
      navSlot={navSlot}
      className={className}
    />
  );
};
