import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useRegions } from "@/data/regions/useRegions";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useMunicipalityVotes } from "@/data/municipalities/useMunicipalityVotes";
import { isSofiaRayonObshtina } from "@/data/local/placeViews";
import { SEO } from "@/ux/SEO";
import { PlaceHeader } from "@/screens/components/PlaceHeader";
import { MunicipalityDashboardCards } from "./dashboard/MunicipalityDashboardCards";
import { SectionsScreen } from "./SectionsScreen";

export const SettlementsScreen = () => {
  const { id: muniCode } = useParams();
  const { findRegion } = useRegions();
  const { findMunicipality } = useMunicipalities();
  const { municipality } = useMunicipalityVotes(muniCode);
  const { i18n, t } = useTranslation();
  if (!muniCode) {
    return null;
  }
  // EKATTE codes start with a digit. Pure-numeric forms (e.g. "69599") are
  // the common case; Sofia район-as-settlement uses composites like
  // "68134-2401" (still starts with a digit). Obshtina codes always start
  // with a letter (e.g. TGV35, S2401), so a leading-digit test cleanly
  // separates the two without dropping the composite case. The plain
  // settlement URLs are prerendered + indexed by Google, so route both
  // shapes to the settlement view rather than breaking the page.
  if (/^\d/.test(muniCode)) {
    return <SectionsScreen />;
  }
  const info = findMunicipality(muniCode);
  const region = findRegion(municipality?.oblast ?? info?.oblast);
  // A Sofia район-as-município (S2xxx): label it "район", not "Община".
  const isRayon = isSofiaRayonObshtina(muniCode);
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
  const titleStr = region ? `${regionName} / ${muniName}` : muniName;
  const seoTitle = isRayon
    ? i18n.language === "bg"
      ? `район ${muniName}`
      : `${muniName} (${t("rayon")})`
    : `${t("municipalities")} ${muniName}`;
  return (
    <>
      <SEO title={seoTitle} description={titleStr} />
      <PlaceHeader
        active="parliamentary"
        level="municipality"
        obshtina={muniCode}
        oblast={municipality?.oblast ?? info?.oblast}
        fallbackName={muniName}
        className="my-4"
      />
      <MunicipalityDashboardCards municipalityCode={muniCode} />
    </>
  );
};
