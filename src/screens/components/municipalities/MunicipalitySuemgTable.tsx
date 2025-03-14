import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { FC } from "react";
import { useRegions } from "@/data/regions/useRegions";
import { PartySuemgTable } from "../PartySuemgTable";

export const MunicipalitySuemgTable: FC<{
  region: string;
  title: string;
}> = ({ region, title }) => {
  const { findRegion } = useRegions();
  const { votesByRegion } = useRegionVotes();
  const info = findRegion(region);
  const regionVotes = (info && votesByRegion(info.oblast)) || undefined;

  return <PartySuemgTable title={title} results={regionVotes?.results} />;
};
