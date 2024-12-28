import { FC } from "react";
import { Caption } from "@/ux/Caption";
import { SectionInfo, Votes } from "@/data/dataTypes";
import { ProtocolSummary } from "./ProtocolSummary";
import { useTranslation } from "react-i18next";
import { PartyVotesTable } from "./PartyVotesTable";
import { useSectionStats } from "@/data/sections/useSectionStats";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { DataViewContainer } from "@/layout/dataview/DataViewContainer";
import { MultiHistoryChart } from "./charts/MultiHistoryChart";

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
  const title = `${t("section")} ${section.section}`;
  return (
    <div className={`w-full`}>
      <div>
        <Caption>{title}</Caption>
        <Caption className="mb-4">{`${section.settlement}${section.address ? `-${section.address}` : ""}`}</Caption>
        <ProtocolSummary
          protocol={section.results.protocol}
          votes={section.results.votes}
        />
        <DataViewContainer
          title={title}
          excluded={{
            exclude: "map",
            replace: "table",
          }}
        >
          {(view) => {
            if ((view === "map" || view === "table") && votes)
              return (
                <PartyVotesTable
                  title={title}
                  results={{ protocol: section.results.protocol, votes }}
                  stats={stats}
                  prevElection={prevVotes}
                />
              );
            if (view === "chart" && stats)
              return <MultiHistoryChart stats={stats} />;
          }}
        </DataViewContainer>
      </div>
    </div>
  );
};
