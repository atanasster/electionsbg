import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { Link } from "@/ux/Link";
import {
  useCensusOblastSlice,
  useCensusMunicipalitySlice,
  useCensusSettlement,
} from "@/data/census/useCensus";
import type { CensusEntity } from "@/data/census/censusTypes";
import { CountryBreakdown } from "@/screens/components/demographics/CountryBreakdown";
import { StatCard } from "./StatCard";

// 7 September 2021 — NSI reference date for Census 2021. Used as a static
// hint in the tile heading so we don't need to fetch the full census payload
// just to read its `censusDate` field.
const CENSUS_REFERENCE_DATE = "2021-09-07";

type Props = {
  /** Oblast 3-letter code, municipality 5-char code, or settlement EKATTE. */
  regionCode?: string;
  /** When `regionCode` is a municipality (obshtina) code rather than an
   * oblast, set this so the hook resolves the correct entity. */
  isMunicipality?: boolean;
  /** When `regionCode` is a settlement EKATTE, set this so the tile lazy-
   * loads the settlement sidecar. Settlement-level census data is sparser
   * (population + age + sex only — NSI doesn't publish ethnicity, religion
   * or education at this granularity). */
  isSettlement?: boolean;
};

export const CensusDemographicsTile: FC<Props> = ({
  regionCode,
  isMunicipality,
  isSettlement,
}) => {
  const { t, i18n } = useTranslation();
  // Per-entity slices: ~1KB each, fetched only for the page we're on. The
  // hooks no-op (enabled: false) when their key doesn't apply to this tile.
  const { data: oblastEntity } = useCensusOblastSlice(
    !isMunicipality && !isSettlement ? regionCode : undefined,
  );
  const { data: muniEntity } = useCensusMunicipalitySlice(
    isMunicipality ? regionCode : undefined,
  );
  // Trigger lazy load of the settlement sidecar only when this tile is being
  // used at settlement granularity. Otherwise the 1.8MB sidecar would land
  // on every region/municipality page even though it's never read there.
  const findSettlement = useCensusSettlement(Boolean(isSettlement));

  if (!regionCode) return null;
  // Settlement entities use `ekatte` instead of `code` and only carry the
  // population/age/sex dimensions, so they need a thin adapter to satisfy
  // CensusEntity (the shape CountryBreakdown expects).
  const settlementEntity = isSettlement
    ? findSettlement(regionCode)
    : undefined;
  const entity: CensusEntity | undefined = settlementEntity
    ? {
        code: settlementEntity.ekatte,
        nameBg: settlementEntity.nameBg,
        nameEn: settlementEntity.nameEn,
        population: settlementEntity.population,
        age: settlementEntity.age,
        gender: settlementEntity.gender,
      }
    : isMunicipality
      ? muniEntity
      : oblastEntity;
  if (!entity) return null;

  const lang = i18n.language;
  const popLabel = entity.population.toLocaleString(
    lang === "bg" ? "bg-BG" : "en-GB",
  );
  // Settlement-level data isn't in either of the dedicated tables, so its
  // tile sends users to the country breakdown page instead.
  const seeAllHref = isSettlement
    ? "/demographics"
    : isMunicipality
      ? "/demographics/municipalities"
      : "/demographics/regions";

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            <span>{t("census_tile_heading")}</span>
          </div>
          <Link
            to={seeAllHref}
            className="text-[10px] normal-case text-primary hover:underline"
            underline={false}
          >
            {t("dashboard_see_details")} →
          </Link>
        </div>
      }
      hint={t("census_tile_hint", { date: CENSUS_REFERENCE_DATE })}
    >
      <div className="text-sm text-muted-foreground mb-2">
        {t("census_tile_population", {
          formatted: popLabel,
        })}
      </div>
      <CountryBreakdown entity={entity} compact={!isSettlement} />
      {isSettlement && (
        <p className="text-[11px] text-muted-foreground mt-2 italic">
          {t("census_settlement_dimensions_note")}
        </p>
      )}
    </StatCard>
  );
};
