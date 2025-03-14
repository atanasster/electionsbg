import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { FC } from "react";
import { PartySuemgTable } from "../PartySuemgTable";

export const RegionsSuemgTable: FC<{ title: string }> = ({ title }) => {
  const { countryVotes } = useRegionVotes();
  const votes = countryVotes();

  return <PartySuemgTable title={title} results={votes.results} />;
};
