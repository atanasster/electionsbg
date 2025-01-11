import { useParams } from "react-router-dom";
import { useSectionsVotes } from "@/data/sections/useSectionsVotes";
import { Section } from "./components/sections/Section";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { useTranslation } from "react-i18next";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useRegions } from "@/data/regions/useRegions";
import { SEO } from "@/ux/SEO";
import { H1 } from "@/ux/H1";
import { Link } from "@/ux/Link";

export const SectionScreen = () => {
  const { id: sectionCode } = useParams();
  const { t, i18n } = useTranslation();
  const section = useSectionsVotes(sectionCode);
  const { findSettlement } = useSettlementsInfo();
  const { findMunicipality } = useMunicipalities();
  const { findRegion } = useRegions();

  if (!section) {
    return null;
  }

  const settlement = findSettlement(section.ekatte);
  const region = findRegion(section.oblast);
  const municipality = findMunicipality(section.obshtina);

  return (
    <div className={`w-full py-10 px-4 md:px-8`}>
      <SEO
        title={`${t("section")} ${settlement ? (i18n.language === "bg" ? settlement?.name : settlement?.name_en) : ""}`}
        description="Bulgaria election results in a set of polling stations"
      />
      <H1>
        {t("section")}{" "}
        {region?.oblast && (
          <>
            <Link to={`/municipality/${region.oblast}`}>
              {i18n.language === "bg"
                ? region?.long_name || region?.name
                : region?.long_name_en || region?.name_en}
            </Link>
            {" / "}
          </>
        )}
        {municipality?.obshtina && (
          <>
            <Link to={`/settlement/${municipality.obshtina}`}>
              {i18n.language === "bg"
                ? municipality?.name
                : municipality?.name_en}
            </Link>
            {" / "}
          </>
        )}
        {settlement && (
          <Link to={`/sections/${settlement.ekatte}`}>
            {i18n.language === "bg" ? settlement?.name : settlement?.name_en}
          </Link>
        )}
      </H1>
      <Section section={section} />
    </div>
  );
};
