import { useSearchParams } from "react-router-dom";
import { Caption } from "@/ux/Caption";
import { SectionVotes } from "./components/SectionVotes";
import { useSectionsInfo } from "@/data/SectionsContext";
import { useTranslation } from "react-i18next";
import { ProtocolSummary } from "./components/ProtocolSummary";

export const SectionScreen = () => {
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const { findSection } = useSectionsInfo();
  const sectionCode = searchParams.get("section");
  if (!sectionCode) {
    return null;
  }

  const section = findSection(sectionCode);
  if (!section) {
    return null;
  }
  return (
    <div className={`w-full py-10 px-4 md:px-8`}>
      <div key={section.section}>
        <Caption>{`${t("section")} ${section.section}`}</Caption>
        <Caption className="mb-4">{`${section.settlement}-${section.address}`}</Caption>
        {section.protocol && (
          <ProtocolSummary protocol={section.protocol} votes={section.votes} />
        )}
        {section.protocol && (
          <SectionVotes protocol={section.protocol} votes={section.votes} />
        )}
      </div>
    </div>
  );
};
