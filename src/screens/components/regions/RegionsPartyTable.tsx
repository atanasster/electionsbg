import { useElectionContext } from "@/data/ElectionContext";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { FC } from "react";
import { PartyVotesTable } from "../PartyVotesTable";

export const RegionsPartyTable: FC<{ title: string }> = ({ title }) => {
  const { countryVotes } = useRegionVotes();

  const { stats, priorElections } = useElectionContext();
  const { results } = countryVotes();

  return (
    <PartyVotesTable
      title={title}
      results={results}
      prevElection={priorElections}
      stats={stats}
    />
  );
};
