// Hero strip at the top of the My-Area dashboard. Auto-generates a
// narrative line from settlement type + parent municipality + linked
// región, plus a compact registered-population table (current address +
// permanent address with the source date) and the centroid lat/lon so
// the user gets an immediate sense of "where" + "how many".
//
// The narrative is templated, not LLM-generated — same shape across all
// 5,300 settlements and zero hallucination risk. Município name and
// oblast name are rendered as Links to /settlement/<obshtina> and
// /municipality/<oblast> so the user can drill up from settlement →
// município → oblast in one click. The ГРАО registered-population
// block is the same data the CensusDemographicsTile used to surface
// further down the page; consolidating it here removes the duplicate
// (see CensusDemographicsTile's `hideGrao` prop) and gives the user the
// headcount the moment the page loads.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Link } from "@/ux/Link";
import type { ResolvedArea } from "@/data/area/useAreaResolver";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useRegions } from "@/data/regions/useRegions";
import { useGraoMunicipalitySlice } from "@/data/grao/useGraoPopulation";

type Props = {
  area: ResolvedArea;
};

const parseLoc = (loc?: string): { lat: number; lon: number } | null => {
  if (!loc) return null;
  const [lonStr, latStr] = loc.split(",");
  if (!lonStr || !latStr) return null;
  const lat = Number(latStr);
  const lon = Number(lonStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
};

const formatNumber = (n: number | undefined, lang: "bg" | "en"): string => {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(lang === "bg" ? "bg-BG" : "en-GB");
};

export const MyAreaHero: FC<Props> = ({ area }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { findMunicipality } = useMunicipalities();
  const { findRegion } = useRegions();

  // Only fetch ГРАО for settlements. The slice is keyed by obshtina, so
  // one settlement page fetches exactly one ~1 KB JSON.
  const obshtinaForGrao =
    area.kind === "settlement" ? area.obshtina : undefined;
  const { data: graoSlice } = useGraoMunicipalitySlice(obshtinaForGrao);

  if (area.kind === "unknown") {
    return null;
  }

  const isSettlement = area.kind === "settlement";
  const name = isSettlement
    ? lang === "bg"
      ? area.settlement.name
      : area.settlement.name_en
    : lang === "bg"
      ? area.municipality.name
      : area.municipality.name_en;
  const settlementType = isSettlement ? area.settlement.t_v_m : null;

  const muni = isSettlement ? findMunicipality(area.obshtina) : null;
  const region = findRegion(area.oblast);

  const muniName = muni ? (lang === "bg" ? muni.name : muni.name_en) : null;
  const regionNameRaw = region
    ? lang === "bg"
      ? region.long_name || region.name
      : region.long_name_en || region.name_en
    : null;
  // Some region names already carry the "област" / "region" suffix in the
  // source (notably SFO = "София област" / "Sofia region"). The narrative
  // template prepends "област " / appends " oblast", so without stripping
  // we'd produce "област София област" / "Sofia region oblast". Drop the
  // tautological suffix before prefixing.
  const regionName = regionNameRaw
    ? lang === "bg"
      ? regionNameRaw.replace(/\s+област$/u, "").trim()
      : regionNameRaw.replace(/\s+region$/iu, "").trim()
    : null;

  const loc = isSettlement ? parseLoc(area.settlement.loc) : null;

  // Per-settlement ГРАО — both current-address and permanent-address
  // headcounts plus the source date. Surfaced here so users see the
  // population without scrolling to CensusDemographicsTile.
  const graoRow =
    isSettlement && graoSlice
      ? graoSlice.settlements[area.settlement.ekatte]
      : undefined;
  const graoAsOf = isSettlement ? (graoSlice?.asOf ?? null) : null;

  // muniHref / regionHref drive the inline links in the narrative —
  // /settlement/:id accepts an obshtina code (despite the route name),
  // /municipality/:id accepts an oblast code. See SectionsScreen.tsx
  // for the canonical example of these breadcrumbs.
  const muniHref = isSettlement ? `/settlement/${area.obshtina}` : null;
  const regionHref = `/municipality/${area.oblast}`;

  // Composed narrative as JSX so município and oblast are links. The
  // typed strings below preserve the locative grammar — "в община",
  // "област ", " municipality", " oblast" — for non-link literals.
  const renderNarrative = () => {
    if (!isSettlement) {
      // Município view: "Община {name}, област {region-link}".
      if (lang === "bg") {
        return (
          <>
            Община {name}
            {regionName ? (
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
          {regionName ? (
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
    // Settlement view:
    //   BG: "{type} {name} в община {muni-link}, област {region-link}"
    //   EN: "{name} in {muni-link} municipality, {region-link} oblast"
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
          {regionName ? (
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
        {regionName ? (
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

  return (
    <Card className="p-4 md:p-5">
      <div className="flex flex-col md:flex-row items-start md:items-center gap-3 md:gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
            {t("my_area_dashboard")}
          </div>
          <h1 className="text-2xl md:text-3xl font-bold truncate">
            {isSettlement && settlementType && lang === "bg"
              ? `${settlementType} ${name}`
              : name}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {renderNarrative()}
          </p>
          {/* ГРАО registered-population block. Two-row table on the same
              line so it doesn't push the hero too tall on mobile. */}
          {graoRow ? (
            <div className="mt-3 text-sm">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                {graoAsOf
                  ? t("grao_tile_heading", { date: graoAsOf })
                  : t("grao_population_label")}
              </div>
              <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-6">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs text-muted-foreground">
                    {t("grao_current_address")}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatNumber(graoRow.current, lang)}
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-xs text-muted-foreground">
                    {t("grao_permanent_address")}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatNumber(graoRow.permanent, lang)}
                  </span>
                </div>
              </div>
            </div>
          ) : null}
        </div>
        {loc ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums shrink-0">
            <MapPin className="size-4 text-primary" />
            {loc.lat.toFixed(3)}°N, {loc.lon.toFixed(3)}°E
          </div>
        ) : null}
      </div>
    </Card>
  );
};
