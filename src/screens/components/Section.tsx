import { FC } from "react";
import { Caption } from "@/ux/Caption";
import { SectionInfo, Votes } from "@/data/dataTypes";
import { ProtocolSummary } from "./ProtocolSummary";
import { useTranslation } from "react-i18next";
import { PartyVotesTable } from "./PartyVotesTable";
import { useSectionStats } from "@/data/useSectionStats";
import { usePartyInfo } from "@/data/usePartyInfo";

export const Section: FC<{ section: SectionInfo }> = ({ section }) => {
  const { t } = useTranslation();
  const { prevVotes, stats } = useSectionStats(section.section);
  const { parties } = usePartyInfo();
  const votes = parties?.map((p) => {
    const v = section.results.votes.find((v) => v.partyNum === p.number);
    if (v) {
      return v;
    } else
      return {
        partyNum: p.number,
        totalVotes: 0,
        machineVotes: 0,
        paperVotes: 0,
      } as Votes;
  });
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
            votes={votes}
            stats={stats}
            prevElectionVotes={prevVotes?.results?.votes}
          />
        )}
      </div>
    </div>
  );
};
