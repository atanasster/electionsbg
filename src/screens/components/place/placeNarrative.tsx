// The composed breadcrumb narrative for a place identity header — lifted OUT of
// PlaceHeader so it is a PURE function of already-resolved names, hrefs and
// flags, with NO data-hook dependency. That decoupling is the whole point: the
// JSON-backed PlaceHeader wrapper AND a PG-backed resolver (e.g. the procurement
// settlement page, which must NOT ship the 940 KB settlements.json) both build a
// PlaceNarrativeContext and call renderPlaceNarrative — so the two pages read
// identically instead of each rolling their own subline.
//
// The wording matrix is unchanged from the original PlaceHeader.renderNarrative:
// country / region (incl. Sofia МИР + abroad МИР 32) / section / Sofia район /
// Пловдив-Варна city район / Sofia city aggregate / abroad "município" (a
// continent) / generic município / settlement (incl. abroad country + parent-is-
// Sofia-район). A PG resolver that only ever sees a plain 5-digit settlement
// (the procurement case, guarded by /^\d{5}$/) exercises just the settlement
// branch, so it needs to populate only that slice of the context.

import { ReactNode } from "react";
import { Link } from "@/ux/Link";
import { isSofiaMir } from "@/data/dataTypes";
import { isSofiaCityObshtina } from "@/data/local/placeViews";

export type PlaceNarrativeContext = {
  lang: "bg" | "en";
  // Level flags (mirror PlaceHeader's derived booleans).
  isCountry: boolean;
  isRegion: boolean;
  isSection: boolean;
  isSettlement: boolean;
  isSofiaRayon: boolean;
  isCityRayon: boolean;
  isAbroad: boolean;
  parentIsSofiaRayon: boolean;
  // Resolved, localized names.
  name: string;
  muniName: string | null;
  regionName: string | null;
  regionNameRaw: string | null;
  settlementName?: string;
  settlementType?: string | null;
  displaySettlementType?: string | null;
  sectionCode?: string;
  // Codes still needed by a couple of branch guards.
  oblastCode?: string;
  obshtina?: string;
  // The Пловдив/Варна sub-city район descriptor (labels + parent obshtina + МИР).
  cityRayon?: {
    cityBg: string;
    cityEn: string;
    obshtina: string;
    mir: string;
  };
  // Precomputed drill-up hrefs (the wrapper builds these via placeViewUrl so this
  // function stays pure — no view/cycle knowledge here).
  muniHref: string | null;
  regionHref: string | null;
  settlementHref: string | null;
  sofiaCityHref: string;
  countryHref: string;
  cityRayonParentHref: string | null;
};

