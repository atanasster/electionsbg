import { useSearchParams } from "react-router-dom";
import { useSectionsInfo } from "@/data/useSectionsInfo";
import { Section } from "./components/Section";
import { useSettlementsInfo } from "@/data/useSettlements";
import { useTranslation } from "react-i18next";
import { useMunicipalities } from "@/data/useMunicipalities";
import { useRegions } from "@/data/useRegions";
import { SEO } from "@/ux/SEO";
import { H1 } from "@/ux/H1";
import { Link } from "@/ux/Link";

export const SectionScreen = () => {
  const [searchParams] = useSearchParams();
  const { t, i18n } = useTranslation();
  const { findSection } = useSectionsInfo();
  const { findSettlement } = useSettlementsInfo();
  const { findMunicipality } = useMunicipalities();
  const { findRegion } = useRegions();
  const sectionCode = searchParams.get("section");
  if (!sectionCode) {
    return null;
  }

  const section = findSection(sectionCode);

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
            <Link
              to={{
                pathname: "/municipality",
                search: {
                  region: region?.oblast,
                },
              }}
            >
              {i18n.language === "bg"
                ? region?.long_name || region?.name
                : region?.long_name_en || region?.name_en}
            </Link>
            {" / "}
          </>
        )}
        {municipality?.obshtina && (
          <>
            <Link
              to={{
                pathname: "/settlement",
                search: {
                  municipality: municipality?.obshtina,
                },
              }}
            >
              {i18n.language === "bg"
                ? municipality?.name
                : municipality?.name_en}
            </Link>
            {" / "}
          </>
        )}
        {settlement && (
          <Link
            to={{
              pathname: "/sections",
              search: {
                settlement: settlement?.ekatte,
              },
            }}
          >
            {i18n.language === "bg" ? settlement?.name : settlement?.name_en}
          </Link>
        )}
      </H1>
      <Section section={section} />
    </div>
  );
};
