import { FC } from "react";
import { PartyInfo } from "@/data/dataTypes";
import { partyVotesPosition, totalAllVotes } from "@/data/utils";
import { Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HintedDataItem } from "@/ux/HintedDataItem";
import { useElectionContext } from "@/data/ElectionContext";
import { ProtocolCard } from "@/ux/ProtocolCard";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { RecountAddedVotesCard } from "../../cards/RecountAddedVotesCard";
import { RecountRemovedVotesCard } from "../../cards/RecountRemovedVotesCard";

export const PartyRecountSummary: FC<{
  party: PartyInfo;
}> = ({ party }) => {
  const { t } = useTranslation();
  const { electionStats } = useElectionContext();
  const votes = electionStats?.results?.votes.find(
    (v) => v.number === party.number,
  );
  const totalVotes = totalAllVotes(electionStats?.results?.votes);
  const pos = partyVotesPosition(party.number, electionStats?.results?.votes);
  const { countryVotes } = useRegionVotes();
  const allVotes = countryVotes();
  const partyVotes = allVotes.results.votes.find(
    (v) => v.partyNum === party.number,
  );
  const originalVotes = allVotes.original.votes.find(
    (v) => v.partyNum === party.number,
  );
  const stats = partyVotes && originalVotes ? originalVotes : undefined;
  return (
    <div className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-3 my-4`}>
      <ProtocolCard icon={<Users />} title={t("voters")}>
        <HintedDataItem
          value={votes?.totalVotes}
          decimals={0}
          pctChange={100 * ((votes?.totalVotes || 0) / (totalVotes || 1))}
          pctStyle="plain"
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
          valueLabel={t("position")}
          valueExplainer={t("position_explainer")}
          pctExplainer={t("position_change_explainer")}
        />
        <HintedDataItem
          value={votes?.paperVotes}
          decimals={0}
          valueLabel={t("paper_votes")}
          valueExplainer={t("paper_votes_explainer")}
          pctExplainer={t("paper_votes_change_explainer")}
        />
        <HintedDataItem
          value={votes?.machineVotes}
          decimals={0}
          valueLabel={t("machine_votes")}
          valueExplainer={t("machine_votes_explainer")}
          pctExplainer={t("machine_votes_change_explainer")}
        />
      </ProtocolCard>
      {stats && electionStats?.results?.protocol && (
        <RecountAddedVotesCard
          original={stats}
          votes={electionStats?.results?.votes}
        />
      )}
      {stats && electionStats?.results?.protocol && (
        <RecountRemovedVotesCard
          original={stats}
          votes={electionStats?.results?.votes}
        />
      )}
    </div>
  );
};
