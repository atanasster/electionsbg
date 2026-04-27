import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useRegions } from "@/data/regions/useRegions";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useMunicipalityVotes } from "@/data/municipalities/useMunicipalityVotes";
import { SEO } from "@/ux/SEO";
import { H1 } from "@/ux/H1";
import { Link } from "@/ux/Link";
import { MunicipalityDashboardCards } from "./dashboard/MunicipalityDashboardCards";

export const SettlementsScreen = () => {
  const { id: muniCode } = useParams();
  const { findRegion } = useRegions();
  const { findMunicipality } = useMunicipalities();
  const { municipality } = useMunicipalityVotes(muniCode);
  const { i18n, t } = useTranslation();
  if (!muniCode) {
    return null;
  }
  const info = findMunicipality(muniCode);
  const region = findRegion(municipality?.oblast ?? info?.oblast);
  const muniName = info
    ? i18n.language === "bg"
      ? info?.name
      : info?.name_en
    : muniCode;
  const regionName = region
    ? i18n.language === "bg"
      ? region.long_name || region.name
      : region.long_name_en || region.name_en
    : "";
  const title = (
    <>
      {region ? (
        <Link to={`/municipality/${region.oblast}`}>{regionName}</Link>
      ) : null}
      {region ? " / " : null}
      {muniName}
    </>
  );
  const titleStr = region ? `${regionName} / ${muniName}` : muniName;
  return (
    <>
      <SEO
        title={`${t("municipalities")} ${muniName}`}
        description={titleStr}
      />
      <H1>{title}</H1>
      <MunicipalityDashboardCards municipalityCode={muniCode} />
    </>
  );
};
