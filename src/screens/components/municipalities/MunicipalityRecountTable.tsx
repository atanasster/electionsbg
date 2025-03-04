import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { FC } from "react";
import { useRegions } from "@/data/regions/useRegions";
import { PartyRecountTable } from "../PartyRecountTable";

export const MunicipalityRecountTable: FC<{
  region: string;
  title: string;
}> = ({ region, title }) => {
  const { findRegion } = useRegions();
  const { votesByRegion } = useRegionVotes();
  const info = findRegion(region);
  const regionVotes = (info && votesByRegion(info.oblast)) || undefined;

  return <PartyRecountTable title={title} votes={regionVotes} />;
};
