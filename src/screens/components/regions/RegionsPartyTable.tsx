import { useElectionContext } from "@/data/ElectionContext";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { FC } from "react";
import { PartyVotesTable } from "../PartyVotesTable";

export const RegionsPartyTable: FC = () => {
  const { countryVotes } = useRegionVotes();

  const { stats, priorElections } = useElectionContext();
  const results = countryVotes();

  return (
    <PartyVotesTable
      results={results}
      prevElection={priorElections}
      stats={stats}
    />
  );
};
