import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useRegions } from "@/data/regions/useRegions";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useMunicipalityVotes } from "@/data/municipalities/useMunicipalityVotes";
import { isSofiaRayonObshtina } from "@/data/local/placeViews";
import { SEO } from "@/ux/SEO";
import { placeResultsTitle } from "@/ux/seoTitle";
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
  const lang = i18n.language === "bg" ? "bg" : "en";
  const info = findMunicipality(muniCode);
  const region = findRegion(municipality?.oblast ?? info?.oblast);
  // A Sofia район-as-município (S2xxx): label it "район", not "община".
  const isRayon = isSofiaRayonObshtina(muniCode);
  // Abroad (МИР 32): the "municipality" is a continent bucket — label it
  // "Континент {name}", not "Община {name}".
  const isAbroad = (municipality?.oblast ?? info?.oblast) === "32";
  const muniName = info
    ? lang === "bg"
      ? info?.name
      : info?.name_en
    : muniCode;
  const regionName = region
    ? lang === "bg"
      ? region.long_name || region.name
      : region.long_name_en || region.name_en
    : "";
  const titleStr = region ? `${regionName} / ${muniName}` : muniName;
  // The /settlement/:id route is actually a MUNICIPALITY (община) dashboard —
  // the historical "off-by-one" route naming (see placeViews.ts). Title it with
  // the real tier ("Община {name}", or "Район {name}" for a Sofia район) so the
  // browser tab reads as one place, not the old plural "Общини {name}" that
  // looked like a list of municipalities.
  const typeKey = isAbroad ? "continent" : isRayon ? "rayon" : "municipality";
  const seoTitle =
    lang === "bg" ? `${t(typeKey)} ${muniName}` : `${muniName} (${t(typeKey)})`;
  // Rich document <title> matching the prerendered crawler HTML — same place
  // label, lower-cased tier word in the language's natural position.
  const tierLower = t(typeKey).toLowerCase();
  const placeLabel =
    lang === "bg" ? `${tierLower} ${muniName}` : `${muniName} ${tierLower}`;
  return (
    <>
      <SEO
        title={seoTitle}
        fullTitle={placeResultsTitle(placeLabel, lang)}
        description={titleStr}
      />
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