// Composed breadcrumb narrative — município and oblast are links so the reader
// can drill up the hierarchy. Returns null for the country level (top of the
// hierarchy). Byte-for-byte the wording PlaceHeader shipped.
export const renderPlaceNarrative = (c: PlaceNarrativeContext): ReactNode => {
  const {
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
    oblastCode,
    obshtina,
    cityRayon,
    muniHref,
    regionHref,
    settlementHref,
    sofiaCityHref,
    countryHref,
    cityRayonParentHref,
  } = c;

  // Country: the nation is the top of the hierarchy — no parent to link to.
  if (isCountry) return null;

  // Shared parent chain for a place INSIDE a Sofia район (settlement or
  // section): "в район {Кремиковци}, {Столична община}, {София 24 МИР}" —
  // район-labelled (not "община"), Столична община threaded in, and the МИР
  // shown without an "област" prefix. The "в район {muni}" segment is always
  // kept: a квартал (кв. Лозенец) sits inside its район (район Лозенец) even
  // when they share a name — a район can hold several квартали, so this is a
  // real level, not a repetition.
  const sofiaRayonTail = () => {
    const muniNode =
      muniName && muniHref ? (
        <Link to={muniHref} underline>
          {muniName}
        </Link>
      ) : null;
    const regionNode =
      regionName && regionHref ? (
        <Link to={regionHref} underline>
          {regionName}
        </Link>
      ) : null;
    const sofiaNode = (
      <Link to={sofiaCityHref} underline>
        {lang === "bg" ? "Столична община" : "Sofia (Stolichna) municipality"}
      </Link>
    );
    return (
      <>
        {muniNode ? (
          lang === "bg" ? (
            <> в район {muniNode}, </>
          ) : (
            <> in {muniNode} district, </>
          )
        ) : (
          ", "
        )}
        {sofiaNode}
        {regionNode ? <>, {regionNode}</> : null}
      </>
    );
  };
  // Region: drill up to the national dashboard. Sofia's three МИР (S23/S24/
  // S25) are NOT области — they are електорални многомандатни изборни райони
  // that together cover Столична община — so they get a distinct narrative
  // that roots them under the city instead of "Област в България".
  if (isRegion) {
    // The abroad МИР (32, "Извън страната") is not an oblast inside Bulgaria —
    // its "municipalities" are world regions/continents — so the "Област в
    // България" narrative is wrong. Show no breadcrumb, like the country page.
    if (oblastCode === "32") return null;
    if (isSofiaMir(oblastCode)) {
      if (lang === "bg") {
        return (
          <>
            Многомандатен изборен район в{" "}
            <Link to={sofiaCityHref} underline>
              Столична община
            </Link>
          </>
        );
      }
      return (
        <>
          Multi-member electoral district in{" "}
          <Link to={sofiaCityHref} underline>
            Sofia (Stolichna) municipality
          </Link>
        </>
      );
    }
    if (lang === "bg") {
      return (
        <>
          Област в{" "}
          <Link to={countryHref} underline>
            България
          </Link>
        </>
      );
    }
    return (
      <>
        Oblast in{" "}
        <Link to={countryHref} underline>
          Bulgaria
        </Link>
      </>
    );
  }
  // Section: settlement (link) → município (link) → oblast (link).
  if (isSection) {
    const typedSettlement =
      displaySettlementType && lang === "bg"
        ? `${displaySettlementType} ${settlementName ?? ""}`.trim()
        : (settlementName ?? "");
    const settlementNode = settlementHref ? (
      <Link to={settlementHref} underline>
        {typedSettlement}
      </Link>
    ) : (
      typedSettlement
    );
    if (parentIsSofiaRayon) {
      return (
        <>
          {settlementNode}
          {sofiaRayonTail()}
        </>
      );
    }
    if (isAbroad) {
      // Abroad section: "{country} в {continent}, Извън страната" — drop the
      // "община"/"област" qualifiers, mirroring the abroad settlement view.
      return (
        <>
          {settlementNode}
          {muniName && muniHref ? (
            <>
              {lang === "bg" ? " в " : " in "}
              <Link to={muniHref} underline>
                {muniName}
              </Link>
            </>
          ) : null}
          {regionName && regionHref ? (
            <>
              ,{" "}
              <Link to={regionHref} underline>
                {regionName}
              </Link>
            </>
          ) : null}
        </>
      );
    }
    if (lang === "bg") {
      return (
        <>
          {settlementNode}
          {muniName && muniHref ? (
            <>
              {" "}
              в община{" "}
              <Link to={muniHref} underline>
                {muniName}
              </Link>
            </>
          ) : null}
          {regionName && regionHref ? (
            <>
              , област{" "}
              <Link to={regionHref} underline>
                {regionName}
              </Link>
            </>
          ) : null}
        </>
      );
    }
    return (
      <>
        {settlementNode}
        {muniName && muniHref ? (
          <>
            {" in "}
            <Link to={muniHref} underline>
              {muniName}
            </Link>{" "}
            municipality
          </>
        ) : null}
        {regionName && regionHref ? (
          <>
            ,{" "}
            <Link to={regionHref} underline>
              {regionName}
            </Link>{" "}
            oblast
          </>
        ) : null}
      </>
    );
  }
  // Sofia район: "Район на Столична община, {N} МИР" — the район belongs to
  // Столична община (linked to the município governance dashboard, the
  // canonical Столична-община page; /sofia is the oblast/МИР aggregate, not
  // the município) and sits inside one of the three МИР (linked, and named
  // "София N МИР" without an "област" prefix, since a МИР is not an област).
  if (isSofiaRayon) {
    const sofiaLink = (label: string) => (
      <Link to={sofiaCityHref} underline>
        {label}
      </Link>
    );
    const mirLink =
      regionHref && regionNameRaw ? (
        <Link to={regionHref} underline>
          {regionNameRaw}
        </Link>
      ) : null;
    if (lang === "bg") {
      return (
        <>
          Район на {sofiaLink("Столична община")}
          {mirLink ? <>, {mirLink}</> : null}
        </>
      );
    }
    return (
      <>
        District of {sofiaLink("Sofia (Stolichna) municipality")}
        {mirLink ? <>, {mirLink}</> : null}
      </>
    );
  }
  // Пловдив/Варна sub-city район: "Район на Община Пловдив, 16 МИР" — the
  // район belongs to its parent Община (linked to the Община's governance
  // dashboard, where the obshtina-grain data lives) and sits in one МИР
  // (Пловдив-град = 16 МИР, Варна = 3 МИР). No "област" prefix: a град-level
  // МИР is an изборен район, not an oblast — mirrors the Sofia район tail.
  if (isCityRayon && cityRayon) {
    const city = lang === "bg" ? cityRayon.cityBg : cityRayon.cityEn;
    const muniNode = (
      <Link
        to={cityRayonParentHref ?? `/governance/${cityRayon.obshtina}`}
        underline
      >
        {lang === "bg" ? `Община ${city}` : `${city} municipality`}
      </Link>
    );
    const mir = cityRayon.mir.replace(/^0+/, "");
    if (lang === "bg") {
      return (
        <>
          Район на {muniNode}, {mir} МИР
        </>
      );
    }
    return (
      <>
        District of {muniNode}, MIR {mir}
      </>
    );
  }
  // Sofia city aggregate (Столична община, keyed SOF00): the capital is a
  // single município that spans all three МИР, so the generic "Община {name},
  // област …" narrative doesn't fit. Its name ("София Град") already reads as
  // the city, so show it on its own without the "Община" / "municipality"
  // qualifier.
  if (!isSettlement && isSofiaCityObshtina(obshtina)) {
    return <>{name}</>;
  }
  if (!isSettlement && isAbroad) {
    // Abroad "município" — a continent bucket. Label it "Континент {name}"
    // and reference the diaspora district without the "област" qualifier:
    // "Континент Северна Америка, Извън страната".
    return (
      <>
        {lang === "bg" ? <>Континент {name}</> : <>{name} continent</>}
        {regionName && regionHref ? (
          <>
            ,{" "}
            <Link to={regionHref} underline>
              {regionName}
            </Link>
          </>
        ) : null}
      </>
    );
  }
  if (!isSettlement) {
    // Município view: "Община {name}, област {region}".
    if (lang === "bg") {
      return (
        <>
          Община {name}
          {regionName && regionHref ? (
            <>
              , област{" "}
              <Link to={regionHref} underline>
                {regionName}
              </Link>
            </>
          ) : null}
        </>
      );
    }
    return (
      <>
        {name} municipality
        {regionName && regionHref ? (
          <>
            ,{" "}
            <Link to={regionHref} underline>
              {regionName}
            </Link>{" "}
            oblast
          </>
        ) : null}
      </>
    );
  }
  // Settlement view.
  if (isAbroad) {
    // A country inside a continent bucket. Reference the continent without
    // the "община" qualifier and the diaspora district without "област":
    // "САЩ в Северна Америка, Извън страната".
    const typed = settlementType ? `${settlementType} ${name}` : name;
    return (
      <>
        {typed}
        {muniName && muniHref ? (
          <>
            {lang === "bg" ? " в " : " in "}
            <Link to={muniHref} underline>
              {muniName}
            </Link>
          </>
        ) : null}
        {regionName && regionHref ? (
          <>
            ,{" "}
            <Link to={regionHref} underline>
              {regionName}
            </Link>
          </>
        ) : null}
      </>
    );
  }
  if (parentIsSofiaRayon) {
    const typed =
      lang === "bg" && displaySettlementType
        ? `${displaySettlementType} ${name}`
        : name;
    return (
      <>
        {typed}
        {sofiaRayonTail()}
      </>
    );
  }
  if (lang === "bg") {
    const typed = settlementType ? `${settlementType} ${name}` : name;
    return (
      <>
        {typed}
        {muniName && muniHref ? (
          <>
            {" "}
            в община{" "}
            <Link to={muniHref} underline>
              {muniName}
            </Link>
          </>
        ) : null}
        {regionName && regionHref ? (
          <>
            , област{" "}
            <Link to={regionHref} underline>
              {regionName}
            </Link>
          </>
        ) : null}
      </>
    );
  }
  return (
    <>
      {name}
      {muniName && muniHref ? (
        <>
          {" in "}
          <Link to={muniHref} underline>
            {muniName}
          </Link>{" "}
          municipality
        </>
      ) : null}
      {regionName && regionHref ? (
        <>
          ,{" "}
          <Link to={regionHref} underline>
            {regionName}
          </Link>{" "}
          oblast
        </>
      ) : null}
    </>
  );
};
