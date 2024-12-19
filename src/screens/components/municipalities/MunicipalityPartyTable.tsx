import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { FC } from "react";
import { PartyVotesTable } from "../PartyVotesTable";
import { useRegionStats } from "@/data/regions/useRegionStats";
import { useRegions } from "@/data/regions/useRegions";

export const MunicipalityPartyTable: FC<{ region: string }> = ({ region }) => {
  const { findRegion } = useRegions();
  const { votesByRegion } = useRegionVotes();
  const { prevVotes, stats } = useRegionStats(region);
  const info = findRegion(region);
  const regionVotes = (info && votesByRegion(info.oblast)) || null;

  return (
    <PartyVotesTable
      results={regionVotes?.results}
      prevElection={prevVotes}
      stats={stats}
    />
  );
};
