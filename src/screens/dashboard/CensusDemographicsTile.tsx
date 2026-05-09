import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { Link } from "@/ux/Link";
import {
  useCensus,
  useCensusOblast,
  useCensusMunicipality,
  useCensusSettlement,
  useCensusSettlements,
} from "@/data/census/useCensus";
import type { CensusEntity } from "@/data/census/censusTypes";
import { CountryBreakdown } from "@/screens/components/demographics/CountryBreakdown";
import { StatCard } from "./StatCard";

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
  const { data: census } = useCensus();
  const findOblast = useCensusOblast();
  const findMuni = useCensusMunicipality();
  const findSettlement = useCensusSettlement();
  // Trigger lazy load of the settlement sidecar only when this tile is being
  // used at settlement granularity.
  useCensusSettlements(Boolean(isSettlement));

  if (!census || !regionCode) return null;
  // Settlement entities use `ekatte` instead of `code` and only carry the
  // population/age/sex dimensions, so they need a thin adapter to satisfy
  // CensusEntity (the shape CountryBreakdown expects).
  const settlementEntity = isSettlement ? findSettlement(regionCode) : undefined;
  const otherEntity = isSettlement
    ? undefined
    : isMunicipality
      ? findMuni(regionCode)
      : findOblast(regionCode);
  const entity: CensusEntity | undefined = settlementEntity
    ? {
        code: settlementEntity.ekatte,
        nameBg: settlementEntity.nameBg,
        nameEn: settlementEntity.nameEn,
        population: settlementEntity.population,
        age: settlementEntity.age,
        gender: settlementEntity.gender,
      }
    : otherEntity;
  if (!entity) return null;

  const lang = i18n.language;
  const popLabel = entity.population.toLocaleString(
    lang === "bg" ? "bg-BG" : "en-GB",
  );

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            <span>{t("census_tile_heading")}</span>
          </div>
          <Link
            to="/demographics"
            className="text-[10px] normal-case text-primary hover:underline"
            underline={false}
          >
            {t("dashboard_see_details")} →
          </Link>
        </div>
      }
      hint={t("census_tile_hint", { date: census.censusDate })}
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
