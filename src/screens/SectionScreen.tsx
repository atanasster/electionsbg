import { useSearchParams } from "react-router-dom";
import { useSectionsInfo } from "@/data/useSectionsInfo";
import { Section } from "./components/Section";
import { Title } from "@/ux/Title";
import { useSettlementsInfo } from "@/data/useSettlements";
import { useTranslation } from "react-i18next";
import { useMunicipalities } from "@/data/useMunicipalities";
import { useRegions } from "@/data/useRegions";

export const SectionScreen = () => {
  const [searchParams] = useSearchParams();
  const { i18n } = useTranslation();
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
      <Title description="">
        {`${
          i18n.language === "bg"
            ? region?.long_name || region?.name
            : region?.long_name_en || region?.name_en || ""
        }/${
          i18n.language === "bg"
            ? municipality?.long_name || municipality?.name
            : municipality?.long_name_en || municipality?.name_en || ""
        }/${
          i18n.language === "bg"
            ? settlement?.long_name || settlement?.name
            : settlement?.long_name_en || settlement?.name_en || ""
        }`}
      </Title>
      <Section section={section} />
    </div>
  );
};
