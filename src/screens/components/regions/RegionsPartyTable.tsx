import { useCountryStats } from "@/data/country/useCountryVotesStats";
import { useElectionContext } from "@/data/ElectionContext";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { FC } from "react";
import { PartyVotesTable } from "../PartyVotesTable";

export const RegionsPartyTable: FC = () => {
  const { countryVotes } = useRegionVotes();

  const { prevVotes } = useCountryStats();
  const { stats } = useElectionContext();
  const results = countryVotes();

  return (
    <PartyVotesTable
      votes={results.votes}
      prevElectionVotes={prevVotes}
      stats={stats}
    />
  );
};
