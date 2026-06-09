import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { useSettlementVotes } from "@/data/settlements/useSettlementVotes";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useRegions } from "@/data/regions/useRegions";
import { typedSettlementName, isSofiaMir } from "@/data/dataTypes";
import { SEO } from "@/ux/SEO";
import { placeResultsTitle } from "@/ux/seoTitle";
import { PlaceHeader } from "@/screens/components/PlaceHeader";
import { SettlementDashboardCards } from "./dashboard/SettlementDashboardCards";

export const SectionsScreen = () => {
  const { id: ekatte } = useParams();
  const { findSettlement } = useSettlementsInfo();
  const { settlement } = useSettlementVotes(ekatte ?? "");
  const { findMunicipality } = useMunicipalities();
  const { findRegion } = useRegions();
  const { i18n } = useTranslation();
  if (!ekatte) return null;
  const lang = i18n.language === "bg" ? "bg" : "en";
  const info = findSettlement(ekatte);
  const municipality = findMunicipality(settlement?.obshtina ?? info?.obshtina);
  const region = findRegion(settlement?.oblast ?? info?.oblast);
  const settlementName = info
    ? lang === "bg"
      ? info.name
      : info.name_en
    : ekatte;
  const regionName = region
    ? lang === "bg"
      ? region.long_name || region.name
      : region.long_name_en || region.name_en
    : "";
  const municipalityName = municipality
    ? lang === "bg"
      ? municipality.name
      : municipality.name_en
    : "";
  const titleStr = [regionName, municipalityName, settlementName]
    .filter(Boolean)
    .join(" / ");
  // The /sections/:ekatte route is the settlement's parliamentary dashboard,
  // not a list of polling stations — title it by the typed place name
  // ("кв. Лозенец") to match the page <h1>, not "Секции {name}".
  const typed = typedSettlementName(info, lang, settlementName);
  // Rich document <title> matching the prerendered crawler HTML:
  // "Резултати в кв. Лозенец, обл. София — …". The oblast carries an "обл."
  // prefix only for real области — a Sofia МИР or the abroad district reads as
  // its own context ("София 23 МИР", "Извън страната").
  const oblastCode = settlement?.oblast ?? info?.oblast;
  const oblastContext = regionName
    ? oblastCode === "32" || isSofiaMir(oblastCode)
      ? `, ${regionName}`
      : lang === "bg"
        ? `, обл. ${regionName}`
        : `, ${regionName}`
    : "";
  return (
    <>
      <SEO
        title={typed}
        fullTitle={placeResultsTitle(`${typed}${oblastContext}`, lang)}
        description={titleStr}
      />
      <PlaceHeader
        active="parliamentary"
        level="settlement"
        ekatte={ekatte}
        obshtina={settlement?.obshtina ?? info?.obshtina}
        oblast={settlement?.oblast ?? info?.oblast}
        fallbackName={settlementName}
        className="my-4"
      />
      <SettlementDashboardCards ekatte={ekatte} />
    </>
  );
};
