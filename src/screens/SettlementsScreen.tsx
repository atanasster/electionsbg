import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMunicipalityVotes } from "@/data/municipalities/useMunicipalityVotes";
import { ProtocolSummary } from "./components/protocols/ProtocolSummary";
import { useRegions } from "@/data/regions/useRegions";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { SEO } from "@/ux/SEO";
import { H1 } from "@/ux/H1";
import { Link } from "@/ux/Link";
import { SettlementData } from "./components/settlements/SettlementData";
import { RecountCards } from "./components/protocols/RecountCards";

export const SettlementsScreen = () => {
  const { id: muniCode } = useParams();
  const { findRegion } = useRegions();
  const { municipality } = useMunicipalityVotes(muniCode);
  const { i18n, t } = useTranslation();
  const { findMunicipality } = useMunicipalities();
  const info = findMunicipality(muniCode);
  if (!muniCode) {
    return null;
  }
  const region = findRegion(municipality?.oblast);
  if (!region || !municipality) {
    return null;
  }
  const title = (
    <>
      <Link to={`/municipality/${region.oblast}`}>
        {i18n.language === "bg"
          ? region.long_name || region.name
          : region.long_name_en || region.name_en}
      </Link>
      {" / "}
      {i18n.language === "bg" ? info?.name : info?.name_en}
    </>
  );
  const titleStr = `${
    i18n.language === "bg"
      ? region.long_name || region.name
      : region.long_name_en || region.name_en
  } / ${i18n.language === "bg" ? info?.name : info?.name_en}`;
  return (
    <>
      <SEO
        title={`${t("municipalities")} ${info ? (i18n.language === "bg" ? info?.name : info?.name_en) : ""}`}
        description="Interactive map of a settlement in the elections in Bulgaria"
      />
      <H1>{title}</H1>

      <ProtocolSummary
        results={municipality?.results}
        original={municipality?.original}
      />
      <RecountCards
        results={municipality?.results}
        original={municipality?.original}
      />
      <SettlementData
        title={title}
        municipality={muniCode}
        titleStr={titleStr}
      />
    </>
  );
};
