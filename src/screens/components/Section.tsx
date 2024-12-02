import { FC } from "react";
import { Caption } from "@/ux/Caption";
import { SectionInfo } from "@/data/dataTypes";
import { SectionVotes } from "./SectionVotes";
import { ProtocolSummary } from "./ProtocolSummary";
import { useTranslation } from "react-i18next";

export const Section: FC<{ section: SectionInfo }> = ({ section }) => {
  const { t } = useTranslation();
  return (
    <div className={`w-full py-10 px-4 md:px-8`}>
      <div>
        <Caption>{`${t("section")} ${section.section}`}</Caption>
        <Caption className="mb-4">{`${section.settlement}${section.address ? `-${section.address}` : ""}`}</Caption>
        <ProtocolSummary protocol={section.protocol} votes={section.votes} />
        {section.protocol && (
          <SectionVotes protocol={section.protocol} votes={section.votes} />
        )}
      </div>
    </div>
  );
};
