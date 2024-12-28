import { FC } from "react";
import { PartyVotesTable } from "../PartyVotesTable";
import { useMunicipalityStats } from "@/data/municipalities/useMunicipalityStats";
import { useMunicipalityVotes } from "@/data/municipalities/useMunicipalityVotes";

export const SettlementPartyTable: FC<{
  municipality: string;
  title: string;
}> = ({ municipality, title }) => {
  const { municipality: municipalityVotes } =
    useMunicipalityVotes(municipality);
  const { prevVotes, stats } = useMunicipalityStats(municipality);

  return (
    <PartyVotesTable
      title={title}
      results={municipalityVotes?.results}
      stats={stats}
      prevElection={prevVotes}
    />
  );
};
