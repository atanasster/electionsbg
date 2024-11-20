import { useSearchParams } from "react-router-dom";
import { useSettlementsInfo } from "@/data/SettlementsContext";
import { Caption } from "@/ux/Caption";
import { SectionVotes } from "./components/SectionVotes";
import { useSectionsInfo } from "@/data/SectionsContext";
import { useTranslation } from "react-i18next";
import { ProtocolSummary } from "./components/ProtocolSummary";

export const SectionsScreen = () => {
  const [searchParams] = useSearchParams();
  const { findSections, findSection } = useSectionsInfo();
  const { findSettlement } = useSettlementsInfo();
  const { t } = useTranslation();
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
        const votes = findSection(section.section);
        if (!votes) {
          return null;
        }

        return (
          <div key={section.section}>
            <Caption>{`${t("section")} ${section.section}`}</Caption>
            <Caption className="mb-4">{`${section.settlement}-${section.address}`}</Caption>
            {section.protocol && (
              <ProtocolSummary
                protocol={section.protocol}
                votes={votes.votes}
              />
            )}
            {section.protocol && (
              <SectionVotes protocol={section.protocol} votes={votes.votes} />
            )}
          </div>
        );
      })}
    </div>
  );
};
