import { useSearchParams } from "react-router-dom";
import { useSettlementsInfo } from "@/data/SettlementsContext";
import { Title } from "@/ux/Title";
import { SectionVotes } from "./components/SectionVotes";
import { useSectionsInfo } from "@/data/SectionsContext";

export const SectionsScreen = () => {
  const [searchParams] = useSearchParams();
  const { findSections } = useSectionsInfo();
  const { findSettlement } = useSettlementsInfo();

  const regionCode = searchParams.get("region");
  const muniCode = searchParams.get("municipality");
  const settlementCode = searchParams.get("settlement");
  if (!regionCode || !muniCode || !settlementCode) {
    return null;
  }
  const info = findSettlement(settlementCode);
  if (!info) {
    return null;
  }
  const sections = findSections(regionCode, muniCode, info.ekatte);

  return (
    <div className={`w-full py-10 px-4 md:px-8`}>
      {sections.map((section) => {
        return (
          <div key={section.section}>
            <Title>{`${section.settlement}-${section.address}`}</Title>
            <Title>{`${section.section}`}</Title>
            <SectionVotes section={section.section} />
          </div>
        );
      })}
    </div>
  );
};
