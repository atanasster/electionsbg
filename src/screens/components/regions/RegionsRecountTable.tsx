import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { FC } from "react";
import { PartyRecountTable } from "../PartyRecountTable";

export const RegionsRecountTable: FC<{ title: string }> = ({ title }) => {
  const { countryVotes } = useRegionVotes();
  const votes = countryVotes();

  return <PartyRecountTable title={title} votes={votes} />;
};
