import { FC } from "react";
import { PartyVotesTable } from "../PartyVotesTable";
import { useMunicipalityStats } from "@/data/municipalities/useMunicipalityStats";
import { useMunicipalityVotes } from "@/data/municipalities/useMunicipalityVotes";

export const SettlementPartyTable: FC<{ municipality: string }> = ({
  municipality,
}) => {
  const { municipality: municipalityVotes } =
    useMunicipalityVotes(municipality);
  const { prevVotes, stats } = useMunicipalityStats(municipality);

  return (
    <PartyVotesTable
      results={municipalityVotes?.results}
      stats={stats}
      prevElection={prevVotes}
    />
  );
};
