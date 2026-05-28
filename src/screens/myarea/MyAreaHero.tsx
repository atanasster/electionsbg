// Hero strip at the top of the My-Area dashboard. Auto-generates a
// narrative line from settlement type + parent municipality + ГРАО
// population, plus the centroid lat/lon so the user gets an immediate
// sense of "where".
//
// The narrative is templated, not LLM-generated — same shape across all
// 5,300 settlements and zero hallucination risk. Settlements get the full
// "{type} {name} в община {muni}, област {oblast}" treatment; municipalities
// get a shorter "Община {muni}, област {oblast}".

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import { Card } from "@/components/ui/card";
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

const formatNumber = (n: number | undefined): string => {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("bg-BG").format(n);
};

export const MyAreaHero: FC<Props> = ({ area }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { findMunicipality } = useMunicipalities();
  const { findRegion } = useRegions();

  // Only fetch ГРАО for settlements — municipality-grain population already
  // lives in CensusDemographicsTile (a tile that's mounted further down the
  // page). The slice is keyed by obshtina, so a settlement page fetches
  // exactly one ~1 KB JSON.
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
  const regionName = region
    ? lang === "bg"
      ? region.long_name || region.name
      : region.long_name_en || region.name_en
    : null;

  const loc = isSettlement ? parseLoc(area.settlement.loc) : null;
  const headcount =
    isSettlement && graoSlice
      ? graoSlice.settlements[area.settlement.ekatte]?.permanent
      : undefined;

  // Composed narrative. Bulgarian needs the locative-preposition helper
  // ("в община ..." vs "във община ..." — actually "в община" always, but
  // the muni name itself may start with в/ф so use the helper for the
  // parent locative phrasing). English uses plain "in {muni}, {region}".
  const narrative = (() => {
    if (!isSettlement) {
      // Municipality: "Община {name}, област {region}"
      if (lang === "bg") {
        return regionName
          ? `Община ${name}, област ${regionName}`
          : `Община ${name}`;
      }
      return regionName
        ? `${name} municipality, ${regionName} oblast`
        : `${name} municipality`;
    }
    // Settlement: "{type} {name} в община {muni}, област {region}"
    if (lang === "bg") {
      const muniPhrase = muniName ? `в община ${muniName}` : "";
      const regionPhrase = regionName ? `, област ${regionName}` : "";
      const typed = settlementType ? `${settlementType} ${name}` : name;
      return `${typed} ${muniPhrase}${regionPhrase}`.trim();
    }
    const muniPhrase = muniName ? ` in ${muniName} municipality` : "";
    const regionPhrase = regionName ? `, ${regionName} oblast` : "";
    return `${name}${muniPhrase}${regionPhrase}`;
  })();

  return (
    <Card className="p-4 md:p-5">
      <div className="flex flex-col md:flex-row items-start md:items-center gap-3 md:gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
            {t("my_area_dashboard")}
            {/* "Прави" reading: "Дашборд за моя район" in BG; the chip
                already says "Моят район" so the screen label is the
                dashboard noun. */}
          </div>
          <h1 className="text-2xl md:text-3xl font-bold truncate">
            {isSettlement && settlementType && lang === "bg"
              ? `${settlementType} ${name}`
              : name}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{narrative}</p>
          {headcount != null ? (
            <p className="text-sm mt-2">
              <span className="text-muted-foreground">
                {t("grao_population_label")}:
              </span>{" "}
              <span className="font-semibold tabular-nums">
                {formatNumber(headcount)}
              </span>
            </p>
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
