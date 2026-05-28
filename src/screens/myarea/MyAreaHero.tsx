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

  // Compact, single-row hero. The previous version had a three-line
  // structure (eyebrow + H1 + narrative + a separate ГРАО block + a
  // lat/lon column) that ate ~30% of the visible viewport on first
  // paint. We now:
  //   - drop the "МОЯТ РАЙОН" eyebrow (H1 + breadcrumb already say it)
  //   - drop the lat/lon column (developer info, not citizen info)
  //   - inline the breadcrumb narrative directly under the H1
  //   - render ГРАО as a single chip row beside the narrative on wide
  //     screens, wrapping below on mobile
  return (
    <Card className="p-4 md:p-5">
      <div className="flex items-start gap-3">
        <MapPin className="size-5 text-primary mt-1 shrink-0" />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl md:text-3xl font-bold truncate">
            {isSettlement && settlementType && lang === "bg"
              ? `${settlementType} ${name}`
              : name}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {renderNarrative()}
          </p>
          {graoRow ? (
            <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {graoAsOf
                  ? t("grao_tile_heading", { date: graoAsOf })
                  : t("grao_population_label")}
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-muted-foreground">
                  {t("grao_current_address")}
                </span>
                <span className="font-semibold tabular-nums">
                  {formatNumber(graoRow.current, lang)}
                </span>
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-muted-foreground">
                  {t("grao_permanent_address")}
                </span>
                <span className="font-semibold tabular-nums">
                  {formatNumber(graoRow.permanent, lang)}
                </span>
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
};
