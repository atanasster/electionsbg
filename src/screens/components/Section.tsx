import { FC } from "react";
import { Caption } from "@/ux/Caption";
import { SectionInfo } from "@/data/dataTypes";
import { ProtocolSummary } from "./ProtocolSummary";
import { useTranslation } from "react-i18next";
import { PartyVotesTable } from "./PartyVotesTable";
import { useSectionStats } from "@/data/useSectionStats";

export const Section: FC<{ section: SectionInfo }> = ({ section }) => {
  const { t } = useTranslation();
  const { prevVotes, stats } = useSectionStats(section.section);
  return (
    <div className={`w-full`}>
      <div>
        <Caption>{`${t("section")} ${section.section}`}</Caption>
        <Caption className="mb-4">{`${section.settlement}${section.address ? `-${section.address}` : ""}`}</Caption>
        <ProtocolSummary
          protocol={section.results.protocol}
          votes={section.results.votes}
        />
        {section.results.protocol && section.results.votes && (
          <PartyVotesTable
            votes={section.results.votes}
            stats={stats}
            prevElectionVotes={prevVotes?.results?.votes}
          />
        )}
      </div>
    </div>
  );
};
