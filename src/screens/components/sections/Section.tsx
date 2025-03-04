import { FC } from "react";
import { Caption } from "@/ux/Caption";
import { SectionInfo, Votes } from "@/data/dataTypes";
import { ProtocolSummary } from "../protocols/ProtocolSummary";
import { useTranslation } from "react-i18next";
import { PartyVotesTable } from "../PartyVotesTable";
import { useSectionStats } from "@/data/sections/useSectionStats";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import {
  DataViewContainer,
  DataViewType,
} from "@/layout/dataview/DataViewContainer";
import { MultiHistoryChart } from "../charts/MultiHistoryChart";
import { PreferencesBySection } from "../preferences/PreferencesBySection";
import { PartyRecountTable } from "../PartyRecountTable";

export const Section: FC<{ section: SectionInfo }> = ({ section }) => {
  const { t } = useTranslation();
  const { prevVotes, stats } = useSectionStats(section.section);
  const { parties } = usePartyInfo();
  const votes: (Votes & { original?: Votes })[] | undefined = parties?.map(
    (p) => {
      const v = section.results.votes.find((v) => v.partyNum === p.number);
      if (v) {
        const original = section.original?.votes.find(
          (o) => o.partyNum === v.partyNum,
        );
        return { ...v, original };
      } else
        return {
          partyNum: p.number,
          totalVotes: 0,
          machineVotes: 0,
          paperVotes: 0,
        };
    },
  );
  const title = `${t("section")} ${section.section}`;
  const exclude: DataViewType[] = ["map", "table"];

  return (
    <div className={`w-full`}>
      <div>
        <Caption>{title}</Caption>
        <Caption className="mb-4">{`${section.settlement}${section.address ? `-${section.address}` : ""}`}</Caption>
        <ProtocolSummary
          results={section.results}
          original={section.original}
        />

        <DataViewContainer
          title={title}
          excluded={{
            exclude,
            replace: "parties",
          }}
        >
          {(view) => {
            if ((view === "map" || view === "parties") && votes)
              return (
                <PartyVotesTable
                  title={title}
                  results={{
                    protocol: section.results.protocol,
                    votes: votes,
                  }}
                  stats={stats}
                  prevElection={prevVotes}
                />
              );
            if (view === "recount" && votes)
              return (
                <PartyRecountTable
                  title={title}
                  votes={{ results: { votes } }}
                />
              );
            if (view === "chart" && stats)
              return <MultiHistoryChart stats={stats} />;
            if (view === "pref.")
              return (
                <PreferencesBySection
                  section={section.section}
                  region={section.oblast}
                />
              );
          }}
        </DataViewContainer>
      </div>
    </div>
  );
};
