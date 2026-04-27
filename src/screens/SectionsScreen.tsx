import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { useSettlementVotes } from "@/data/settlements/useSettlementVotes";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useRegions } from "@/data/regions/useRegions";
import { SEO } from "@/ux/SEO";
import { H1 } from "@/ux/H1";
import { Link } from "@/ux/Link";
import { SettlementDashboardCards } from "./dashboard/SettlementDashboardCards";

export const SectionsScreen = () => {
  const { id: ekatte } = useParams();
  const { findSettlement } = useSettlementsInfo();
  const { settlement } = useSettlementVotes(ekatte ?? "");
  const { findMunicipality } = useMunicipalities();
  const { findRegion } = useRegions();
  const { i18n, t } = useTranslation();
  if (!ekatte) return null;
  const info = findSettlement(ekatte);
  const municipality = findMunicipality(settlement?.obshtina ?? info?.obshtina);
  const region = findRegion(settlement?.oblast ?? info?.oblast);
  const settlementName = info
    ? i18n.language === "bg"
      ? info.name
      : info.name_en
    : ekatte;
  const regionName = region
    ? i18n.language === "bg"
      ? region.long_name || region.name
      : region.long_name_en || region.name_en
    : "";
  const municipalityName = municipality
    ? i18n.language === "bg"
      ? municipality.name
      : municipality.name_en
    : "";
  const title = (
    <>
      {region ? (
        <Link to={`/municipality/${region.oblast}`}>{regionName}</Link>
      ) : null}
      {region && municipality ? " / " : null}
      {municipality ? (
        <Link to={`/settlement/${municipality.obshtina}`}>
          {municipalityName}
        </Link>
      ) : null}
      {region || municipality ? " / " : null}
      {settlementName}
    </>
  );
  const titleStr = [regionName, municipalityName, settlementName]
    .filter(Boolean)
    .join(" / ");
  return (
    <>
      <SEO
        title={`${t("sections")} ${settlementName}`}
        description={titleStr}
      />
      <H1>{title}</H1>
      <SettlementDashboardCards ekatte={ekatte} />
    </>
  );
};
