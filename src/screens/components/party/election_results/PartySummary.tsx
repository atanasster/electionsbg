import { FC } from "react";
import { PartyInfo } from "@/data/dataTypes";
import {
  findPrevVotes,
  localDate,
  partyVotesPosition,
  pctChange,
  totalAllVotes,
} from "@/data/utils";

import { Flag, History, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HintedDataItem } from "@/ux/HintedDataItem";
import { useElectionContext } from "@/data/ElectionContext";
import { HistoryChart } from "../../charts/HistoryChart";
import { ProtocolCard } from "@/ux/ProtocolCard";
import { AccordionSummary } from "@/ux/AccordionSummary";

export const PartySummary: FC<{
  party: PartyInfo;
}> = ({ party }) => {
  const { t } = useTranslation();
  const { electionStats, priorElections, prevElections, stats } =
    useElectionContext();

  const votes = electionStats?.results?.votes.find(
    (v) => v.number === party.number,
  );
  const totalVotes = totalAllVotes(electionStats?.results?.votes);
  const pos = partyVotesPosition(party.number, electionStats?.results?.votes);

  const lyVotes = findPrevVotes(party, priorElections?.results?.votes, true);
  const lyTotalVotes = totalAllVotes(priorElections?.results?.votes);
  const lyPos = lyVotes.partyNum
    ? partyVotesPosition(lyVotes.partyNum, priorElections?.results?.votes)
    : undefined;
  const lyly = prevElections(priorElections?.name);
  const lylyVotes = findPrevVotes(party, lyly?.results?.votes, true);
  const lylyPos = lylyVotes.partyNum
    ? partyVotesPosition(lylyVotes.partyNum, lyly?.results?.votes)
    : undefined;
  return (
    <AccordionSummary>
      <div className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-3 my-4`}>
        <ProtocolCard icon={<Users />} title={t("voters")}>
          <HintedDataItem
            value={votes?.totalVotes}
            decimals={0}
            pctChange={100 * ((votes?.totalVotes || 0) / (totalVotes || 1))}
            pctStyle="plain"
            pct2={pctChange(votes?.totalVotes, lyVotes?.prevTotalVotes)}
            size="xl"
            pctSuffix=""
            valueExplainer={t("total_party_votes_explainer")}
            pctExplainer={t("pct_party_votes_explainer")}
            pct2Explainer={t("pct_prev_election_votes_explainer")}
          />
          <HintedDataItem
            value={pos?.position}
            decimals={0}
            pctSuffix=""
            pctChange={
              pos?.position
                ? (lyPos?.position || pos.position) - pos.position
                : undefined
            }
            valueLabel={t("position")}
            valueExplainer={t("position_explainer")}
            pctExplainer={t("position_change_explainer")}
          />
          <HintedDataItem
            value={votes?.paperVotes}
            decimals={0}
            pctChange={pctChange(votes?.paperVotes, lyVotes?.prevPaperVotes)}
            valueLabel={t("paper_votes")}
            valueExplainer={t("paper_votes_explainer")}
            pctExplainer={t("paper_votes_change_explainer")}
          />
          <HintedDataItem
            value={votes?.machineVotes}
            decimals={0}
            pctChange={pctChange(
              votes?.machineVotes,
              lyVotes?.prevMachineVotes,
            )}
            valueLabel={t("machine_votes")}
            valueExplainer={t("machine_votes_explainer")}
            pctExplainer={t("machine_votes_change_explainer")}
          />
        </ProtocolCard>
        {lyVotes?.prevTotalVotes && (
          <ProtocolCard
            icon={<History />}
            title={
              priorElections?.name
                ? localDate(priorElections?.name)
                : t("prior_elections")
            }
          >
            <HintedDataItem
              value={lyVotes?.prevTotalVotes}
              decimals={0}
              pctChange={
                100 * ((lyVotes?.prevTotalVotes || 0) / (lyTotalVotes || 1))
              }
              pctStyle="plain"
              pct2={pctChange(
                lyVotes?.prevTotalVotes,
                lylyVotes?.prevTotalVotes,
              )}
              size="xl"
              pctSuffix=""
              valueExplainer={t("total_party_votes_explainer")}
              pctExplainer={t("pct_party_votes_explainer")}
              pct2Explainer={t("pct_prev_election_votes_explainer")}
            />
            <HintedDataItem
              value={lyPos?.position}
              decimals={0}
              pctSuffix=""
              pctChange={
                lyPos?.position
                  ? (lylyPos?.position || lyPos.position) - lyPos.position
                  : undefined
              }
              valueLabel={t("position")}
              valueExplainer={t("position_explainer")}
              pctExplainer={t("position_change_explainer")}
            />
            <HintedDataItem
              value={lyVotes?.prevPaperVotes}
              decimals={0}
              pctChange={pctChange(
                lyVotes?.prevPaperVotes,
                lylyVotes?.prevPaperVotes,
              )}
              valueLabel={t("paper_votes")}
              valueExplainer={t("paper_votes_explainer")}
              pctExplainer={t("paper_votes_change_explainer")}
            />
            <HintedDataItem
              value={lyVotes?.prevMachineVotes}
              decimals={0}
              pctChange={pctChange(
                lyVotes?.prevMachineVotes,
                lylyVotes?.prevMachineVotes,
              )}
              valueLabel={t("machine_votes")}
              valueExplainer={t("machine_votes_explainer")}
              pctExplainer={t("machine_votes_change_explainer")}
            />
          </ProtocolCard>
        )}
        {party && (
          <ProtocolCard
            className="first-letter:uppercase"
            icon={<Flag />}
            title={t("elections")}
          >
            <HistoryChart
              party={party}
              stats={stats}
              isConsolidated={true}
              className="max-h-48"
              xAxis={true}
            />
          </ProtocolCard>
        )}
      </div>
    </AccordionSummary>
  );
};
